[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][string]$DestinationDirectory,
  [switch]$ConfirmOfflineEscrow
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Common-A2OWorkspace.ps1')
$projectRoot = Get-A2OProjectRoot
if (-not $ConfirmOfflineEscrow) { throw 'This command exports authentication key material. Use -ConfirmOfflineEscrow only with approved encrypted removable media stored separately from workspace backups.' }
$destinationRoot = (Resolve-Path -LiteralPath $DestinationDirectory).Path
if (-not (Test-Path -LiteralPath $destinationRoot -PathType Container)) { throw 'DestinationDirectory must be an existing approved directory.' }
$projectPrefix = $projectRoot.TrimEnd('\') + '\'
if ($destinationRoot -eq $projectRoot -or $destinationRoot.StartsWith($projectPrefix, [System.StringComparison]::OrdinalIgnoreCase)) { throw 'Signing-key escrow must remain outside the A2O project and its workspace backups.' }

Push-Location $projectRoot
try {
  $material = Assert-A2OTransferSigningMaterial
  $destinationPath = Join-Path $destinationRoot "a2o-workspace-transfer-$($material.KeyId).a2okey"
  if (Test-Path -LiteralPath $destinationPath) { throw "The escrow file already exists and was not overwritten: $destinationPath" }
  $payload = [ordered]@{
    schemaVersion = 1
    product = 'A2O Technical Baseline Manager workspace transfer trust root'
    keyId = $material.KeyId
    key = $material.Key
  }
  try {
    $null = Write-A2OProtectedSecretTextAtomic -Path $destinationPath -Text ($payload | ConvertTo-Json -Compress) -NoOverwrite
  } catch {
    if (Test-Path -LiteralPath $destinationPath) { [System.IO.File]::Delete($destinationPath) }
    throw
  }
  Write-Output "Signing-key escrow created: $destinationPath"
  Write-Output "Escrow key ID: $($material.KeyId)"
  Write-Output 'Store this file on approved encrypted removable media, physically separate from all A2O data backups. Never email it or place it in a workspace package.'
} finally {
  Pop-Location
}
