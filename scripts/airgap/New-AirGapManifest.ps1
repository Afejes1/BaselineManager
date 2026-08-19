[CmdletBinding()]
param(
  [Parameter()][string]$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path,
  [Parameter()][string]$OutputDirectory = (Join-Path (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path 'artifacts\airgap')
)

$ErrorActionPreference = 'Stop'
$resolvedRoot = (Resolve-Path -LiteralPath $ProjectRoot).Path
if (-not (Test-Path -LiteralPath (Join-Path $resolvedRoot 'package-lock.json'))) { throw 'package-lock.json is required.' }
if (-not (Test-Path -LiteralPath (Join-Path $resolvedRoot 'dist'))) { throw 'Run npm run build before creating the manifest.' }
New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null
$resolvedOutput = (Resolve-Path -LiteralPath $OutputDirectory).Path
if (-not $resolvedOutput.StartsWith($resolvedRoot, [System.StringComparison]::OrdinalIgnoreCase)) { throw 'OutputDirectory must remain inside ProjectRoot.' }

$includedRoots = @('dist','drizzle','docs','scripts\airgap')
$files = foreach ($relativeRoot in $includedRoots) {
  $target = Join-Path $resolvedRoot $relativeRoot
  if (Test-Path -LiteralPath $target) { Get-ChildItem -LiteralPath $target -File -Recurse }
}
$files += Get-Item -LiteralPath (Join-Path $resolvedRoot 'package.json'), (Join-Path $resolvedRoot 'package-lock.json'), (Join-Path $resolvedRoot 'wrangler.jsonc')
$manifest = $files | Sort-Object FullName -Unique | ForEach-Object {
  [pscustomobject]@{
    Path = $_.FullName.Substring($resolvedRoot.Length + 1).Replace('\','/')
    Bytes = $_.Length
    SHA256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
  }
}
$manifest | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $resolvedOutput 'sha256-manifest.json') -Encoding utf8
npm ls --omit=dev --json | Set-Content -LiteralPath (Join-Path $resolvedOutput 'production-dependencies.json') -Encoding utf8
Write-Output "Air-gap manifest written to $resolvedOutput"

