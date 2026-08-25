[CmdletBinding()]
param([string]$TrustedCaBundlePath)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Common-A2OWorkspace.ps1')
$projectRoot = Get-A2OProjectRoot

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
  $runtimeArgs = @('dev','--config','wrangler.local-runtime.jsonc')
  foreach ($environmentFile in $environmentFiles) { $runtimeArgs += @('--env-file',$environmentFile) }
  $runtimeArgs += @('--local','--ip','127.0.0.1','--port','3000','--persist-to','.wrangler/state','--log-level','warn','--show-interactive-dev-session','false')

  Write-Output 'Starting the verified A2O Worker bundle on http://127.0.0.1:3000.'
  if ($environmentFiles.Count -gt 1) { Write-Output 'Optional GenAI.mil assistant configuration loaded from protected local storage.' }
  Invoke-A2OCommand {
    & npx --no-install wrangler @runtimeArgs
  } 'The local application stopped with an error.'
} finally {
  Pop-Location
}
