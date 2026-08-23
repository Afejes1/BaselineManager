[CmdletBinding()]
param([switch]$SkipBuild)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Common-A2OWorkspace.ps1')
$projectRoot = Get-A2OProjectRoot

Push-Location $projectRoot
try {
  Assert-A2ONodeVersion
  foreach ($required in @('package.json','package-lock.json','wrangler.jsonc','wrangler.local-runtime.jsonc','.env','drizzle')) {
    if (-not (Test-Path -LiteralPath $required)) { throw "Required local runtime input is missing: $required" }
  }
  if (-not (Test-Path -LiteralPath 'node_modules')) {
    throw 'Dependencies are not installed. Run npm run local:init first.'
  }

  $environmentText = Get-Content -Raw -LiteralPath '.env'
  if ($environmentText -notmatch '(?m)^\s*AUTH_MODE\s*=\s*["'']?local-single-user["'']?\s*$') {
    throw 'AUTH_MODE must be local-single-user in the local operator runtime.'
  }
  if ($environmentText -notmatch '(?m)^\s*DEMO_ENABLED\s*=\s*["'']?false["'']?\s*$') {
    throw 'DEMO_ENABLED must be false before using program data.'
  }
  if ($environmentText -notmatch '(?m)^\s*WORKSPACE_TRANSFER_MODE\s*=\s*["'']?local["'']?\s*$') {
    throw 'WORKSPACE_TRANSFER_MODE must be local in the local operator runtime.'
  }
  $null = Assert-A2OTransferSigningMaterial
  & (Join-Path $PSScriptRoot 'Test-A2OSigningControls.ps1')
  try { $localRuntime = Get-Content -Raw -LiteralPath 'wrangler.local-runtime.jsonc' | ConvertFrom-Json }
  catch { throw 'wrangler.local-runtime.jsonc is not valid JSON.' }
  if ($localRuntime.vars.AUTH_MODE -ne 'local-single-user' -or $localRuntime.vars.DEMO_ENABLED -ne 'false' -or $localRuntime.vars.WORKSPACE_TRANSFER_MODE -ne 'local') {
    throw 'The effective local Worker runtime policy does not match the hardened local profile.'
  }

  & (Join-Path $PSScriptRoot 'Test-A2ONetworkBoundary.ps1')

  Assert-A2ONoPendingMigrations
  Invoke-A2OCommand {
    npx --no-install wrangler d1 execute DB --config wrangler.local-runtime.jsonc --local --persist-to .wrangler/state --command "SELECT name FROM sqlite_master WHERE type='table' AND name='baseline_occurrence';"
  } 'Local database access check failed.'

  if (-not $SkipBuild) {
    Invoke-A2OCommand { npm run build } 'Application build verification failed.'
  }
  Assert-A2OBuildManifest
  $null = Set-A2OCurrentActiveReleaseProvenance

  Write-Output 'A2O local workspace verification passed.'
  Write-Output 'Scope: local configuration, migrations, database access, exact source provenance, and runtime-file integrity.'
} finally {
  Pop-Location
}
