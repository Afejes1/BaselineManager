[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Common-A2OWorkspace.ps1')
$projectRoot = Get-A2OProjectRoot
$backupRoot = Assert-A2OProjectPath -Candidate (Join-Path $projectRoot 'backups') -ProjectRoot $projectRoot
$backupPath = $null

Push-Location $projectRoot
try {
  Assert-A2ONodeVersion
  Assert-A2ORuntimeStopped
  Assert-A2OCleanSource
  foreach ($required in @('node_modules','.env','.wrangler/state','wrangler.local-runtime.jsonc','drizzle')) {
    if (-not (Test-Path -LiteralPath $required)) { throw "Required update input is missing: $required" }
  }
  $environmentText = Get-Content -Raw -LiteralPath '.env'
  if ($environmentText -notmatch '(?m)^\s*DEMO_ENABLED\s*=\s*["'']?false["'']?\s*$') {
    throw 'DEMO_ENABLED must be false before updating a program-data workspace.'
  }

  $existing = @(Get-ChildItem -LiteralPath $backupRoot -Filter 'a2o-workspace-*.zip' -File -ErrorAction SilentlyContinue | Select-Object -ExpandProperty FullName)
  & (Join-Path $PSScriptRoot 'Backup-A2OWorkspace.ps1') -OutputDirectory $backupRoot
  $created = @(Get-ChildItem -LiteralPath $backupRoot -Filter 'a2o-workspace-*.zip' -File | Where-Object { $_.FullName -notin $existing } | Sort-Object LastWriteTimeUtc -Descending)
  if (-not $created.Count -or $created[0].Length -le 0) { throw 'The required pre-update backup was not created. No migration was attempted.' }
  $backupPath = $created[0].FullName

  Invoke-A2OCommand {
    npx --no-install wrangler d1 migrations apply DB --config wrangler.local-runtime.jsonc --local --persist-to .wrangler/state
  } "Workspace migration failed. The pre-update backup remains at $backupPath"
  Assert-A2ONoPendingMigrations
  Invoke-A2OCommand { npm run build } "Application rebuild failed. The pre-update backup remains at $backupPath"
  & (Join-Path $PSScriptRoot 'Test-A2OWorkspace.ps1') -SkipBuild

  Write-Output 'A2O local workspace update completed and verified.'
  Write-Output "Recovery backup: $backupPath"
} catch {
  if ($backupPath) { Write-Warning "Update did not complete. Stop here and restore the verified backup if needed: $backupPath" }
  throw
} finally {
  Pop-Location
}
