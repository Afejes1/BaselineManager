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
  Assert-A2ORuntimeStopped
  if (-not (Test-Path -LiteralPath $statePath)) {
    throw 'No local workspace state exists. Initialize and use the application before backing it up.'
  }
  Assert-A2OStateUnlocked -StatePath $statePath

  $sqlPath = Join-Path $staging 'database.sql'
  Invoke-A2OCommand {
    npx --no-install wrangler d1 export DB --config wrangler.local-runtime.jsonc --local "--output=$sqlPath"
  } 'The readable D1 database export failed.'

  Assert-A2OStateUnlocked -StatePath $statePath
  Copy-Item -LiteralPath $statePath -Destination (Join-Path $staging 'state') -Recurse
  $files = @(Get-ChildItem -LiteralPath $staging -File -Recurse | Sort-Object FullName | ForEach-Object {
    [ordered]@{
      path = Get-A2ORelativePath -BasePath $staging -ChildPath $_.FullName
      bytes = $_.Length
      sha256 = Get-A2OFileSha256 -Path $_.FullName
    }
  })
  $manifest = [ordered]@{
    schemaVersion = 2
    product = 'A2O Technical Baseline Manager'
    createdAt = (Get-Date).ToString('o')
    computer = $env:COMPUTERNAME
    databaseExport = 'database.sql'
    stateDirectory = 'state'
    gitCommit = (& git rev-parse HEAD 2>$null)
    gitTree = (& git rev-parse 'HEAD^{tree}' 2>$null)
    files = $files
  }
  $manifest | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $staging 'manifest.json') -Encoding UTF8

  Add-Type -AssemblyName System.IO.Compression.FileSystem
  [System.IO.Compression.ZipFile]::CreateFromDirectory($staging, $archivePath)
  Write-Output "Backup created: $archivePath"
  Write-Output "Backup SHA-256: $(Get-A2OFileSha256 -Path $archivePath)"
  Write-Output 'Copy this ZIP to an approved backup location.'
} finally {
  Pop-Location
  if (Test-Path -LiteralPath $staging) {
    Remove-Item -LiteralPath $staging -Recurse -Force
  }
}
