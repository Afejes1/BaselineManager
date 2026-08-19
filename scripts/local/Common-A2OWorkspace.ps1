Set-StrictMode -Version Latest

$script:A2OProjectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$env:WRANGLER_WRITE_LOGS = 'false'
$env:WRANGLER_LOG_PATH = Join-Path $script:A2OProjectRoot '.wrangler\logs'
$env:npm_config_cache = Join-Path $script:A2OProjectRoot '.npm-cache'

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
