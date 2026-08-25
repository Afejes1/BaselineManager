[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Common-A2OWorkspace.ps1')
$projectRoot = Get-A2OProjectRoot

# This is a deliberate source-boundary check. It is not a packet capture: it
# prevents the common ways a future application change could introduce an
# outbound browser or server request. The only general URL literal exception is
# the inert app.local parsing origin used to validate internal return paths.
# A few exact OpenXML namespace comparisons are also accepted below; those are
# document-format identifiers, not addresses used by a network client.
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

function Test-A2OInertStandardsIdentifierLine {
  param(
    [Parameter(Mandatory = $true)][string]$RelativePath,
    [Parameter(Mandatory = $true)][AllowEmptyString()][string]$Line
  )

  if (($RelativePath -replace '\\', '/') -ne 'lib/evidence-validation.ts') { return $false }

  $approvedOpenXmlComparisons = @(
    '^\s*if \(!contentTypesRoot \|\| officeXmlAttribute\(contentTypesRoot\[1\], "xmlns"\) !== "http://schemas\.openxmlformats\.org/package/2006/content-types"\) throw new EvidenceValidationError\("The Office package content-type manifest is invalid\."\);\s*$',
    '^\s*if \(!packageRelationshipsRoot \|\| officeXmlAttribute\(packageRelationshipsRoot\[1\], "xmlns"\) !== "http://schemas\.openxmlformats\.org/package/2006/relationships"\) throw new EvidenceValidationError\("The Office package relationship manifest is invalid\."\);\s*$',
    '^\s*if \(!rootMatch \|\| !\[`http://schemas\.openxmlformats\.org/\$\{transitionalNamespacePath\}`, `http://purl\.oclc\.org/ooxml/\$\{strictNamespacePath\}`\]\.includes\(namespace \|\| ""\)\) throw new EvidenceValidationError\("The Office package main part does not contain the expected document root and namespace\."\);\s*$'
  )

  return [bool]($approvedOpenXmlComparisons | Where-Object { $Line -match $_ } | Select-Object -First 1)
}

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
      if ($rule.Name -eq 'external URL literal' -and (Test-A2OInertStandardsIdentifierLine -RelativePath $relativePath -Line $candidateLine)) {
        $candidateLine = ''
      }
      if ($candidateLine -match $rule.Pattern) {
        $findings.Add("${relativePath}:$($index + 1) [$($rule.Name)] $($lines[$index].Trim())")
      }
    }
  }
}

$commonWorkspaceScript = Get-Content -Raw -LiteralPath (Join-Path $projectRoot 'scripts\local\Common-A2OWorkspace.ps1')
if ($commonWorkspaceScript -notmatch '\$env:CLOUDFLARE_CF_FETCH_ENABLED\s*=\s*''false''') {
  $findings.Add('scripts\\local\\Common-A2OWorkspace.ps1 [local runtime policy] Request.cf network metadata fetching must be disabled.')
}
if ($commonWorkspaceScript -notmatch '\$env:WRANGLER_SEND_METRICS\s*=\s*''false''' -or $commonWorkspaceScript -notmatch '\$env:DO_NOT_TRACK\s*=\s*''1''') {
  $findings.Add('scripts\\local\\Common-A2OWorkspace.ps1 [local runtime policy] Wrangler telemetry must be disabled.')
}
$startWorkspaceScript = Get-Content -Raw -LiteralPath (Join-Path $projectRoot 'scripts\local\Start-A2OWorkspace.ps1')
if ($startWorkspaceScript -match '(?i)--(?:remote|tunnel)(?:\s|$)') {
  $findings.Add('scripts\\local\\Start-A2OWorkspace.ps1 [local runtime policy] Remote execution and tunnels are not permitted in the local operator runtime.')
}

# The optional GenAI.mil adapter is the single deliberate exception to the
# air-gapped default. It must have no default endpoint, accept only an approved
# HTTPS GenAI.mil host, and be invoked only through its explicit assistant
# route. This is intentionally a source-control check rather than a network
# probe: a disabled or expired key must never result in a background call.
$genaiAdapterPath = Join-Path $projectRoot 'lib\genai-mil.ts'
if (-not (Test-Path -LiteralPath $genaiAdapterPath)) {
  $findings.Add('lib\genai-mil.ts [GenAI.mil policy] The approved outbound adapter is missing.')
} else {
  $genaiAdapter = Get-Content -Raw -LiteralPath $genaiAdapterPath
  foreach ($required in @(
    'GENAI_MIL_API_URL',
    'GENAI_MIL_API_KEY',
    'GENAI_MIL_MODEL',
    'endpoint\.protocol !== "https:"',
    'host === "genai\.mil"',
    'host\.endsWith\("\.genai\.mil"\)',
    'not_configured',
    'Re-enable or refresh the key',
    'NODE_EXTRA_CA_CERTS'
  )) {
    if ($genaiAdapter -notmatch $required) { $findings.Add("lib\\genai-mil.ts [GenAI.mil policy] Required opt-in control is missing: $required") }
  }
  if ($genaiAdapter -match 'GENAI_MIL_API_URL\s*[:=]\s*["'']https?://') {
    $findings.Add('lib\genai-mil.ts [GenAI.mil policy] A default GenAI.mil endpoint is not permitted; configuration must be operator-supplied.')
  }
}

if ($findings.Count -gt 0) {
  Write-Output 'Outbound network boundary check failed. Review the following source locations:'
  $findings | ForEach-Object { Write-Output " - $_" }
  throw 'Outbound network source checks failed.'
}

Write-Output 'A2O outbound network boundary check passed.'
Write-Output 'Checked application source and runtime configuration for external URL literals, network clients, and the explicit GenAI.mil opt-in adapter.'
