Set-StrictMode -Version Latest

$script:A2OProjectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$env:WRANGLER_WRITE_LOGS = 'false'
$env:WRANGLER_LOG_PATH = Join-Path $script:A2OProjectRoot '.wrangler\logs'
$env:WRANGLER_SEND_METRICS = 'false'
$env:DO_NOT_TRACK = '1'
$env:npm_config_cache = Join-Path $script:A2OProjectRoot '.npm-cache'
# Do not make optional npm audit, funding, or update-notification calls during
# local setup. Package acquisition is still an explicit operator action.
$env:npm_config_audit = 'false'
$env:npm_config_fund = 'false'
$env:npm_config_update_notifier = 'false'
$env:npm_config_prefer_offline = 'true'

function Get-A2OProjectRoot {
  return $script:A2OProjectRoot
}

function Assert-A2ONodeVersion {
  $rawVersion = (& node --version 2>$null)
  if ($LASTEXITCODE -ne 0 -or -not $rawVersion) {
    throw 'Node.js is required. Install Node.js 22.13.0 or newer.'
  }

  $normalized = ([string]$rawVersion).Trim().TrimStart('v')
  try { $installed = [version]$normalized } catch {
    throw "Unable to read the installed Node.js version: $rawVersion"
  }
  $minimum = [version]'22.13.0'
  if ($installed -lt $minimum) {
    throw "Node.js $minimum or newer is required. Installed: $installed"
  }
  Write-Output "Node.js $installed"
}

function Invoke-A2OCommand {
  param(
    [Parameter(Mandatory=$true)][scriptblock]$Command,
    [Parameter(Mandatory=$true)][string]$FailureMessage
  )

  & $Command
  if ($LASTEXITCODE -ne 0) { throw $FailureMessage }
}

function Assert-A2ONoPendingMigrations {
  param([string]$PersistTo = '.wrangler/state')

  $migrationFiles = @(Get-ChildItem -LiteralPath (Join-Path $script:A2OProjectRoot 'drizzle') -Filter '*.sql' -File | Select-Object -ExpandProperty Name)
  $migrationJson = (& npx --no-install wrangler d1 execute DB --config wrangler.local-runtime.jsonc --local --persist-to $PersistTo --command 'SELECT name FROM d1_migrations ORDER BY id;' --json) | Out-String
  if ($LASTEXITCODE -ne 0) { throw 'The applied migration set could not be read.' }
  try { $migrationResult = $migrationJson | ConvertFrom-Json } catch { throw 'The applied migration set was not valid JSON.' }
  $applied = @($migrationResult[0].results | ForEach-Object { [string]$_.name })
  $pending = @($migrationFiles | Where-Object { $_ -notin $applied })
  $unexpected = @($applied | Where-Object { $_ -notin $migrationFiles })
  if ($pending.Count -or $unexpected.Count) {
    throw "Migration set mismatch. Pending: $($pending -join ', '); not present in this package: $($unexpected -join ', '). Run the explicit backed-up update procedure before starting."
  }
  Write-Output "Migration set verified: $($applied.Count) applied, none pending."
}

function Assert-A2ORuntimeStopped {
  param([int]$Port = 3000)

  $listeners = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
  if ($listeners.Count) {
    $processIds = @($listeners | Select-Object -ExpandProperty OwningProcess -Unique)
    throw "The A2O runtime must be stopped before this operation. Port $Port is listening (process $($processIds -join ', '))."
  }
}

function Assert-A2OStateUnlocked {
  param([Parameter(Mandatory=$true)][string]$StatePath)
  if (-not (Test-Path -LiteralPath $StatePath -PathType Container)) { return }
  foreach ($file in Get-ChildItem -LiteralPath $StatePath -File -Recurse) {
    $stream = $null
    try {
      $stream = [System.IO.File]::Open($file.FullName, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::None)
    } catch {
      throw "Local workspace state is still open by another process: $($file.FullName). Stop the runtime and retry; no state was moved."
    } finally {
      if ($stream) { $stream.Dispose() }
    }
  }
}

function Assert-A2OCleanSource {
  $status = (& git status --porcelain=v1 --untracked-files=all 2>$null) | Out-String
  if ($LASTEXITCODE -ne 0) { throw 'The Git source state could not be inspected.' }
  if ($status.Trim()) { throw 'The local release source has uncommitted files. Commit or remove them, rebuild, and verify before operating program data.' }
}

