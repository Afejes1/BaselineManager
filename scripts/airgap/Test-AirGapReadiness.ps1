[CmdletBinding()]
param([Parameter()][string]$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path)

$ErrorActionPreference = 'Stop'
$resolvedRoot = (Resolve-Path -LiteralPath $ProjectRoot).Path
$required = @('package.json','package-lock.json','wrangler.jsonc','dist','drizzle','docs\AIR_GAP_READINESS.md')
$missing = $required | Where-Object { -not (Test-Path -LiteralPath (Join-Path $resolvedRoot $_)) }
if ($missing) { throw "Missing required air-gap inputs: $($missing -join ', ')" }

Push-Location $resolvedRoot
try {
  npm run build
  if ($LASTEXITCODE -ne 0) { throw 'Build failed.' }
  npm run test:contract
  if ($LASTEXITCODE -ne 0) { throw 'Contract tests failed.' }
  npm run lint
  if ($LASTEXITCODE -ne 0) { throw 'Lint failed.' }
  Write-Output 'Code-level air-gap readiness checks passed. Environment-specific database, object storage, identity, TLS, and backup acceptance gates remain.'
} finally { Pop-Location }

