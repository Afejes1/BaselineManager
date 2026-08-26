[CmdletBinding()]
param([switch]$Disable)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Common-A2OWorkspace.ps1')
$projectRoot = Get-A2OProjectRoot

Push-Location $projectRoot
try {
  Assert-A2OTlsVerificationEnabled
  Assert-A2ORuntimeStopped
  $configurationPath = Assert-A2OProjectPath -Candidate (Join-Path $projectRoot '.a2o-secrets\genai-mil.runtime.env') -ProjectRoot $projectRoot
  if (-not (Test-Path -LiteralPath $configurationPath -PathType Leaf)) {
    throw 'GenAI.mil is not configured. Run npm run local:genai:configure first.'
  }

  $allowedNames = @('GENAI_MIL_API_URL','GENAI_MIL_MODEL','GENAI_MIL_API_KEY','GENAI_MIL_TOOL_MODE','GENAI_MIL_TLS_MODE','GENAI_MIL_LOCAL_PROXY_TOKEN')
  $assignments = @{}
  foreach ($line in @(Get-Content -LiteralPath $configurationPath)) {
    if (-not $line.Trim() -or $line.TrimStart().StartsWith('#')) { continue }
    $match = [regex]::Match($line, '^([A-Z0-9_]+)=([^\r\n]*)$')
    if (-not $match.Success -or $match.Groups[1].Value -notin $allowedNames -or $assignments.ContainsKey($match.Groups[1].Value)) {
      throw 'The protected GenAI.mil configuration contains an unexpected or duplicate assignment. Re-run npm run local:genai:configure.'
    }
    $assignments[$match.Groups[1].Value] = $match.Groups[2].Value
  }
  foreach ($required in @('GENAI_MIL_API_URL','GENAI_MIL_MODEL','GENAI_MIL_API_KEY','GENAI_MIL_TOOL_MODE')) {
    if ([string]::IsNullOrWhiteSpace([string]$assignments[$required])) { throw "The protected GenAI.mil configuration is missing $required. Re-run npm run local:genai:configure." }
  }
  try { $endpoint = [Uri]([string]$assignments['GENAI_MIL_API_URL']) } catch { throw 'The protected GenAI.mil endpoint is invalid.' }
  $endpointHost = $endpoint.Host.ToLowerInvariant()
  if (-not $endpoint.IsAbsoluteUri -or $endpoint.Scheme -ne 'https' -or -not ($endpointHost -eq 'genai.mil' -or $endpointHost.EndsWith('.genai.mil'))) {
    throw 'The protected endpoint must use HTTPS and the genai.mil domain.'
  }
  if ([string]$assignments['GENAI_MIL_TOOL_MODE'] -notin @('json-proposals','native-tools')) { throw 'The protected GenAI.mil tool mode is invalid.' }
  if ([string]$assignments['GENAI_MIL_API_KEY'] -match '[\r\n\s]') { throw 'The protected GenAI.mil API key contains unsupported whitespace.' }

  $headerPath = Assert-A2OProjectPath -Candidate (Join-Path $projectRoot '.a2o-secrets\genai-mil.curl.headers') -ProjectRoot $projectRoot
  $content = @(
    '# Optional GenAI.mil assistant configuration. Local, ACL-protected, and excluded from Git.',
    "GENAI_MIL_API_URL=$($assignments['GENAI_MIL_API_URL'])",
    "GENAI_MIL_MODEL=$($assignments['GENAI_MIL_MODEL'])",
    "GENAI_MIL_API_KEY=$($assignments['GENAI_MIL_API_KEY'])",
    "GENAI_MIL_TOOL_MODE=$($assignments['GENAI_MIL_TOOL_MODE'])"
  )
  if ($Disable) {
    $null = Write-A2OProtectedSecretTextAtomic -Path $configurationPath -Text (($content -join [Environment]::NewLine) + [Environment]::NewLine)
    if (Test-Path -LiteralPath $headerPath -PathType Leaf) { Remove-Item -LiteralPath $headerPath -Force }
    Write-Output 'GenAI.mil TLS certificate verification restored. The development bypass is disabled.'
    return
  }

  $random = New-Object byte[] 32
  $generator = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try { $generator.GetBytes($random) } finally { $generator.Dispose() }
  $proxyToken = ([System.BitConverter]::ToString($random)).Replace('-','').ToLowerInvariant()
  $content += @('GENAI_MIL_TLS_MODE=development-insecure', "GENAI_MIL_LOCAL_PROXY_TOKEN=$proxyToken")
  $headers = @('content-type: application/json', "authorization: Bearer $($assignments['GENAI_MIL_API_KEY'])") -join [Environment]::NewLine
  $null = Write-A2OProtectedSecretTextAtomic -Path $configurationPath -Text (($content -join [Environment]::NewLine) + [Environment]::NewLine)
  $null = Write-A2OProtectedSecretTextAtomic -Path $headerPath -Text ($headers + [Environment]::NewLine)
  Write-Warning 'DEVELOPMENT TLS BYPASS ENABLED FOR EXPLICIT GENAI.MIL REQUESTS. Certificate and revocation checks are disabled only inside the loopback GenAI.mil transport. Do not use this mode for production or an accredited environment.'
  Write-Output 'Run npm run local:start. The bypass remains visible in the GenAI.mil assistant panel.'
} finally {
  Pop-Location
}
