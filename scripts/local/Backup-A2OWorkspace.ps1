[CmdletBinding()]
param([string]$OutputDirectory)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Common-A2OWorkspace.ps1')
$projectRoot = Get-A2OProjectRoot
if (-not $OutputDirectory) { $OutputDirectory = Join-Path $projectRoot 'backups' }

$backupRoot = Assert-A2OProjectPath -Candidate $OutputDirectory -ProjectRoot $projectRoot
$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$staging = Assert-A2OProjectPath -Candidate (Join-Path $backupRoot ".staging-$timestamp-$PID") -ProjectRoot $projectRoot
$archivePath = Assert-A2OProjectPath -Candidate (Join-Path $backupRoot "a2o-workspace-$timestamp.zip") -ProjectRoot $projectRoot
$statePath = Join-Path $projectRoot '.wrangler\state'

New-Item -ItemType Directory -Force -Path $backupRoot | Out-Null
New-Item -ItemType Directory -Force -Path $staging | Out-Null

Push-Location $projectRoot
try {
  if (-not (Test-Path -LiteralPath $statePath)) {
    throw 'No local workspace state exists. Initialize and use the application before backing it up.'
  }

  $sqlPath = Join-Path $staging 'database.sql'
  Invoke-A2OCommand {
    npx --no-install wrangler d1 export DB --local "--output=$sqlPath"
  } 'The readable D1 database export failed.'

  Copy-Item -LiteralPath $statePath -Destination (Join-Path $staging 'state') -Recurse
  $manifest = [ordered]@{
    product = 'A2O Technical Baseline Manager'
    createdAt = (Get-Date).ToString('o')
    computer = $env:COMPUTERNAME
    databaseExport = 'database.sql'
    stateDirectory = 'state'
    gitCommit = (& git rev-parse --short HEAD 2>$null)
  }
  $manifest | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $staging 'manifest.json') -Encoding UTF8

  Add-Type -AssemblyName System.IO.Compression.FileSystem
  [System.IO.Compression.ZipFile]::CreateFromDirectory($staging, $archivePath)
  Write-Output "Backup created: $archivePath"
  Write-Output 'Copy this ZIP to an approved backup location.'
} finally {
  Pop-Location
  if (Test-Path -LiteralPath $staging) {
    Remove-Item -LiteralPath $staging -Recurse -Force
  }
}
