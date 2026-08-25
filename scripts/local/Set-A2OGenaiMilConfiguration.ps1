[CmdletBinding()]
param(
  [string]$ApiUrl,
  [string]$Model,
  [securestring]$ApiKey
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Common-A2OWorkspace.ps1')
$projectRoot = Get-A2OProjectRoot

function Get-A2OPlainSecret {
  param([Parameter(Mandatory=$true)][securestring]$Value)
  $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Value)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
}

function Require-A2OEnvValue {
  param([Parameter(Mandatory=$true)][string]$Name, [Parameter(Mandatory=$true)][string]$Value)
  $normalized = $Value.Trim()
  if (-not $normalized -or $normalized -match '\s') { throw "$Name must be a single non-empty value without whitespace." }
  return $normalized
}

Push-Location $projectRoot
try {
  Assert-A2OTlsVerificationEnabled
  Assert-A2ORuntimeStopped

  if ([string]::IsNullOrWhiteSpace($ApiUrl)) {
    $ApiUrl = Read-Host 'Approved HTTPS GenAI.mil chat-completions endpoint'
  }
  if ([string]::IsNullOrWhiteSpace($Model)) {
    $Model = Read-Host 'Approved GenAI.mil model identifier'
  }
  if ($null -eq $ApiKey) {
    $ApiKey = Read-Host -AsSecureString 'Active GenAI.mil API key'
  }

  $endpointText = Require-A2OEnvValue -Name 'GenAI.mil endpoint' -Value $ApiUrl
  try { $endpoint = [Uri]$endpointText } catch { throw 'GenAI.mil endpoint must be a complete HTTPS URL.' }
  $endpointHost = $endpoint.Host.ToLowerInvariant()
  if (-not $endpoint.IsAbsoluteUri -or $endpoint.Scheme -ne 'https' -or -not ($endpointHost -eq 'genai.mil' -or $endpointHost.EndsWith('.genai.mil'))) {
    throw 'The endpoint must use HTTPS and the genai.mil domain (or one of its subdomains).'
  }
  $modelName = Require-A2OEnvValue -Name 'GenAI.mil model identifier' -Value $Model
  $keyText = Get-A2OPlainSecret -Value $ApiKey
  try { $key = Require-A2OEnvValue -Name 'GenAI.mil API key' -Value $keyText }
  finally { $keyText = $null }

  $target = Assert-A2OProjectPath -Candidate (Join-Path $projectRoot '.a2o-secrets\genai-mil.runtime.env') -ProjectRoot $projectRoot
  $content = @(
    '# Optional GenAI.mil assistant configuration. Local, ACL-protected, and excluded from Git.',
    "GENAI_MIL_API_URL=$endpointText",
    "GENAI_MIL_MODEL=$modelName",
    "GENAI_MIL_API_KEY=$key"
  ) -join [Environment]::NewLine
  $null = Write-A2OProtectedSecretTextAtomic -Path $target -Text ($content + [Environment]::NewLine)
  Write-Output 'GenAI.mil configuration saved locally. It will be loaded automatically by the next npm run local:start.'
  Write-Output 'No GenAI.mil connection was attempted. To replace an expired key, run this command again while the app is stopped.'
} finally {
  Pop-Location
}
