[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][string]$LegacyBackupPath,
  [Parameter(Mandatory=$true)][string]$ExpectedLegacySha256,
  [Parameter(Mandatory=$true)][string]$Confirmation
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Common-A2OWorkspace.ps1')
$projectRoot = Get-A2OProjectRoot
if ($Confirmation -cne 'ESTABLISH A2O LEGACY TRUST ROOT') {
  throw 'Confirmation must exactly equal: ESTABLISH A2O LEGACY TRUST ROOT'
}
if ($ExpectedLegacySha256 -notmatch '^[0-9a-fA-F]{64}$') { throw 'ExpectedLegacySha256 must be the independently recorded 64-character SHA-256 of the complete legacy ZIP.' }

Push-Location $projectRoot
try {
  Assert-A2ORuntimeStopped
  $secretPath = Assert-A2OProjectPath -Candidate (Join-Path $projectRoot '.a2o-secrets\workspace-transfer-signing.key') -ProjectRoot $projectRoot
  if (Test-Path -LiteralPath $secretPath -PathType Leaf) { throw 'A signing trust root already exists. Import or use that root; this command never rotates it.' }

  $validationOutput = @(& (Join-Path $PSScriptRoot 'Restore-A2OWorkspace.ps1') -BackupPath $LegacyBackupPath -ValidationOnly -PassThru -AllowLegacyWithRecordedHash -ExpectedLegacySha256 $ExpectedLegacySha256)
  $validationResults = @($validationOutput | Where-Object { $_ -and $_.PSTypeNames -contains 'A2O.LocalBackupValidationResult' })
  if ($validationResults.Count -ne 1 -or $validationResults[0].SchemaVersion -notin @(0,1,2)) {
    throw 'The supplied artifact did not validate as exactly one supported unsigned legacy A2O backup.'
  }
  $validation = $validationResults[0]
  if (-not (Test-A2OConstantTimeHexEqual -Left $validation.ArchiveSha256 -Right $ExpectedLegacySha256.ToLowerInvariant())) {
    throw 'The validated legacy artifact did not retain the independently recorded whole-archive SHA-256.'
  }

  $initializationOutput = @(Initialize-A2OTransferSigningMaterial -AuthorizedLegacyTrustEstablishment)
  $materials = @($initializationOutput | Where-Object { $_ -and $_.PSObject.Properties['KeyId'] -and $_.PSObject.Properties['KeyBytes'] })
  if ($materials.Count -ne 1) { throw 'Legacy trust establishment did not return exactly one signing identity.' }
  $material = $materials[0]
  $receipt = [ordered]@{
    schemaVersion = 1
    product = 'A2O Technical Baseline Manager legacy trust establishment receipt'
    establishedAtUnixMs = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    legacyBackupSchemaVersion = [int]$validation.SchemaVersion
    legacyBackupSha256 = $validation.ArchiveSha256
    establishedKeyId = $material.KeyId
  }
  $receiptPath = Assert-A2OProjectPath -Candidate (Join-Path $projectRoot '.a2o-secrets\legacy-trust-establishment.json') -ProjectRoot $projectRoot
  $null = Write-A2OProtectedSecretTextAtomic -Path $receiptPath -Text (($receipt | ConvertTo-Json -Depth 5) + [Environment]::NewLine)
  Write-Output "Legacy signing trust root established: $($material.KeyId)"
  Write-Output "Authenticated legacy archive: $($validation.ArchiveSha256)"
  Write-Output 'Immediately export the new key to separate approved escrow and restore the legacy backup. Run local:update if its release differs, otherwise verify it, then retain a schema-4 signed backup.'
} finally {
  Pop-Location
}
