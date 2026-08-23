[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][string]$KeyPath,
  [Parameter(Mandatory=$true)][string]$ExpectedKeyId
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Common-A2OWorkspace.ps1')
$projectRoot = Get-A2OProjectRoot
$resolvedKeyPath = (Resolve-Path -LiteralPath $KeyPath).Path
if ((Get-Item -LiteralPath $resolvedKeyPath).Length -le 0 -or (Get-Item -LiteralPath $resolvedKeyPath).Length -gt 4KB) { throw 'The escrowed signing-key file has an invalid size.' }
$projectPrefix = $projectRoot.TrimEnd('\') + '\'
if ($resolvedKeyPath -eq $projectRoot -or $resolvedKeyPath.StartsWith($projectPrefix, [System.StringComparison]::OrdinalIgnoreCase)) { throw 'Import the signing trust root from separately controlled escrow media, not from the A2O project or a workspace backup.' }
try { $payload = Get-Content -Raw -LiteralPath $resolvedKeyPath | ConvertFrom-Json }
catch { throw 'The escrowed signing-key file is not valid JSON.' }
if ($payload.schemaVersion -ne 1 -or $payload.product -ne 'A2O Technical Baseline Manager workspace transfer trust root' -or [string]$payload.key -notmatch '^[0-9a-f]{64}$') { throw 'The escrowed signing-key file is invalid.' }
$keyBytes = [System.Text.Encoding]::UTF8.GetBytes([string]$payload.key)
$algorithm = [System.Security.Cryptography.SHA256]::Create()
try { $fingerprint = ([System.BitConverter]::ToString($algorithm.ComputeHash($keyBytes))).Replace('-','').ToLowerInvariant() }
finally { $algorithm.Dispose() }
$derivedKeyId = "a2o-local-$($fingerprint.Substring(0,16))"
if ([string]$payload.keyId -ne $derivedKeyId -or $ExpectedKeyId -ne $derivedKeyId) { throw 'The escrowed key does not match the independently recorded expected key ID.' }

Push-Location $projectRoot
try {
  $secretDirectory = Assert-A2OProjectPath -Candidate (Join-Path $projectRoot '.a2o-secrets') -ProjectRoot $projectRoot
  $secretPath = Assert-A2OProjectPath -Candidate (Join-Path $secretDirectory 'workspace-transfer-signing.key') -ProjectRoot $projectRoot
  if (Test-Path -LiteralPath $secretPath -PathType Leaf) {
    $existing = (Get-Content -Raw -LiteralPath $secretPath).Trim()
    if ($existing -ne [string]$payload.key) { throw 'A different signing trust root already exists. This command will not overwrite it.' }
    Repair-A2OSecretFileAcl -Path $secretPath
  } else {
    New-Item -ItemType Directory -Force -Path $secretDirectory | Out-Null
    $null = Write-A2OProtectedSecretTextAtomic -Path $secretPath -Text ([string]$payload.key) -NoOverwrite
  }
  $material = Initialize-A2OTransferSigningMaterial
  if ($material.KeyId -ne $ExpectedKeyId) { throw 'The imported signing trust root failed its post-installation identity check.' }
  Write-Output "Signing trust root imported and verified: $($material.KeyId)"
  Write-Output 'Run npm run local:verify before restoring an A2O backup or workspace package.'
} finally {
  Pop-Location
}
