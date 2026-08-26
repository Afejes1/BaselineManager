[CmdletBinding()]
param([string]$TrustedCaBundlePath)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Common-A2OWorkspace.ps1')
$projectRoot = Get-A2OProjectRoot
$developmentProxy = $null

Push-Location $projectRoot
try {
  Assert-A2ONodeVersion
  Assert-A2OTlsVerificationEnabled
  if (-not (Test-Path -LiteralPath 'node_modules')) {
    throw 'Dependencies are not installed. Run npm run local:init first.'
  }
  if (-not (Test-Path -LiteralPath '.env')) {
    throw '.env is missing. Run npm run local:init first.'
  }
  $null = Assert-A2OTransferSigningMaterial
  foreach ($requiredBuildInput in @('dist/server/index.js','dist/client','wrangler.local-runtime.jsonc')) {
    if (-not (Test-Path -LiteralPath $requiredBuildInput)) {
      throw "The verified local runtime is missing $requiredBuildInput. Run npm run local:verify first."
    }
  }

  Assert-A2OBuildManifest
  Assert-A2ONoPendingMigrations

  $enrolledCaBundle = Join-Path $projectRoot '.a2o-secrets\node-extra-ca.pem'
  if (-not [string]::IsNullOrWhiteSpace($TrustedCaBundlePath)) {
    Set-A2ONodeTrustedCaBundle -CertificatePath $TrustedCaBundlePath
  } elseif (Test-Path -LiteralPath $enrolledCaBundle -PathType Leaf) {
    Set-A2ONodeTrustedCaBundle -CertificatePath $enrolledCaBundle
  }

  $environmentFiles = @('.a2o-secrets/workspace-transfer.runtime.env')
  if (Test-Path -LiteralPath '.a2o-secrets/genai-mil.runtime.env' -PathType Leaf) {
    $environmentFiles += '.a2o-secrets/genai-mil.runtime.env'
  }
  $genaiConfigurationPath = Assert-A2OProjectPath -Candidate (Join-Path $projectRoot '.a2o-secrets\genai-mil.runtime.env') -ProjectRoot $projectRoot
  if ((Test-Path -LiteralPath $genaiConfigurationPath -PathType Leaf) -and (Select-String -LiteralPath $genaiConfigurationPath -Pattern '^GENAI_MIL_TLS_MODE=development-insecure$' -Quiet)) {
    $proxyPortListeners = @(Get-NetTCPConnection -LocalPort 38471 -State Listen -ErrorAction SilentlyContinue)
    if ($proxyPortListeners.Count) { throw 'The development GenAI.mil TLS proxy port 38471 is already in use. Stop the other process and retry.' }
    $proxyScriptPath = Assert-A2OProjectPath -Candidate (Join-Path $projectRoot 'scripts\local\genai-mil-development-proxy.mjs') -ProjectRoot $projectRoot
    $nodeCommand = Get-Command node -ErrorAction Stop
    $processInfo = [System.Diagnostics.ProcessStartInfo]::new()
    $processInfo.FileName = $nodeCommand.Source
    $processInfo.WorkingDirectory = $projectRoot
    $processInfo.UseShellExecute = $false
    $processInfo.CreateNoWindow = $true
    $processInfo.RedirectStandardOutput = $true
    $processInfo.RedirectStandardError = $true
    # Windows PowerShell 5.1 uses .NET Framework, where ProcessStartInfo.ArgumentList
    # is unavailable. Both paths are locally resolved Windows paths and cannot
    # contain a literal double quote, so quote each complete Node argument.
    $processInfo.Arguments = ('"--env-file={0}" "{1}"' -f $genaiConfigurationPath, $proxyScriptPath)
    $developmentProxy = [System.Diagnostics.Process]::Start($processInfo)
    if ($developmentProxy.WaitForExit(700)) {
      $proxyError = $developmentProxy.StandardError.ReadToEnd().Trim()
      throw "The development GenAI.mil TLS proxy could not start$(if ($proxyError) { ": $proxyError" } else { '.' })"
    }
    Write-Warning 'DEVELOPMENT TLS BYPASS ACTIVE FOR EXPLICIT GENAI.MIL REQUESTS ONLY. The proxy is bound to 127.0.0.1 and stops with this runtime.'
  }
  $runtimeArgs = @('dev','--config','wrangler.local-runtime.jsonc')
  foreach ($environmentFile in $environmentFiles) { $runtimeArgs += @('--env-file',$environmentFile) }
  $runtimeArgs += @('--local','--ip','127.0.0.1','--port','3000','--persist-to','.wrangler/state','--log-level','warn','--show-interactive-dev-session','false')

  Write-Output 'Starting the verified A2O Worker bundle on http://127.0.0.1:3000.'
  if ($environmentFiles.Count -gt 1) { Write-Output 'Optional GenAI.mil assistant configuration loaded from protected local storage.' }
  Invoke-A2OCommand {
    & npx --no-install wrangler @runtimeArgs
  } 'The local application stopped with an error.'
} finally {
  if ($developmentProxy -and -not $developmentProxy.HasExited) {
    Stop-Process -Id $developmentProxy.Id -Force -ErrorAction SilentlyContinue
    $developmentProxy.WaitForExit(3000) | Out-Null
  }
  if ($developmentProxy) { $developmentProxy.Dispose() }
  Pop-Location
}