function Get-A2ORelativePath {
  param(
    [Parameter(Mandatory=$true)][string]$BasePath,
    [Parameter(Mandatory=$true)][string]$ChildPath
  )
  $base = [System.IO.Path]::GetFullPath($BasePath).TrimEnd('\')
  $child = [System.IO.Path]::GetFullPath($ChildPath)
  $prefix = $base + '\'
  if (-not $child.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase)) { throw "Path is outside its expected base: $child" }
  return $child.Substring($prefix.Length).Replace('\','/')
}

function Get-A2OFileSha256 {
  param([Parameter(Mandatory=$true)][string]$Path)
  $stream = [System.IO.File]::OpenRead((Resolve-Path -LiteralPath $Path).Path)
  $algorithm = [System.Security.Cryptography.SHA256]::Create()
  try {
    return ([System.BitConverter]::ToString($algorithm.ComputeHash($stream))).Replace('-','').ToLowerInvariant()
  } finally {
    $stream.Dispose()
    $algorithm.Dispose()
  }
}

function Assert-A2OBuildManifest {
  $manifestPath = Join-Path $script:A2OProjectRoot 'dist\a2o-build-manifest.json'
  if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
    throw 'The local build provenance manifest is missing. Run npm run local:verify.'
  }
  try { $manifest = Get-Content -Raw -LiteralPath $manifestPath | ConvertFrom-Json }
  catch { throw 'The local build provenance manifest is not valid JSON.' }
  if ($manifest.schemaVersion -ne 1 -or $manifest.product -ne 'A2O Technical Baseline Manager' -or $manifest.sourceState -ne 'clean') {
    throw 'The local build was not produced from a clean, supported A2O source tree.'
  }

  Assert-A2OCleanSource
  $currentCommit = (& git rev-parse HEAD 2>$null).Trim()
  $currentTree = (& git rev-parse 'HEAD^{tree}' 2>$null).Trim()
  if ($LASTEXITCODE -ne 0 -or $manifest.gitCommit -ne $currentCommit -or $manifest.gitTree -ne $currentTree -or $manifest.buildSha -ne $currentCommit) {
    throw 'The built runtime does not match the checked-out A2O release commit. Rebuild and verify this exact source.'
  }

  $distRoot = [System.IO.Path]::GetFullPath((Join-Path $script:A2OProjectRoot 'dist'))
  $allowedRoots = @()
  $allowedRoots += [System.IO.Path]::GetFullPath((Join-Path $distRoot 'server')).TrimEnd('\') + '\'
  $allowedRoots += [System.IO.Path]::GetFullPath((Join-Path $distRoot 'client')).TrimEnd('\') + '\'
  $declared = @{}
  foreach ($entry in @($manifest.files)) {
    if (-not $entry.path -or $declared.ContainsKey([string]$entry.path)) { throw 'The build manifest contains a missing or duplicate runtime path.' }
    $absolute = [System.IO.Path]::GetFullPath((Join-Path $script:A2OProjectRoot ([string]$entry.path)))
    if (-not ($allowedRoots | Where-Object { $absolute.StartsWith($_, [System.StringComparison]::OrdinalIgnoreCase) })) {
      throw "Unsafe build manifest path: $($entry.path)"
    }
    if (-not (Test-Path -LiteralPath $absolute -PathType Leaf)) { throw "A built runtime file is missing: $($entry.path)" }
    $file = Get-Item -LiteralPath $absolute
    $hash = Get-A2OFileSha256 -Path $absolute
    if ([long]$entry.bytes -ne $file.Length -or [string]$entry.sha256 -ne $hash) { throw "A built runtime file failed integrity validation: $($entry.path)" }
    $declared[[string]$entry.path] = $true
  }
  if (-not $declared.Count) { throw 'The build manifest does not declare any runtime files.' }
  $actual = @(Get-ChildItem -LiteralPath (Join-Path $distRoot 'server'),(Join-Path $distRoot 'client') -File -Recurse | ForEach-Object {
    Get-A2ORelativePath -BasePath $script:A2OProjectRoot -ChildPath $_.FullName
  })
  $unexpected = @($actual | Where-Object { -not $declared.ContainsKey($_) })
  if ($actual.Count -ne $declared.Count -or $unexpected.Count) { throw "The built runtime contains files outside its integrity manifest: $($unexpected -join ', ')" }
  Write-Output "Build provenance verified: $currentCommit - $($declared.Count) runtime files."
}

function Assert-A2OProjectPath {
  param(
    [Parameter(Mandatory=$true)][string]$Candidate,
    [Parameter(Mandatory=$true)][string]$ProjectRoot
  )

  $rootWithSeparator = $ProjectRoot.TrimEnd('\') + '\'
  $absolute = [System.IO.Path]::GetFullPath($Candidate)
  if (-not $absolute.StartsWith($rootWithSeparator, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Path must remain inside the project: $absolute"
  }
  return $absolute
}
