[CmdletBinding()]
param([switch]$SkipBuild)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Common-A2OWorkspace.ps1')
$projectRoot = Get-A2OProjectRoot

Push-Location $projectRoot
try {
  Assert-A2ONodeVersion
  foreach ($required in @('package.json','package-lock.json','wrangler.jsonc','.env','drizzle')) {
    if (-not (Test-Path -LiteralPath $required)) { throw "Required local runtime input is missing: $required" }
  }
  if (-not (Test-Path -LiteralPath 'node_modules')) {
    throw 'Dependencies are not installed. Run npm run local:init first.'
  }

  $environmentText = Get-Content -Raw -LiteralPath '.env'
  if ($environmentText -notmatch '(?m)^\s*DEMO_ENABLED\s*=\s*["'']?false["'']?\s*$') {
    throw 'DEMO_ENABLED must be false before using program data.'
  }

  Invoke-A2OCommand {
    npx --no-install wrangler d1 migrations apply DB --local
  } 'Local database migration check failed.'
  Invoke-A2OCommand {
    npx --no-install wrangler d1 execute DB --local --command "SELECT name FROM sqlite_master WHERE type='table' AND name='baseline_occurrence';"
  } 'Local database access check failed.'

  if (-not $SkipBuild) {
    Invoke-A2OCommand { npm run build } 'Application build verification failed.'
  }

  Write-Output 'A2O local workspace verification passed.'
  Write-Output 'Scope: local configuration, migrations, database access, and application build.'
} finally {
  Pop-Location
}
