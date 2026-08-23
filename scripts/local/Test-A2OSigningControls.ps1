[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Common-A2OWorkspace.ps1')
$projectRoot = Get-A2OProjectRoot

function Get-TestBytesSha256 {
  param([Parameter(Mandatory=$true)][byte[]]$Bytes)
  $algorithm = [System.Security.Cryptography.SHA256]::Create()
  try { return ([System.BitConverter]::ToString($algorithm.ComputeHash($Bytes))).Replace('-','').ToLowerInvariant() }
  finally { $algorithm.Dispose() }
}

function New-TestZip {
  param(
    [Parameter(Mandatory=$true)][string]$Path,
    [Parameter(Mandatory=$true)][System.Collections.IEnumerable]$Entries
  )
  Add-Type -AssemblyName System.IO.Compression
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $stream = [System.IO.File]::Open($Path, [System.IO.FileMode]::CreateNew, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)
  $archive = [System.IO.Compression.ZipArchive]::new($stream, [System.IO.Compression.ZipArchiveMode]::Create, $false)
  try {
    foreach ($item in $Entries) {
      $entry = $archive.CreateEntry([string]$item.Name, $item.Compression)
      $entryStream = $entry.Open()
      try { $entryStream.Write($item.Bytes, 0, $item.Bytes.Length) }
      finally { $entryStream.Dispose() }
    }
  } finally { $archive.Dispose() }
}

$rfcKey = New-Object byte[] 20
for ($index = 0; $index -lt $rfcKey.Length; $index++) { $rfcKey[$index] = 0x0b }
$rfcExpected = 'b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7'
$rfcActual = Get-A2OHmacSha256 -Text 'Hi There' -KeyBytes $rfcKey
if (-not (Test-A2OConstantTimeHexEqual -Left $rfcActual -Right $rfcExpected)) { throw 'The local HMAC-SHA-256 implementation failed RFC 4231 test case 1.' }

$dictionaryFixture = [ordered]@{ present = 'ordered-value'; explicitNull = $null }
if ((Get-A2OJsonProperty -Object $dictionaryFixture -Name 'present') -ne 'ordered-value' -or
    $null -ne (Get-A2OJsonProperty -Object $dictionaryFixture -Name 'missing') -or
    $null -ne (Get-A2OJsonProperty -Object $null -Name 'missing')) {
  throw 'Cross-version IDictionary JSON property handling did not preserve present and missing properties.'
}

$testKey = [System.Text.Encoding]::UTF8.GetBytes('0123456789abcdef0123456789abcdef')
$schema3Manifest = [ordered]@{
  schemaVersion = 3
  product = 'A2O Technical Baseline Manager'
  createdAt = '2026-08-23T00:00:00.0000000Z'
  computer = 'SYNTHETIC-TEST'
  databaseExport = 'database.sql'
  stateDirectory = 'state'
  gitCommit = 'commit-a'
  gitTree = 'tree-a'
  files = @([ordered]@{ path = 'database.sql'; bytes = 3; sha256 = ('a' * 64) })
  signature = [ordered]@{ algorithm = 'HMAC-SHA-256'; keyId = 'a2o-test-key'; value = '' }
}
$schema3Payload = Get-A2OBackupSignaturePayload -Manifest $schema3Manifest
$schema3ExpectedPayload = '{"domain":"a2o.local-backup.manifest.v1","schemaVersion":3,"product":"A2O Technical Baseline Manager","createdAt":"2026-08-23T00:00:00.0000000+00:00","computer":"SYNTHETIC-TEST","databaseExport":"database.sql","stateDirectory":"state","gitCommit":"commit-a","gitTree":"tree-a","files":[{"path":"database.sql","bytes":3,"sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}],"signatureAlgorithm":"HMAC-SHA-256","signatureKeyId":"a2o-test-key"}'
if ($schema3Payload -ne $schema3ExpectedPayload) { throw "The frozen schema-3 signature payload changed. Actual: $schema3Payload" }
$schema3RoundTrip = $schema3Manifest | ConvertTo-Json -Depth 8 | ConvertFrom-Json
if ((Get-A2OBackupSignaturePayload -Manifest $schema3RoundTrip) -ne $schema3Payload) { throw 'Schema-3 canonicalization changed after a JSON object round trip.' }
$schema3Signature = Get-A2OHmacSha256 -Text $schema3Payload -KeyBytes $testKey
$schema3Manifest.gitCommit = 'commit-b'
$schema3TamperedSignature = Get-A2OHmacSha256 -Text (Get-A2OBackupSignaturePayload -Manifest $schema3Manifest) -KeyBytes $testKey
if (Test-A2OConstantTimeHexEqual -Left $schema3Signature -Right $schema3TamperedSignature) { throw 'Schema-3 manifest tampering did not change the authenticated payload.' }

$schema4Manifest = [ordered]@{
  schemaVersion = 4
  product = 'A2O Technical Baseline Manager'
  createdAtUnixMs = [long]1787443200123
  computer = 'SYNTHETIC-TEST'
  databaseExport = 'database.sql'
  stateDirectory = 'state'
  activeRelease = [ordered]@{
    provenanceMode = 'verified-release'
    gitCommit = ('a' * 40); gitTree = ('b' * 40); appliedMigrationsSha256 = ('c' * 64)
    migrationFilesSha256 = ('d' * 64); runtimeConfigSha256 = ('e' * 64); buildManifestSha256 = ('f' * 64)
  }
  backupProducer = [ordered]@{
    gitCommit = ('1' * 40); gitTree = ('2' * 40); commonScriptSha256 = ('3' * 64); backupScriptSha256 = ('4' * 64)
  }
  files = @([ordered]@{ path = 'database.sql'; bytes = 3; sha256 = ('5' * 64) })
  signature = [ordered]@{ algorithm = 'HMAC-SHA-256'; keyId = 'a2o-test-key'; value = '' }
}
$schema4Payload = Get-A2OBackupSignaturePayload -Manifest $schema4Manifest
$schema4RoundTrip = $schema4Manifest | ConvertTo-Json -Depth 10 | ConvertFrom-Json
if ((Get-A2OBackupSignaturePayload -Manifest $schema4RoundTrip) -ne $schema4Payload) { throw 'Schema-4 canonicalization changed after a JSON object round trip.' }
$schema4Signature = Get-A2OHmacSha256 -Text $schema4Payload -KeyBytes $testKey
$schema4Manifest.activeRelease.runtimeConfigSha256 = ('9' * 64)
$schema4TamperedSignature = Get-A2OHmacSha256 -Text (Get-A2OBackupSignaturePayload -Manifest $schema4Manifest) -KeyBytes $testKey
if (Test-A2OConstantTimeHexEqual -Left $schema4Signature -Right $schema4TamperedSignature) { throw 'Schema-4 provenance tampering did not change the authenticated payload.' }

$signingMaterial = Assert-A2OTransferSigningMaterial
$compatibilityProvenance = New-A2OCompatibilityActiveReleaseProvenance -ProvenanceMode 'signed-schema3-compatibility' -GitCommit ('a' * 40) -GitTree ('b' * 40) -ArchiveSha256 ('c' * 64)
if ($compatibilityProvenance.provenanceMode -ne 'signed-schema3-compatibility' -or
    $compatibilityProvenance.appliedMigrationsSha256 -notmatch '^[0-9a-f]{64}$' -or
    $compatibilityProvenance.buildManifestSha256 -notmatch '^[0-9a-f]{64}$') {
  throw 'Schema-3 compatibility provenance was not converted into an explicit bounded schema-4 identity.'
}
$testRoot = Assert-A2OProjectPath -Candidate (Join-Path $projectRoot ".wrangler\recovery-control-tests-$PID") -ProjectRoot $projectRoot
[System.IO.Directory]::CreateDirectory($testRoot) | Out-Null
try {
  $atomicSecretPath = Join-Path $testRoot 'atomic-secret.test'
  $null = Write-A2OProtectedSecretTextAtomic -Path $atomicSecretPath -Text 'first-secret-value' -NoOverwrite
  $null = Write-A2OProtectedSecretTextAtomic -Path $atomicSecretPath -Text 'replacement-secret-value'
  if ((Get-Content -Raw -LiteralPath $atomicSecretPath) -ne 'replacement-secret-value') { throw 'Atomic protected replacement did not publish the complete replacement secret.' }
  Assert-A2OSecretFileAcl -Path $atomicSecretPath
  $noOverwriteRejected = $false
  try { $null = Write-A2OProtectedSecretTextAtomic -Path $atomicSecretPath -Text 'must-not-replace' -NoOverwrite }
  catch { if ($_.Exception.Message -match 'already exists') { $noOverwriteRejected = $true } else { throw } }
  if (-not $noOverwriteRejected -or (Get-Content -Raw -LiteralPath $atomicSecretPath) -ne 'replacement-secret-value') { throw 'Protected NoOverwrite did not preserve the existing secret.' }
  $driftedSecretPath = Join-Path $testRoot 'drifted-secret.test'
  [System.IO.File]::WriteAllText($driftedSecretPath, 'acl-repair-fixture', [System.Text.Encoding]::ASCII)
  Repair-A2OSecretFileAcl -Path $driftedSecretPath
  Assert-A2OSecretFileAcl -Path $driftedSecretPath

  $utf8 = [System.Text.UTF8Encoding]::new($false)
  $databaseBytes = $utf8.GetBytes('-- deterministic recovery control fixture')
  $legacyBytes = $utf8.GetBytes('legacy-backslash-path')
  $legacyManifest = [ordered]@{
    schemaVersion = 2
    product = 'A2O Technical Baseline Manager'
    databaseExport = 'database.sql'
    stateDirectory = 'state'
    files = @(
      [ordered]@{ path = 'database.sql'; bytes = [long]$databaseBytes.Length; sha256 = Get-TestBytesSha256 -Bytes $databaseBytes },
      [ordered]@{ path = 'state\legacy.txt'; bytes = [long]$legacyBytes.Length; sha256 = Get-TestBytesSha256 -Bytes $legacyBytes }
    )
  }
  $legacyManifestBytes = $utf8.GetBytes(($legacyManifest | ConvertTo-Json -Depth 7) + [Environment]::NewLine)
  $legacyPath = Join-Path $testRoot 'legacy-backslash.zip'
  New-TestZip -Path $legacyPath -Entries @(
    [pscustomobject]@{ Name = 'database.sql'; Bytes = $databaseBytes; Compression = [System.IO.Compression.CompressionLevel]::NoCompression },
    [pscustomobject]@{ Name = 'manifest.json'; Bytes = $legacyManifestBytes; Compression = [System.IO.Compression.CompressionLevel]::NoCompression },
    [pscustomobject]@{ Name = 'state\legacy.txt'; Bytes = $legacyBytes; Compression = [System.IO.Compression.CompressionLevel]::NoCompression }
  )
  $legacySha256 = Get-A2OFileSha256 -Path $legacyPath
  $legacyValidationOutput = @(& (Join-Path $PSScriptRoot 'Restore-A2OWorkspace.ps1') -BackupPath $legacyPath -ValidationOnly -PassThru -AllowLegacyWithRecordedHash -ExpectedLegacySha256 $legacySha256 -WarningAction SilentlyContinue)
  $legacyResults = @($legacyValidationOutput | Where-Object { $_ -and $_.PSTypeNames -contains 'A2O.LocalBackupValidationResult' })
  if ($legacyResults.Count -ne 1 -or $legacyResults[0].SchemaVersion -ne 2 -or $legacyResults[0].ProvenanceMode -ne $null) { throw 'A recorded-hash legacy backup with safe backslash paths did not validate.' }

  $schema3StateBytes = $utf8.GetBytes('schema-3-compatibility')
  $signedSchema3Manifest = [ordered]@{
    schemaVersion = 3; product = 'A2O Technical Baseline Manager'; createdAt = '2026-08-23T00:00:00.0000000Z'
    computer = 'SYNTHETIC-TEST'; databaseExport = 'database.sql'; stateDirectory = 'state'
    gitCommit = ('a' * 40); gitTree = ('b' * 40)
    files = @(
      [ordered]@{ path = 'database.sql'; bytes = [long]$databaseBytes.Length; sha256 = Get-TestBytesSha256 -Bytes $databaseBytes },
      [ordered]@{ path = 'state/schema3.txt'; bytes = [long]$schema3StateBytes.Length; sha256 = Get-TestBytesSha256 -Bytes $schema3StateBytes }
    )
    signature = [ordered]@{ algorithm = 'HMAC-SHA-256'; keyId = $signingMaterial.KeyId; value = '' }
  }
  $signedSchema3Manifest.signature.value = Get-A2OHmacSha256 -Text (Get-A2OBackupSignaturePayload -Manifest $signedSchema3Manifest) -KeyBytes $signingMaterial.KeyBytes
  $signedSchema3Bytes = $utf8.GetBytes(($signedSchema3Manifest | ConvertTo-Json -Depth 9) + [Environment]::NewLine)
  $signedSchema3Path = Join-Path $testRoot 'signed-schema3.zip'
  New-TestZip -Path $signedSchema3Path -Entries @(
    [pscustomobject]@{ Name = 'database.sql'; Bytes = $databaseBytes; Compression = [System.IO.Compression.CompressionLevel]::Optimal },
    [pscustomobject]@{ Name = 'manifest.json'; Bytes = $signedSchema3Bytes; Compression = [System.IO.Compression.CompressionLevel]::Optimal },
    [pscustomobject]@{ Name = 'state/schema3.txt'; Bytes = $schema3StateBytes; Compression = [System.IO.Compression.CompressionLevel]::Optimal }
  )
  $schema3ValidationOutput = @(& (Join-Path $PSScriptRoot 'Restore-A2OWorkspace.ps1') -BackupPath $signedSchema3Path -ValidationOnly -PassThru)
  $schema3Results = @($schema3ValidationOutput | Where-Object { $_ -and $_.PSTypeNames -contains 'A2O.LocalBackupValidationResult' })
  if ($schema3Results.Count -ne 1 -or $schema3Results[0].SchemaVersion -ne 3 -or $schema3Results[0].SignerKeyId -ne $signingMaterial.KeyId -or $schema3Results[0].ProvenanceMode -ne 'signed-schema3-compatibility') {
    throw 'A previously issued schema-3 signed backup did not pass end-to-end compatibility validation.'
  }

  $repetitiveBytes = $utf8.GetBytes(('A' * (1MB)))
  $signedFiles = @(
    [ordered]@{ path = 'database.sql'; bytes = [long]$databaseBytes.Length; sha256 = Get-TestBytesSha256 -Bytes $databaseBytes },
    [ordered]@{ path = 'state/repetitive.txt'; bytes = [long]$repetitiveBytes.Length; sha256 = Get-TestBytesSha256 -Bytes $repetitiveBytes }
  )
  $signedManifest = [ordered]@{
    schemaVersion = 4; product = 'A2O Technical Baseline Manager'; createdAtUnixMs = [long]1787443200123
    computer = 'SYNTHETIC-TEST'; databaseExport = 'database.sql'; stateDirectory = 'state'
    activeRelease = [ordered]@{
      provenanceMode = 'verified-release'
      gitCommit = ('a' * 40); gitTree = ('b' * 40); appliedMigrationsSha256 = ('c' * 64)
      migrationFilesSha256 = ('d' * 64); runtimeConfigSha256 = ('e' * 64); buildManifestSha256 = ('f' * 64)
    }
    backupProducer = [ordered]@{
      gitCommit = ('1' * 40); gitTree = ('2' * 40); commonScriptSha256 = ('3' * 64); backupScriptSha256 = ('4' * 64)
    }
    files = $signedFiles
    signature = [ordered]@{ algorithm = 'HMAC-SHA-256'; keyId = $signingMaterial.KeyId; value = '' }
  }
  $signedManifest.signature.value = Get-A2OHmacSha256 -Text (Get-A2OBackupSignaturePayload -Manifest $signedManifest) -KeyBytes $signingMaterial.KeyBytes
  $signedManifestBytes = $utf8.GetBytes(($signedManifest | ConvertTo-Json -Depth 10) + [Environment]::NewLine)
  $signedPath = Join-Path $testRoot 'signed-high-ratio.zip'
  New-TestZip -Path $signedPath -Entries @(
    [pscustomobject]@{ Name = 'database.sql'; Bytes = $databaseBytes; Compression = [System.IO.Compression.CompressionLevel]::Optimal },
    [pscustomobject]@{ Name = 'manifest.json'; Bytes = $signedManifestBytes; Compression = [System.IO.Compression.CompressionLevel]::Optimal },
    [pscustomobject]@{ Name = 'state/repetitive.txt'; Bytes = $repetitiveBytes; Compression = [System.IO.Compression.CompressionLevel]::Optimal }
  )
  $signedValidationOutput = @(& (Join-Path $PSScriptRoot 'Restore-A2OWorkspace.ps1') -BackupPath $signedPath -ValidationOnly -PassThru)
  $signedResults = @($signedValidationOutput | Where-Object { $_ -and $_.PSTypeNames -contains 'A2O.LocalBackupValidationResult' })
  if ($signedResults.Count -ne 1 -or $signedResults[0].SchemaVersion -ne 4 -or $signedResults[0].ProvenanceMode -ne 'verified-release') { throw 'A signed, bounded, high-compression backup did not validate.' }

  $legacyRatioManifest = [ordered]@{
    schemaVersion = 2; product = 'A2O Technical Baseline Manager'; databaseExport = 'database.sql'; stateDirectory = 'state'
    files = $signedFiles
  }
  $legacyRatioManifestBytes = $utf8.GetBytes(($legacyRatioManifest | ConvertTo-Json -Depth 7) + [Environment]::NewLine)
  $legacyRatioPath = Join-Path $testRoot 'legacy-high-ratio.zip'
  New-TestZip -Path $legacyRatioPath -Entries @(
    [pscustomobject]@{ Name = 'database.sql'; Bytes = $databaseBytes; Compression = [System.IO.Compression.CompressionLevel]::Optimal },
    [pscustomobject]@{ Name = 'manifest.json'; Bytes = $legacyRatioManifestBytes; Compression = [System.IO.Compression.CompressionLevel]::Optimal },
    [pscustomobject]@{ Name = 'state/repetitive.txt'; Bytes = $repetitiveBytes; Compression = [System.IO.Compression.CompressionLevel]::Optimal }
  )
  $legacyRatioSha256 = Get-A2OFileSha256 -Path $legacyRatioPath
  $legacyRatioRejected = $false
  try {
    $null = & (Join-Path $PSScriptRoot 'Restore-A2OWorkspace.ps1') -BackupPath $legacyRatioPath -ValidationOnly -AllowLegacyWithRecordedHash -ExpectedLegacySha256 $legacyRatioSha256 -WarningAction SilentlyContinue
  } catch {
    if ($_.Exception.Message -match 'suspicious compression ratio') { $legacyRatioRejected = $true }
    else { throw }
  }
  if (-not $legacyRatioRejected) { throw 'A legacy high-ratio archive was not rejected by the legacy-only compression policy.' }
} finally {
  if (Test-Path -LiteralPath $testRoot -PathType Container) { [System.IO.Directory]::Delete($testRoot, $true) }
}

Add-Type -AssemblyName System.Management.Automation
foreach ($scriptPath in @(Get-ChildItem -LiteralPath $PSScriptRoot -Filter '*.ps1' -File)) {
  $tokens = $null
  $errors = $null
  $null = [System.Management.Automation.Language.Parser]::ParseFile($scriptPath.FullName, [ref]$tokens, [ref]$errors)
  if ($errors.Count) { throw "PowerShell syntax validation failed for $($scriptPath.Name): $($errors[0].Message)" }
}

Write-Output 'Signing and recovery controls verified: RFC HMAC, IDictionary access, frozen schema 3, canonical schema 4, safe legacy paths, signed compression bounds, legacy ratio rejection, and PowerShell syntax.'
