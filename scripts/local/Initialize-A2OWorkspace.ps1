[CmdletBinding()]
param([switch]$Install)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Common-A2OWorkspace.ps1')
$projectRoot = Get-A2OProjectRoot

Push-Location $projectRoot
try {
  Assert-A2ONodeVersion

  if (-not (Test-Path -LiteralPath '.env')) {
    Copy-Item -LiteralPath '.env.example' -Destination '.env'
    Write-Output 'Created .env with demonstration data disabled.'
  }

  if ($Install -or -not (Test-Path -LiteralPath 'node_modules')) {
    Invoke-A2OCommand { npm ci } 'Dependency installation failed.'
  } else {
    Write-Output 'Dependencies are present; skipping installation.'
  }

  $statePath = Join-Path $projectRoot '.wrangler\state'
  if (Test-Path -LiteralPath $statePath) {
    Assert-A2ONoPendingMigrations
  } else {
    Invoke-A2OCommand {
      npx --no-install wrangler d1 migrations apply DB --config wrangler.local-runtime.jsonc --local --persist-to .wrangler/state
    } 'Local database migration failed.'
  }

  Write-Output 'A2O local workspace initialized.'
  Write-Output 'Next: npm run local:verify'
  Write-Output 'Then: npm run local:start'
} finally {
  Pop-Location
}
