[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Common-A2OWorkspace.ps1')
$projectRoot = Get-A2OProjectRoot
$backupRoot = Assert-A2OProjectPath -Candidate (Join-Path $projectRoot 'backups') -ProjectRoot $projectRoot
$backupPath = $null

Push-Location $projectRoot
try {
  Assert-A2ONodeVersion
  Assert-A2ORuntimeStopped
  Assert-A2OCleanSource
  foreach ($required in @('node_modules','.env','.wrangler/state','wrangler.local-runtime.jsonc','drizzle')) {
    if (-not (Test-Path -LiteralPath $required)) { throw "Required update input is missing: $required" }
  }
  $environmentText = Get-Content -Raw -LiteralPath '.env'
  if ($environmentText -notmatch '(?m)^\s*AUTH_MODE\s*=\s*["'']?local-single-user["'']?\s*$') {
    throw 'AUTH_MODE must be local-single-user before updating a local workspace.'
  }
  if ($environmentText -notmatch '(?m)^\s*DEMO_ENABLED\s*=\s*["'']?false["'']?\s*$') {
    throw 'DEMO_ENABLED must be false before updating a program-data workspace.'
  }
  if ($environmentText -notmatch '(?m)^\s*WORKSPACE_TRANSFER_MODE\s*=\s*["'']?local["'']?\s*$') {
    throw 'WORKSPACE_TRANSFER_MODE must be local before updating a local workspace.'
  }
  $null = Assert-A2OTransferSigningMaterial

  $backupOutput = @(& (Join-Path $PSScriptRoot 'Backup-A2OWorkspace.ps1') -OutputDirectory $backupRoot -PassThru)
  $backupResults = @($backupOutput | Where-Object { $_ -and $_.PSTypeNames -contains 'A2O.LocalBackupResult' })
  if ($backupResults.Count -ne 1) { throw 'The required pre-update backup did not return exactly one trusted archive result. No migration was attempted.' }
  $backupResult = $backupResults[0]
  $backupPath = (Resolve-Path -LiteralPath $backupResult.ArchivePath).Path

  # Consume and revalidate the exact archive returned by the backup command.
  # Directory timestamps or an unrelated concurrently copied ZIP never select
  # the recovery point for this update.
  $validationOutput = @(& (Join-Path $PSScriptRoot 'Restore-A2OWorkspace.ps1') -BackupPath $backupPath -ValidationOnly -PassThru)
  $validationResults = @($validationOutput | Where-Object { $_ -and $_.PSTypeNames -contains 'A2O.LocalBackupValidationResult' })
  if ($validationResults.Count -ne 1) { throw "The pre-update recovery archive did not return exactly one validation result: $backupPath" }
  $validation = $validationResults[0]
  if ($validation.ArchiveSha256 -ne $backupResult.ArchiveSha256 -or
      $validation.SchemaVersion -ne $backupResult.SchemaVersion -or
      $validation.SignerKeyId -ne $backupResult.SignerKeyId -or
      $validation.ProvenanceMode -ne $backupResult.ProvenanceMode -or
      $validation.ActiveGitCommit -ne $backupResult.ActiveGitCommit -or
      -not [string]::Equals($validation.ArchivePath, $backupPath, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "The pre-update recovery archive changed or failed its exact handoff validation: $backupPath"
  }

  Invoke-A2OCommand {
    npx --no-install wrangler d1 migrations apply DB --config wrangler.local-runtime.jsonc --local --persist-to .wrangler/state
  } "Workspace migration failed. The pre-update backup remains at $backupPath"
  Assert-A2ONoPendingMigrations
  Invoke-A2OCommand { npm run build } "Application rebuild failed. The pre-update backup remains at $backupPath"
  & (Join-Path $PSScriptRoot 'Test-A2OWorkspace.ps1') -SkipBuild

  Write-Output 'A2O local workspace update completed and verified.'
  Write-Output "Recovery backup: $backupPath"
} catch {
  if ($backupPath) { Write-Warning "Update did not complete. Stop here and restore the verified backup if needed: $backupPath" }
  throw
} finally {
  Pop-Location
}
