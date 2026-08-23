[CmdletBinding()]
param(
  [string]$OutputDirectory,
  [switch]$PassThru
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Common-A2OWorkspace.ps1')
$projectRoot = Get-A2OProjectRoot
if (-not $OutputDirectory) { $OutputDirectory = Join-Path $projectRoot 'backups' }

$backupRoot = Assert-A2OProjectPath -Candidate $OutputDirectory -ProjectRoot $projectRoot
$timestamp = [DateTimeOffset]::UtcNow.ToString('yyyyMMdd-HHmmssfff', [System.Globalization.CultureInfo]::InvariantCulture)
$staging = Assert-A2OProjectPath -Candidate (Join-Path $backupRoot ".staging-$timestamp-$PID") -ProjectRoot $projectRoot
$archivePath = Assert-A2OProjectPath -Candidate (Join-Path $backupRoot "a2o-workspace-$timestamp.zip") -ProjectRoot $projectRoot
$partialArchivePath = Assert-A2OProjectPath -Candidate (Join-Path $backupRoot ".a2o-workspace-$timestamp-$([guid]::NewGuid().ToString('N')).partial.zip") -ProjectRoot $projectRoot
$statePath = Join-Path $projectRoot '.wrangler\state'
$archiveCompleted = $false
$finalArchiveCreated = $false

New-Item -ItemType Directory -Force -Path $backupRoot | Out-Null
if (Test-Path -LiteralPath $archivePath) { throw "The timestamped backup target already exists and was not overwritten: $archivePath" }
New-Item -ItemType Directory -Force -Path $staging | Out-Null

Push-Location $projectRoot
try {
  Assert-A2ORuntimeStopped
  $signingMaterial = Assert-A2OTransferSigningMaterial
  if (-not (Test-Path -LiteralPath $statePath -PathType Container)) {
    throw 'No local workspace state exists. Initialize and use the application before backing it up.'
  }
  Assert-A2OStateUnlocked -StatePath $statePath
  $activeRelease = Get-A2OActiveReleaseProvenance -VerifyCurrentState

  $sqlPath = Join-Path $staging 'database.sql'
  Invoke-A2OCommand {
    npx --no-install wrangler d1 export DB --config wrangler.local-runtime.jsonc --local "--output=$sqlPath"
  } 'The readable D1 database export failed.'

  Assert-A2OStateUnlocked -StatePath $statePath
  Copy-Item -LiteralPath $statePath -Destination (Join-Path $staging 'state') -Recurse
  $relativePaths = [System.Collections.Generic.List[string]]::new()
  foreach ($file in @(Get-ChildItem -LiteralPath $staging -File -Recurse)) {
    $relativePaths.Add((Get-A2ORelativePath -BasePath $staging -ChildPath $file.FullName))
  }
  $relativePaths.Sort([System.StringComparer]::Ordinal)
  $files = @(foreach ($relativePath in $relativePaths) {
    $absolutePath = Join-Path $staging $relativePath.Replace('/','\')
    $file = Get-Item -LiteralPath $absolutePath
    [ordered]@{ path = $relativePath; bytes = [long]$file.Length; sha256 = Get-A2OFileSha256 -Path $absolutePath }
  })
  if (-not $files.Count) { throw 'The backup staging area did not contain any state files.' }

  $producerCommit = [string]((& git rev-parse HEAD 2>$null) | Select-Object -First 1)
  $producerTree = [string]((& git rev-parse 'HEAD^{tree}' 2>$null) | Select-Object -First 1)
  if ($LASTEXITCODE -ne 0) { throw 'The backup producer Git identity could not be read.' }
  $manifest = [ordered]@{
    schemaVersion = 4
    product = 'A2O Technical Baseline Manager'
    createdAtUnixMs = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    computer = [string]$env:COMPUTERNAME
    databaseExport = 'database.sql'
    stateDirectory = 'state'
    activeRelease = ConvertTo-A2OActiveReleaseRecord -ActiveRelease $activeRelease
    backupProducer = [ordered]@{
      gitCommit = $producerCommit.Trim()
      gitTree = $producerTree.Trim()
      commonScriptSha256 = Get-A2OFileSha256 -Path (Join-Path $PSScriptRoot 'Common-A2OWorkspace.ps1')
      backupScriptSha256 = Get-A2OFileSha256 -Path $PSCommandPath
    }
    files = $files
    signature = [ordered]@{
      algorithm = 'HMAC-SHA-256'
      keyId = $signingMaterial.KeyId
      value = ''
    }
  }
  $manifest.signature.value = Get-A2OHmacSha256 -Text (Get-A2OBackupSignaturePayload -Manifest $manifest) -KeyBytes $signingMaterial.KeyBytes
  $manifestJson = ($manifest | ConvertTo-Json -Depth 10) + [Environment]::NewLine
  [System.IO.File]::WriteAllText((Join-Path $staging 'manifest.json'), $manifestJson, [System.Text.UTF8Encoding]::new($false))

  Add-Type -AssemblyName System.IO.Compression
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $archiveStream = [System.IO.File]::Open($partialArchivePath, [System.IO.FileMode]::CreateNew, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)
  $archive = [System.IO.Compression.ZipArchive]::new($archiveStream, [System.IO.Compression.ZipArchiveMode]::Create, $false)
  try {
    foreach ($file in @(Get-ChildItem -LiteralPath $staging -File -Recurse | Sort-Object FullName)) {
      $entryName = Get-A2ORelativePath -BasePath $staging -ChildPath $file.FullName
      if ($entryName.Contains('\')) { throw "Backup entry paths must use forward slashes: $entryName" }
      $entry = $archive.CreateEntry($entryName, [System.IO.Compression.CompressionLevel]::Optimal)
      $inputStream = [System.IO.File]::Open($file.FullName, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::Read)
      $entryStream = $entry.Open()
      try { $inputStream.CopyTo($entryStream) }
      finally { $entryStream.Dispose(); $inputStream.Dispose() }
    }
  } finally {
    $archive.Dispose()
  }

  # Validate the exact closed partial archive before making its final name
  # visible. Restore uses the same signature, inventory, and stream bounds that
  # an operator recovery will use later.
  $validationOutput = @(& (Join-Path $PSScriptRoot 'Restore-A2OWorkspace.ps1') -BackupPath $partialArchivePath -ValidationOnly -PassThru)
  $validationResults = @($validationOutput | Where-Object { $_ -and $_.PSTypeNames -contains 'A2O.LocalBackupValidationResult' })
  if ($validationResults.Count -ne 1) { throw 'The completed backup did not produce exactly one trusted validation result.' }
  $validation = $validationResults[0]
  $partialSha256 = Get-A2OFileSha256 -Path $partialArchivePath
  if ($validation.SchemaVersion -ne 4 -or $validation.ArchiveSha256 -ne $partialSha256 -or $validation.SignerKeyId -ne $signingMaterial.KeyId -or $validation.ActiveGitCommit -ne $activeRelease.gitCommit -or $validation.ProvenanceMode -ne $activeRelease.provenanceMode) {
    throw 'The completed backup validation result did not match the archive that was produced.'
  }

  [System.IO.File]::Move($partialArchivePath, $archivePath)
  $finalArchiveCreated = $true
  $archiveSha256 = Get-A2OFileSha256 -Path $archivePath
  if ($archiveSha256 -ne $partialSha256) { throw 'The finalized backup no longer matches the archive that passed validation.' }
  $archiveCompleted = $true
  $result = [pscustomobject]@{
    PSTypeName = 'A2O.LocalBackupResult'
    ArchivePath = $archivePath
    ArchiveSha256 = $archiveSha256
    SchemaVersion = 4
    SignerKeyId = $signingMaterial.KeyId
    ProvenanceMode = $activeRelease.provenanceMode
    ActiveGitCommit = $activeRelease.gitCommit
    CreatedAtUnixMs = [long]$manifest.createdAtUnixMs
  }
  if ($PassThru) {
    Write-Output $result
  } else {
    Write-Output "Backup created and recovery-validated: $archivePath"
    Write-Output "Backup SHA-256: $archiveSha256"
    Write-Output "Backup signer: $($signingMaterial.KeyId)"
    Write-Output "Backed active release: $($activeRelease.gitCommit)"
    Write-Output 'Copy this ZIP to an approved backup location.'
  }
} finally {
  Pop-Location
  if (Test-Path -LiteralPath $staging) {
    Remove-Item -LiteralPath $staging -Recurse -Force
  }
  if (Test-Path -LiteralPath $partialArchivePath -PathType Leaf) {
    [System.IO.File]::Delete($partialArchivePath)
  }
  if ($finalArchiveCreated -and -not $archiveCompleted -and (Test-Path -LiteralPath $archivePath -PathType Leaf)) {
    [System.IO.File]::Delete($archivePath)
  }
}
