[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][string]$BackupPath,
  [switch]$Force
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
  $restoredState = Join-Path $staging 'state'
  if (-not (Test-Path -LiteralPath $restoredState -PathType Container)) {
    throw 'The selected ZIP does not contain an A2O workspace state directory.'
  }

  if (Test-Path -LiteralPath $activeState) {
    Move-Item -LiteralPath $activeState -Destination $recoveryState
    Write-Output "Current state preserved at: $recoveryState"
  }
  Move-Item -LiteralPath $restoredState -Destination $activeState
  Write-Output "Workspace restored from: $resolvedBackup"
  Write-Output 'Next: npm run local:verify:fast'
} finally {
  if (Test-Path -LiteralPath $staging) {
    Remove-Item -LiteralPath $staging -Recurse -Force
  }
}
