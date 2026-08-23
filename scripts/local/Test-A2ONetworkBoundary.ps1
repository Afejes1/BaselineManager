[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Common-A2OWorkspace.ps1')
$projectRoot = Get-A2OProjectRoot

# This is a deliberate source-boundary check. It is not a packet capture: it
# prevents the common ways a future application change could introduce an
# outbound browser or server request. The only allowed URL literal is the
# inert app.local parsing origin used to validate internal return paths.
$targets = @(
  'app',
  'components',
  'lib',
  'worker',
  'vite.config.ts',
  'next.config.ts',
  'wrangler.jsonc',
  'wrangler.local-runtime.jsonc',
  'package.json'
)
$extensions = @('.ts', '.tsx', '.js', '.mjs', '.cjs', '.json')
$rules = @(
  @{ Name = 'external URL literal'; Pattern = 'https?://(?!app\.local(?:[\/"''`]|$))' },
  @{ Name = 'browser network client'; Pattern = '\b(?:axios|XMLHttpRequest|WebSocket|EventSource|sendBeacon)\b' },
  @{ Name = 'server network client'; Pattern = '\b(?:node:(?:https|http|net|tls|dns|dgram)|https?\.(?:request|get)|net\.connect|tls\.connect|dns\.(?:lookup|resolve))\b' },
  @{ Name = 'absolute fetch target'; Pattern = '\bfetch\s*\(\s*(?:["''`])\s*https?://' }
)

$files = foreach ($target in $targets) {
  $candidate = Join-Path $projectRoot $target
  if (-not (Test-Path -LiteralPath $candidate)) { continue }

  if ((Get-Item -LiteralPath $candidate).PSIsContainer) {
    Get-ChildItem -LiteralPath $candidate -Recurse -File |
      Where-Object { $_.Extension -in $extensions }
  } else {
    Get-Item -LiteralPath $candidate
  }
}

$findings = [System.Collections.Generic.List[string]]::new()
foreach ($file in ($files | Sort-Object FullName -Unique)) {
  $relativePath = $file.FullName.Substring($projectRoot.Length).TrimStart('\', '/')
  $lines = Get-Content -LiteralPath $file.FullName

  for ($index = 0; $index -lt $lines.Count; $index++) {
    foreach ($rule in $rules) {
      # CSP frame-ancestors only constrains who may embed the application; it
      # cannot initiate an outbound request. Ignore that directive while still
      # scanning every fetch-capable CSP directive and the remainder of the line.
      $candidateLine = if ($rule.Name -eq 'external URL literal') {
        $lines[$index] -replace 'frame-ancestors\s+[^;]*;', 'frame-ancestors;'
      } else {
        $lines[$index]
      }
      if ($rule.Name -eq 'external URL literal' -and $candidateLine -match '^\s*const\s+frameAncestors\s*=') {
        $candidateLine = ''
      }
      if ($candidateLine -match $rule.Pattern) {
        $findings.Add("${relativePath}:$($index + 1) [$($rule.Name)] $($lines[$index].Trim())")
      }
    }
  }
}

if ($findings.Count -gt 0) {
  Write-Output 'Outbound network boundary check failed. Review the following source locations:'
  $findings | ForEach-Object { Write-Output " - $_" }
  throw 'Outbound network source checks failed.'
}

Write-Output 'A2O outbound network boundary check passed.'
Write-Output 'Checked application source and runtime configuration for external URL literals and network clients.'
