[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Common-A2OWorkspace.ps1')
$projectRoot = Get-A2OProjectRoot

Push-Location $projectRoot
try {
  Assert-A2ONodeVersion
  if (-not (Test-Path -LiteralPath 'node_modules')) {
    throw 'Dependencies are not installed. Run npm run local:init first.'
  }
  if (-not (Test-Path -LiteralPath '.env')) {
    throw '.env is missing. Run npm run local:init first.'
  }

  Invoke-A2OCommand {
    npx --no-install wrangler d1 migrations apply DB --local
  } 'Local database migration failed.'

  Write-Output 'Starting the A2O Technical Baseline Manager on localhost only.'
  Invoke-A2OCommand { npm run dev } 'The local application stopped with an error.'
} finally {
  Pop-Location
}
