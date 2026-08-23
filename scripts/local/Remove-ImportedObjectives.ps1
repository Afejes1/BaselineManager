[CmdletBinding()]
param(
  [string]$ExternalSystem,
  [string]$Confirmation
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Common-A2OWorkspace.ps1')
$projectRoot = Get-A2OProjectRoot

Push-Location $projectRoot
try {
  if (-not $ExternalSystem) {
    Write-Output 'Governed Objectives by external source:'
    Invoke-A2OCommand {
      npx --no-install wrangler d1 execute DB --local --command "SELECT external_system AS source, COUNT(*) AS objectives FROM incumbent_objective GROUP BY external_system ORDER BY objectives DESC, source;"
    } 'Objective source inventory failed.'
    Write-Output ''
    Write-Output 'No data changed. To purge one junk source, run:'
    Write-Output 'npm run local:purge-objectives -- -ExternalSystem "SOURCE NAME" -Confirmation "PURGE IMPORTED OBJECTIVES"'
    exit 0
  }

  $escapedSource = $ExternalSystem.Replace("'", "''")
  Write-Output "Objects selected for source: $ExternalSystem"
  Invoke-A2OCommand {
    npx --no-install wrangler d1 execute DB --local --command "SELECT COUNT(*) AS objectives FROM incumbent_objective WHERE external_system='$escapedSource';"
  } 'Objective purge preview failed.'

  if ($Confirmation -ne 'PURGE IMPORTED OBJECTIVES') {
    throw 'No data changed. Re-run with -Confirmation "PURGE IMPORTED OBJECTIVES" after verifying the source name and count.'
  }

  & (Join-Path $PSScriptRoot 'Backup-A2OWorkspace.ps1')
  if ($LASTEXITCODE -ne 0) { throw 'The required pre-purge backup failed. No Objective data was removed.' }

  $sqlPath = Assert-A2OProjectPath -Candidate (Join-Path $projectRoot ".wrangler\purge-objectives-$PID.sql") -ProjectRoot $projectRoot
  $sql = @"
PRAGMA foreign_keys=ON;
DELETE FROM acceptance_signoff
WHERE criterion_id IN (SELECT id FROM acceptance_criterion WHERE objective_id IN (SELECT id FROM incumbent_objective WHERE external_system='$escapedSource'));
DELETE FROM acceptance_criterion WHERE objective_id IN (SELECT id FROM incumbent_objective WHERE external_system='$escapedSource');
DELETE FROM objective_requirement WHERE objective_id IN (SELECT id FROM incumbent_objective WHERE external_system='$escapedSource');
DELETE FROM requirement_trace WHERE objective_id IN (SELECT id FROM incumbent_objective WHERE external_system='$escapedSource');
DELETE FROM objective_estimate WHERE objective_id IN (SELECT id FROM incumbent_objective WHERE external_system='$escapedSource');
DELETE FROM objective_effect_attribution WHERE objective_id IN (SELECT id FROM incumbent_objective WHERE external_system='$escapedSource');
DELETE FROM change_request_objective_dependency WHERE prerequisite_objective_id IN (SELECT id FROM incumbent_objective WHERE external_system='$escapedSource');
DELETE FROM objective_change_request_link WHERE objective_id IN (SELECT id FROM incumbent_objective WHERE external_system='$escapedSource');
DELETE FROM work_package_objective WHERE objective_id IN (SELECT id FROM incumbent_objective WHERE external_system='$escapedSource');
DELETE FROM governance_record_link WHERE entity_kind='objective' AND entity_id IN (SELECT id FROM incumbent_objective WHERE external_system='$escapedSource');
UPDATE work_package SET objective_id=NULL WHERE objective_id IN (SELECT id FROM incumbent_objective WHERE external_system='$escapedSource');
UPDATE initiative_milestone SET objective_id=NULL WHERE objective_id IN (SELECT id FROM incumbent_objective WHERE external_system='$escapedSource');
UPDATE objective_source_row SET objective_id=NULL WHERE objective_id IN (SELECT id FROM incumbent_objective WHERE external_system='$escapedSource');
UPDATE lm_objective_feed_subject SET canonical_objective_id=NULL WHERE canonical_objective_id IN (SELECT id FROM incumbent_objective WHERE external_system='$escapedSource');
DELETE FROM incumbent_objective WHERE external_system='$escapedSource';
PRAGMA foreign_key_check;
"@

  try {
    Set-Content -LiteralPath $sqlPath -Value $sql -Encoding UTF8
    Invoke-A2OCommand {
      npx --no-install wrangler d1 execute DB --local "--file=$sqlPath"
    } 'The Objective purge failed. Restore the automatic pre-purge backup before continuing.'
  } finally {
    if (Test-Path -LiteralPath $sqlPath) { Remove-Item -LiteralPath $sqlPath -Force }
  }

  Write-Output "Imported Objectives from '$ExternalSystem' were removed. Supplier snapshots and raw import history were retained; their canonical Objective links were cleared."
  Write-Output 'Restart or refresh the application, then review LM Objectives, Change Requests, Initiative Work Plan, and Analyst Control.'
} finally {
  Pop-Location
}
