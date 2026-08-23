[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][string]$BackupPath,
  [switch]$Force,
  [switch]$AllowLegacyUnverified
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Common-A2OWorkspace.ps1')
$projectRoot = Get-A2OProjectRoot
if (-not $Force) {
  throw 'Restore replaces the active local state. Stop the application and rerun with -Force.'
}

$resolvedBackup = (Resolve-Path -LiteralPath $BackupPath).Path
if ([System.IO.Path]::GetExtension($resolvedBackup) -ne '.zip') {
  throw 'BackupPath must identify an A2O workspace ZIP backup.'
}

$wranglerRoot = Assert-A2OProjectPath -Candidate (Join-Path $projectRoot '.wrangler') -ProjectRoot $projectRoot
$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$staging = Assert-A2OProjectPath -Candidate (Join-Path $wranglerRoot "restore-staging-$timestamp-$PID") -ProjectRoot $projectRoot
$activeState = Assert-A2OProjectPath -Candidate (Join-Path $wranglerRoot 'state') -ProjectRoot $projectRoot
$recoveryState = Assert-A2OProjectPath -Candidate (Join-Path $wranglerRoot "state.pre-restore-$timestamp") -ProjectRoot $projectRoot

New-Item -ItemType Directory -Force -Path $wranglerRoot | Out-Null
New-Item -ItemType Directory -Force -Path $staging | Out-Null

try {
  Assert-A2ORuntimeStopped
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $archive = [System.IO.Compression.ZipFile]::OpenRead($resolvedBackup)
  try {
    foreach ($entry in $archive.Entries) {
      $destination = [System.IO.Path]::GetFullPath((Join-Path $staging $entry.FullName))
      $stagingPrefix = $staging.TrimEnd('\') + '\'
      if (-not $destination.StartsWith($stagingPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Unsafe archive entry: $($entry.FullName)"
      }
    }
  } finally {
    $archive.Dispose()
  }

  [System.IO.Compression.ZipFile]::ExtractToDirectory($resolvedBackup, $staging)
  $manifestPath = Join-Path $staging 'manifest.json'
  if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) { throw 'The selected ZIP does not contain an A2O backup manifest.' }
  try { $manifest = Get-Content -Raw -LiteralPath $manifestPath | ConvertFrom-Json }
  catch { throw 'The selected ZIP contains an invalid A2O backup manifest.' }
  if ($manifest.product -ne 'A2O Technical Baseline Manager') { throw 'The selected ZIP is not an A2O workspace backup.' }
  if ($manifest.schemaVersion -eq 2) {
    $declared = @{}
    $stagingPrefix = $staging.TrimEnd('\') + '\'
    foreach ($entry in @($manifest.files)) {
      if (-not $entry.path -or $declared.ContainsKey([string]$entry.path)) { throw 'The backup manifest contains a missing or duplicate file path.' }
      $absolute = [System.IO.Path]::GetFullPath((Join-Path $staging ([string]$entry.path)))
      if (-not $absolute.StartsWith($stagingPrefix, [System.StringComparison]::OrdinalIgnoreCase)) { throw "Unsafe backup manifest path: $($entry.path)" }
      if (-not (Test-Path -LiteralPath $absolute -PathType Leaf)) { throw "A declared backup file is missing: $($entry.path)" }
      $file = Get-Item -LiteralPath $absolute
      $hash = Get-A2OFileSha256 -Path $absolute
      if ([long]$entry.bytes -ne $file.Length -or [string]$entry.sha256 -ne $hash) { throw "Backup integrity validation failed: $($entry.path)" }
      $declared[[string]$entry.path] = $true
    }
    if (-not $declared.Count) { throw 'The backup manifest does not contain an integrity inventory.' }
    $actual = @(Get-ChildItem -LiteralPath $staging -File -Recurse | Where-Object { $_.FullName -ne $manifestPath } | ForEach-Object {
      Get-A2ORelativePath -BasePath $staging -ChildPath $_.FullName
    })
    $unexpected = @($actual | Where-Object { -not $declared.ContainsKey($_) })
    if ($actual.Count -ne $declared.Count -or $unexpected.Count) { throw "The backup contains files outside its integrity manifest: $($unexpected -join ', ')" }
  } elseif (-not $AllowLegacyUnverified) {
    throw 'This older backup has no cryptographic file inventory. Re-run with -AllowLegacyUnverified only after independently validating its origin.'
  } else {
    Write-Warning 'Restoring a legacy backup without a cryptographic file inventory.'
  }
  $restoredState = Join-Path $staging 'state'
  if (-not (Test-Path -LiteralPath $restoredState -PathType Container)) {
    throw 'The selected ZIP does not contain an A2O workspace state directory.'
  }

  if (Test-Path -LiteralPath $activeState) {
    Assert-A2OStateUnlocked -StatePath $activeState
    [System.IO.Directory]::Move($activeState, $recoveryState)
    Write-Output "Current state preserved at: $recoveryState"
  }
  [System.IO.Directory]::Move($restoredState, $activeState)
  Write-Output "Workspace restored from: $resolvedBackup"
  Write-Output 'Next: npm run local:update (if migrations are pending), then npm run local:verify:fast.'
} finally {
  if (Test-Path -LiteralPath $staging) {
    Remove-Item -LiteralPath $staging -Recurse -Force
  }
}
