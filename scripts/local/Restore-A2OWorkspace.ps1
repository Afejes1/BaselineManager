[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][string]$BackupPath,
  [switch]$Force,
  [switch]$ValidationOnly,
  [switch]$PassThru,
  [switch]$AllowLegacyWithRecordedHash,
  [string]$ExpectedLegacySha256
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Common-A2OWorkspace.ps1')
$projectRoot = Get-A2OProjectRoot
if (-not $ValidationOnly -and -not $Force) {
  throw 'Restore replaces the active local state. Stop the application and rerun with -Force, or use -ValidationOnly for a non-mutating check.'
}

function Copy-A2OBoundedStream {
  param(
    [Parameter(Mandatory=$true)][System.IO.Stream]$InputStream,
    [Parameter(Mandatory=$true)][System.IO.Stream]$OutputStream,
    [Parameter(Mandatory=$true)][long]$ExpectedBytes,
    [Parameter(Mandatory=$true)][long]$MaximumBytes,
    [Parameter(Mandatory=$true)][string]$EntryName
  )
  $buffer = New-Object byte[] 65536
  [long]$written = 0
  while (($read = $InputStream.Read($buffer, 0, $buffer.Length)) -gt 0) {
    $written += [long]$read
    if ($written -gt $MaximumBytes -or $written -gt $ExpectedBytes) { throw "The expanded backup entry exceeded its declared bounds: $EntryName" }
    $OutputStream.Write($buffer, 0, $read)
  }
  if ($written -ne $ExpectedBytes) { throw "The expanded backup entry did not match its declared size: $EntryName" }
  return $written
}

function Read-A2OManifestEntry {
  param([Parameter(Mandatory=$true)]$Entry)
  $input = $Entry.Open()
  $memory = [System.IO.MemoryStream]::new()
  try {
    $null = Copy-A2OBoundedStream -InputStream $input -OutputStream $memory -ExpectedBytes ([long]$Entry.Length) -MaximumBytes 1MB -EntryName 'manifest.json'
    $bytes = $memory.ToArray()
  }
  finally { $memory.Dispose(); $input.Dispose() }
  $offset = 0
  if ($bytes.Length -ge 3 -and $bytes[0] -eq 0xef -and $bytes[1] -eq 0xbb -and $bytes[2] -eq 0xbf) { $offset = 3 }
  try {
    $encoding = [System.Text.UTF8Encoding]::new($false, $true)
    return $encoding.GetString($bytes, $offset, $bytes.Length - $offset)
  } catch { throw 'The selected ZIP contains a backup manifest that is not valid UTF-8.' }
}

function Get-A2OSafeArchivePath {
  param(
    [Parameter(Mandatory=$true)][string]$Path,
    [switch]$Legacy
  )
  if ([string]::IsNullOrWhiteSpace($Path) -or $Path.Length -gt 1024 -or $Path.Contains([char]0)) { throw "Unsafe archive entry: $Path" }
  if (-not $Legacy -and $Path.Contains('\')) { throw "Signed backup entry paths must use forward slashes: $Path" }
  $normalized = if ($Legacy) { $Path.Replace('\','/') } else { $Path }
  if ([System.IO.Path]::IsPathRooted($normalized) -or $normalized.StartsWith('/') -or $normalized -match '^[A-Za-z]:') { throw "Unsafe archive entry: $Path" }
  $isDirectory = $normalized.EndsWith('/')
  $segments = @($normalized.Split('/'))
  for ($index = 0; $index -lt $segments.Count; $index++) {
    $segment = [string]$segments[$index]
    if ($isDirectory -and $index -eq ($segments.Count - 1) -and $segment -eq '') { continue }
    if (-not $segment -or $segment -in @('.','..') -or $segment -match '[:<>"|?*]' -or $segment -match '[\. ]$') { throw "Unsafe archive entry: $Path" }
  }
  return $normalized
}

function Assert-A2OExactJsonProperties {
  param(
    [Parameter(Mandatory=$true)]$Object,
    [Parameter(Mandatory=$true)][string[]]$Expected,
    [Parameter(Mandatory=$true)][string]$Context
  )
  $actual = if ($Object -is [System.Collections.IDictionary]) { @($Object.Keys | ForEach-Object { [string]$_ }) } else { @($Object.PSObject.Properties | ForEach-Object { [string]$_.Name }) }
  $unexpected = @($actual | Where-Object { $_ -cnotin $Expected })
  $missing = @($Expected | Where-Object { $_ -cnotin $actual })
  if ($unexpected.Count -or $missing.Count -or $actual.Count -ne $Expected.Count) {
    throw "$Context contains missing, duplicate, case-variant, or unsupported properties."
  }
}

function Test-A2OJsonInteger {
  param([AllowNull()]$Value)
  return $Value -is [byte] -or $Value -is [int16] -or $Value -is [int32] -or $Value -is [int64]
}

$resolvedBackup = (Resolve-Path -LiteralPath $BackupPath).Path
if (-not [string]::Equals([System.IO.Path]::GetExtension($resolvedBackup), '.zip', [System.StringComparison]::OrdinalIgnoreCase)) {
  throw 'BackupPath must identify an A2O workspace ZIP backup.'
}
$archiveBytes = (Get-Item -LiteralPath $resolvedBackup).Length
$maximumArchiveBytes = 5GB
$maximumExpandedBytes = 20GB
$maximumEntryBytes = 2GB
$maximumEntries = 100000
$maximumLegacyCompressionRatio = 500
if ($archiveBytes -le 0 -or $archiveBytes -gt $maximumArchiveBytes) { throw 'The backup archive exceeds the supported 5 GB size limit.' }
if ($AllowLegacyWithRecordedHash -and $ExpectedLegacySha256 -notmatch '^[0-9a-fA-F]{64}$') { throw 'Legacy recovery requires an independently recorded 64-character archive SHA-256 value.' }
if (-not $AllowLegacyWithRecordedHash -and $ExpectedLegacySha256) { throw 'ExpectedLegacySha256 is valid only with -AllowLegacyWithRecordedHash.' }
$archiveSha256 = Get-A2OFileSha256 -Path $resolvedBackup

$wranglerRoot = Assert-A2OProjectPath -Candidate (Join-Path $projectRoot '.wrangler') -ProjectRoot $projectRoot
$timestamp = [DateTimeOffset]::UtcNow.ToString('yyyyMMdd-HHmmssfff', [System.Globalization.CultureInfo]::InvariantCulture)
$staging = Assert-A2OProjectPath -Candidate (Join-Path $wranglerRoot "restore-staging-$timestamp-$PID") -ProjectRoot $projectRoot
$activeState = Assert-A2OProjectPath -Candidate (Join-Path $wranglerRoot 'state') -ProjectRoot $projectRoot
$recoveryState = Assert-A2OProjectPath -Candidate (Join-Path $wranglerRoot "state.pre-restore-$timestamp") -ProjectRoot $projectRoot
$provenancePath = Assert-A2OProjectPath -Candidate (Join-Path $wranglerRoot 'active-release-provenance.json') -ProjectRoot $projectRoot
$recoveryProvenance = Assert-A2OProjectPath -Candidate (Join-Path $wranglerRoot "active-release.pre-restore-$timestamp.json") -ProjectRoot $projectRoot

New-Item -ItemType Directory -Force -Path $wranglerRoot | Out-Null
New-Item -ItemType Directory -Force -Path $staging | Out-Null

try {
  Assert-A2ORuntimeStopped
  Add-Type -AssemblyName System.IO.Compression
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $archiveStream = $null
  $archive = $null
  try {
    $archiveStream = [System.IO.File]::Open($resolvedBackup, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::Read)
    $archive = [System.IO.Compression.ZipArchive]::new($archiveStream, [System.IO.Compression.ZipArchiveMode]::Read, $false)
    if ($archive.Entries.Count -le 0 -or $archive.Entries.Count -gt $maximumEntries) { throw 'The backup contains an unsupported number of archive entries.' }

    $manifestEntries = @($archive.Entries | Where-Object { [string]$_.FullName -eq 'manifest.json' })
    if ($manifestEntries.Count -ne 1) { throw 'The selected ZIP does not contain exactly one root A2O backup manifest.' }
    $manifestEntry = $manifestEntries[0]
    if ($manifestEntry.Length -le 0 -or $manifestEntry.Length -gt 1MB) { throw 'The A2O backup manifest exceeds its supported size limit.' }
    $manifestText = Read-A2OManifestEntry -Entry $manifestEntry
    try { $manifest = $manifestText | ConvertFrom-Json }
    catch { throw 'The selected ZIP contains an invalid A2O backup manifest.' }
    $manifestSchemaValue = Get-A2OJsonProperty -Object $manifest -Name 'schemaVersion'
    $manifestSchemaVersion = if ($null -eq $manifestSchemaValue) { 0 } elseif ($manifestSchemaValue -is [byte] -or $manifestSchemaValue -is [int16] -or $manifestSchemaValue -is [int32] -or $manifestSchemaValue -is [int64]) { [int]$manifestSchemaValue } else { -1 }
    if ([string](Get-A2OJsonProperty -Object $manifest -Name 'product') -ne 'A2O Technical Baseline Manager') { throw 'The selected ZIP is not an A2O workspace backup.' }
    if ($manifestSchemaVersion -in @(2,3,4) -and
        ([string](Get-A2OJsonProperty -Object $manifest -Name 'databaseExport') -ne 'database.sql' -or [string](Get-A2OJsonProperty -Object $manifest -Name 'stateDirectory') -ne 'state')) {
      throw 'The backup manifest does not declare the supported database export and state roots.'
    }

    $signerKeyId = $null
    $activeGitCommit = $null
    $activeGitTree = $null
    $provenanceMode = $null
    $activeRelease = $null
    $createdAtUnixMs = 0
    if ($manifestSchemaVersion -in @(3,4)) {
      $signingMaterial = Assert-A2OTransferSigningMaterial
      $manifestSignature = Get-A2OJsonProperty -Object $manifest -Name 'signature'
      $signatureAlgorithm = [string](Get-A2OJsonProperty -Object $manifestSignature -Name 'algorithm')
      $signatureKeyId = [string](Get-A2OJsonProperty -Object $manifestSignature -Name 'keyId')
      $signatureValue = [string](Get-A2OJsonProperty -Object $manifestSignature -Name 'value')
      if (-not $manifestSignature -or $signatureAlgorithm -ne 'HMAC-SHA-256' -or $signatureKeyId -ne $signingMaterial.KeyId -or $signatureValue -notmatch '^[0-9a-f]{64}$') {
        throw 'The backup signature is missing, malformed, or was produced by an untrusted key.'
      }
      $expectedSignature = Get-A2OHmacSha256 -Text (Get-A2OBackupSignaturePayload -Manifest $manifest) -KeyBytes $signingMaterial.KeyBytes
      if (-not (Test-A2OConstantTimeHexEqual -Left $signatureValue -Right $expectedSignature)) {
        throw 'Backup authenticity validation failed. The manifest may have been replaced or modified.'
      }
      $signerKeyId = $signingMaterial.KeyId
      if ($manifestSchemaVersion -eq 3) {
        $activeGitCommit = [string](Get-A2OJsonProperty -Object $manifest -Name 'gitCommit')
        $activeGitTree = [string](Get-A2OJsonProperty -Object $manifest -Name 'gitTree')
        $provenanceMode = 'signed-schema3-compatibility'
        if ($activeGitCommit -notmatch '^[0-9a-f]{40,64}$' -or $activeGitTree -notmatch '^[0-9a-f]{40,64}$') { throw 'The signed schema-3 backup contains invalid active-release Git provenance.' }
      } else {
        $createdValue = Get-A2OJsonProperty -Object $manifest -Name 'createdAtUnixMs'
        if (-not (Test-A2OJsonInteger -Value $createdValue)) { throw 'The schema-4 backup contains a non-integer canonical creation timestamp.' }
        $createdText = [System.Convert]::ToString($createdValue, [System.Globalization.CultureInfo]::InvariantCulture)
        if ($createdText -notmatch '^[0-9]{13,16}$') { throw 'The schema-4 backup contains an invalid canonical creation timestamp.' }
        $createdAtUnixMs = [long]$createdText
        $activeRelease = Assert-A2OActiveReleaseFields -ActiveRelease (Get-A2OJsonProperty -Object $manifest -Name 'activeRelease')
        $activeGitCommit = $activeRelease.gitCommit
        $activeGitTree = $activeRelease.gitTree
        $provenanceMode = $activeRelease.provenanceMode
        $producer = Get-A2OJsonProperty -Object $manifest -Name 'backupProducer'
        if ([string](Get-A2OJsonProperty -Object $producer -Name 'gitCommit') -notmatch '^[0-9a-f]{40,64}$' -or
            [string](Get-A2OJsonProperty -Object $producer -Name 'gitTree') -notmatch '^[0-9a-f]{40,64}$' -or
            [string](Get-A2OJsonProperty -Object $producer -Name 'commonScriptSha256') -notmatch '^[0-9a-f]{64}$' -or
            [string](Get-A2OJsonProperty -Object $producer -Name 'backupScriptSha256') -notmatch '^[0-9a-f]{64}$') {
          throw 'The schema-4 backup contains invalid producer provenance.'
        }
      }
    } elseif ($manifestSchemaVersion -in @(0,1,2)) {
      if (-not $AllowLegacyWithRecordedHash) { throw 'This older backup is not authenticated. Use the documented one-time legacy recovery procedure with an independently recorded whole-archive SHA-256 value.' }
      if (-not (Test-A2OConstantTimeHexEqual -Left $archiveSha256 -Right $ExpectedLegacySha256.ToLowerInvariant())) { throw 'The legacy backup does not match the independently recorded archive SHA-256 value.' }
      $legacyCommit = [string](Get-A2OJsonProperty -Object $manifest -Name 'gitCommit')
      $legacyTree = [string](Get-A2OJsonProperty -Object $manifest -Name 'gitTree')
      if ($legacyCommit -match '^[0-9a-f]{40,64}$' -and $legacyTree -match '^[0-9a-f]{40,64}$') { $activeGitCommit = $legacyCommit; $activeGitTree = $legacyTree; $provenanceMode = 'recorded-hash-legacy-compatibility' }
      Write-Warning "Validating a legacy schema-$manifestSchemaVersion backup after whole-archive SHA-256 verification; create a new signed backup immediately after restore."
    } else {
      throw 'The selected backup version is not supported.'
    }

    if ($manifestSchemaVersion -eq 4) {
      Assert-A2OExactJsonProperties -Object $manifest -Expected @('schemaVersion','product','createdAtUnixMs','computer','databaseExport','stateDirectory','activeRelease','backupProducer','files','signature') -Context 'The schema-4 backup manifest'
      Assert-A2OExactJsonProperties -Object (Get-A2OJsonProperty -Object $manifest -Name 'activeRelease') -Expected @('provenanceMode','gitCommit','gitTree','appliedMigrationsSha256','migrationFilesSha256','runtimeConfigSha256','buildManifestSha256') -Context 'The schema-4 active-release provenance'
      Assert-A2OExactJsonProperties -Object (Get-A2OJsonProperty -Object $manifest -Name 'backupProducer') -Expected @('gitCommit','gitTree','commonScriptSha256','backupScriptSha256') -Context 'The schema-4 backup-producer provenance'
      Assert-A2OExactJsonProperties -Object (Get-A2OJsonProperty -Object $manifest -Name 'signature') -Expected @('algorithm','keyId','value') -Context 'The schema-4 signature'
      foreach ($fileClaim in @((Get-A2OJsonProperty -Object $manifest -Name 'files'))) {
        Assert-A2OExactJsonProperties -Object $fileClaim -Expected @('path','bytes','sha256') -Context 'A schema-4 file claim'
      }
    }

    $isLegacy = $manifestSchemaVersion -in @(0,1,2)
    $archiveEntries = @{}
    $entryRecords = @()
    [long]$declaredExpandedBytes = 0
    foreach ($entry in $archive.Entries) {
      $normalizedName = Get-A2OSafeArchivePath -Path ([string]$entry.FullName) -Legacy:$isLegacy
      if ($archiveEntries.ContainsKey($normalizedName)) { throw "Duplicate archive entry after safe path normalization: $normalizedName" }
      $isDirectory = $normalizedName.EndsWith('/')
      $archiveEntries[$normalizedName] = $entry
      $entryRecords += [pscustomobject]@{ Entry = $entry; Name = $normalizedName; IsDirectory = $isDirectory }
      if ($isDirectory) { continue }
      if ($entry.Length -lt 0 -or $entry.Length -gt $maximumEntryBytes -or $entry.CompressedLength -lt 0) { throw "The backup entry exceeds supported size limits: $normalizedName" }
      if ($isLegacy -and $entry.Length -gt 0 -and ($entry.CompressedLength -eq 0 -or ([double]$entry.Length / [double]$entry.CompressedLength) -gt $maximumLegacyCompressionRatio)) {
        throw "The legacy backup entry has a suspicious compression ratio: $normalizedName"
      }
      $declaredExpandedBytes += [long]$entry.Length
      if ($declaredExpandedBytes -gt $maximumExpandedBytes) { throw 'The expanded backup exceeds the supported 20 GB limit.' }
    }
    if (-not $archiveEntries.ContainsKey('manifest.json')) { throw 'The normalized archive does not contain its root manifest.' }

    $declaredEntries = @{}
    if ($manifestSchemaVersion -in @(2,3,4)) {
      $previousPath = $null
      foreach ($declaredEntry in @((Get-A2OJsonProperty -Object $manifest -Name 'files'))) {
        $rawDeclaredPath = [string](Get-A2OJsonProperty -Object $declaredEntry -Name 'path')
        $declaredPath = Get-A2OSafeArchivePath -Path $rawDeclaredPath -Legacy:$isLegacy
        $declaredBytes = Get-A2OJsonProperty -Object $declaredEntry -Name 'bytes'
        $declaredSha256 = [string](Get-A2OJsonProperty -Object $declaredEntry -Name 'sha256')
        if ($manifestSchemaVersion -eq 4 -and ((Get-A2OJsonProperty -Object $declaredEntry -Name 'path') -isnot [string] -or -not (Test-A2OJsonInteger -Value $declaredBytes) -or [long]$declaredBytes -lt 0)) {
          throw 'A schema-4 file claim contains a non-canonical path or byte count type.'
        }
        if ($declaredPath.EndsWith('/') -or $declaredEntries.ContainsKey($declaredPath) -or $declaredPath -eq 'manifest.json') { throw 'The backup manifest contains a missing, duplicate, or reserved file path.' }
        if ($manifestSchemaVersion -eq 4 -and ($rawDeclaredPath -ne $declaredPath -or ($previousPath -and [string]::CompareOrdinal($previousPath, $declaredPath) -ge 0))) { throw 'The schema-4 backup inventory is not in canonical path order.' }
        if (-not $archiveEntries.ContainsKey($declaredPath) -or $archiveEntries[$declaredPath].FullName.EndsWith('/')) { throw "A declared backup file is missing: $declaredPath" }
        if ($null -eq $declaredBytes -or [long]$declaredBytes -ne [long]$archiveEntries[$declaredPath].Length) { throw "Backup size validation failed: $declaredPath" }
        if ($declaredSha256 -notmatch '^[0-9a-f]{64}$') { throw "Backup hash metadata is invalid: $declaredPath" }
        $declaredEntries[$declaredPath] = $declaredEntry
        $previousPath = $declaredPath
      }
      if (-not $declaredEntries.Count) { throw 'The backup manifest does not contain an integrity inventory.' }
      if (-not $declaredEntries.ContainsKey('database.sql')) { throw 'The backup integrity inventory does not contain its readable database export.' }
      $unexpectedArchiveEntries = @($entryRecords | Where-Object { -not $_.IsDirectory -and $_.Name -ne 'manifest.json' -and -not $declaredEntries.ContainsKey($_.Name) })
      $actualArchiveFileCount = @($entryRecords | Where-Object { -not $_.IsDirectory }).Count
      if ($actualArchiveFileCount -ne ($declaredEntries.Count + 1) -or $unexpectedArchiveEntries.Count) { throw 'The backup contains files outside its integrity inventory.' }
    }

    foreach ($record in $entryRecords) {
      $destination = [System.IO.Path]::GetFullPath((Join-Path $staging $record.Name))
      $stagingPrefix = $staging.TrimEnd('\') + '\'
      if (-not $destination.StartsWith($stagingPrefix, [System.StringComparison]::OrdinalIgnoreCase)) { throw "Unsafe archive entry: $($record.Name)" }
      if ($record.IsDirectory) {
        [System.IO.Directory]::CreateDirectory($destination) | Out-Null
        continue
      }
      $parentDirectory = [System.IO.Path]::GetDirectoryName($destination)
      if ($parentDirectory) { [System.IO.Directory]::CreateDirectory($parentDirectory) | Out-Null }
      $entryStream = $record.Entry.Open()
      $outputStream = [System.IO.File]::Open($destination, [System.IO.FileMode]::CreateNew, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)
      try { $null = Copy-A2OBoundedStream -InputStream $entryStream -OutputStream $outputStream -ExpectedBytes ([long]$record.Entry.Length) -MaximumBytes $maximumEntryBytes -EntryName $record.Name }
      finally { $outputStream.Dispose(); $entryStream.Dispose() }
    }
  } finally {
    if ($archive) { $archive.Dispose() }
    elseif ($archiveStream) { $archiveStream.Dispose() }
  }

  $manifestPath = Join-Path $staging 'manifest.json'
  if ($manifestSchemaVersion -in @(2,3,4)) {
    $declared = @{}
    $stagingPrefix = $staging.TrimEnd('\') + '\'
    foreach ($entry in @((Get-A2OJsonProperty -Object $manifest -Name 'files'))) {
      $entryPath = Get-A2OSafeArchivePath -Path ([string](Get-A2OJsonProperty -Object $entry -Name 'path')) -Legacy:($manifestSchemaVersion -in @(0,1,2))
      $entryBytes = Get-A2OJsonProperty -Object $entry -Name 'bytes'
      $entrySha256 = [string](Get-A2OJsonProperty -Object $entry -Name 'sha256')
      if (-not $entryPath -or $declared.ContainsKey($entryPath)) { throw 'The backup manifest contains a missing or duplicate file path.' }
      $absolute = [System.IO.Path]::GetFullPath((Join-Path $staging $entryPath))
      if (-not $absolute.StartsWith($stagingPrefix, [System.StringComparison]::OrdinalIgnoreCase)) { throw "Unsafe backup manifest path: $entryPath" }
      if (-not (Test-Path -LiteralPath $absolute -PathType Leaf)) { throw "A declared backup file is missing: $entryPath" }
      $file = Get-Item -LiteralPath $absolute
      $hash = Get-A2OFileSha256 -Path $absolute
      if ($null -eq $entryBytes -or [long]$entryBytes -ne $file.Length -or $entrySha256 -ne $hash) { throw "Backup integrity validation failed: $entryPath" }
      $declared[$entryPath] = $true
    }
    $actual = @(Get-ChildItem -LiteralPath $staging -File -Recurse | Where-Object { $_.FullName -ne $manifestPath } | ForEach-Object { Get-A2ORelativePath -BasePath $staging -ChildPath $_.FullName })
    $unexpected = @($actual | Where-Object { -not $declared.ContainsKey($_) })
    if ($actual.Count -ne $declared.Count -or $unexpected.Count) { throw "The backup contains files outside its integrity manifest: $($unexpected -join ', ')" }
  }

  $restoredState = Join-Path $staging 'state'
  if (-not (Test-Path -LiteralPath $restoredState -PathType Container)) { throw 'The selected ZIP does not contain an A2O workspace state directory.' }
  $result = [pscustomobject]@{
    PSTypeName = 'A2O.LocalBackupValidationResult'
    ArchivePath = $resolvedBackup
    ArchiveSha256 = $archiveSha256
    SchemaVersion = $manifestSchemaVersion
    SignerKeyId = $signerKeyId
    ProvenanceMode = $provenanceMode
    ActiveGitCommit = $activeGitCommit
    CreatedAtUnixMs = [long]$createdAtUnixMs
    ValidationOnly = [bool]$ValidationOnly
  }
  if ($ValidationOnly) {
    if ($PassThru) { Write-Output $result }
    else {
      Write-Output "Backup recovery validation passed: $resolvedBackup"
      Write-Output "Backup schema: $manifestSchemaVersion"
      if ($signerKeyId) { Write-Output "Backup signer verified: $signerKeyId" }
      if ($provenanceMode) { Write-Output "Backup provenance mode: $provenanceMode" }
      if ($activeGitCommit) { Write-Output "Backed active release: $activeGitCommit" }
      Write-Output "Backup SHA-256: $archiveSha256"
    }
    return
  }

  $currentStatePreserved = $false
  $currentProvenancePreserved = $false
  $restoredStateActivated = $false
  try {
    if (Test-Path -LiteralPath $activeState -PathType Container) {
      Assert-A2OStateUnlocked -StatePath $activeState
      [System.IO.Directory]::Move($activeState, $recoveryState)
      $currentStatePreserved = $true
    }
    if (Test-Path -LiteralPath $provenancePath -PathType Leaf) {
      [System.IO.File]::Move($provenancePath, $recoveryProvenance)
      $currentProvenancePreserved = $true
    }
    [System.IO.Directory]::Move($restoredState, $activeState)
    $restoredStateActivated = $true
    if ($manifestSchemaVersion -eq 4) {
      $null = Write-A2OActiveReleaseProvenance -ActiveRelease $activeRelease -RecordedAtUnixMs $createdAtUnixMs
    } elseif ($manifestSchemaVersion -eq 3) {
      $compatibility = New-A2OCompatibilityActiveReleaseProvenance -ProvenanceMode 'signed-schema3-compatibility' -GitCommit $activeGitCommit -GitTree $activeGitTree -ArchiveSha256 $archiveSha256
      $null = Write-A2OActiveReleaseProvenance -ActiveRelease $compatibility
    } elseif ($activeGitCommit -and $activeGitTree) {
      $compatibility = New-A2OCompatibilityActiveReleaseProvenance -ProvenanceMode 'recorded-hash-legacy-compatibility' -GitCommit $activeGitCommit -GitTree $activeGitTree -ArchiveSha256 $archiveSha256
      $null = Write-A2OActiveReleaseProvenance -ActiveRelease $compatibility
    }
  } catch {
    if ($restoredStateActivated -and (Test-Path -LiteralPath $activeState -PathType Container)) {
      try { [System.IO.Directory]::Move($activeState, $restoredState) } catch {}
    }
    if (Test-Path -LiteralPath $provenancePath -PathType Leaf) { [System.IO.File]::Delete($provenancePath) }
    if ($currentProvenancePreserved -and (Test-Path -LiteralPath $recoveryProvenance -PathType Leaf)) { [System.IO.File]::Move($recoveryProvenance, $provenancePath) }
    if ($currentStatePreserved -and -not (Test-Path -LiteralPath $activeState) -and (Test-Path -LiteralPath $recoveryState -PathType Container)) { [System.IO.Directory]::Move($recoveryState, $activeState) }
    throw "The restore failed; the prior state and provenance were rolled back when possible. $($_.Exception.Message)"
  }
  if ($currentStatePreserved) { Write-Output "Current state preserved at: $recoveryState" }
  if ($currentProvenancePreserved) { Write-Output "Current release provenance preserved at: $recoveryProvenance" }
  if ($PassThru) { Write-Output $result }
  else {
    Write-Output "Workspace restored from: $resolvedBackup"
    Write-Output 'Next: verify the checked-out release and apply an explicit backed-up update if migrations are pending.'
  }
} finally {
  if (Test-Path -LiteralPath $staging) { Remove-Item -LiteralPath $staging -Recurse -Force }
}
