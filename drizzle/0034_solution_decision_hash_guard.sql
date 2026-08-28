DROP TRIGGER IF EXISTS `initiative_solution_decision_basis_insert_guard`;
--> statement-breakpoint
DROP TRIGGER IF EXISTS `initiative_solution_decision_basis_update_guard`;
--> statement-breakpoint
CREATE TRIGGER `initiative_solution_decision_basis_insert_guard`
BEFORE INSERT ON `initiative_solution_decision`
WHEN (NEW.`disposition`='selected' AND (
  LENGTH(TRIM(COALESCE(NEW.`basis_snapshot_json`,'')))=0 OR
  NEW.`basis_hash` IS NULL OR NEW.`basis_hash` NOT GLOB 'sha256:*' OR SUBSTR(NEW.`basis_hash`,8) GLOB '*[^0-9a-f]*' OR LENGTH(NEW.`basis_hash`)<>71 OR
  NEW.`decision_revision`<=0
)) OR (NEW.`disposition`<>'selected' AND (NEW.`basis_snapshot_json` IS NOT NULL OR NEW.`basis_hash` IS NOT NULL))
BEGIN
  SELECT RAISE(ABORT, 'A selected solution decision requires a frozen decision basis');
END;
--> statement-breakpoint
CREATE TRIGGER `initiative_solution_decision_basis_update_guard`
BEFORE UPDATE ON `initiative_solution_decision`
WHEN (NEW.`disposition`='selected' AND (
  LENGTH(TRIM(COALESCE(NEW.`basis_snapshot_json`,'')))=0 OR
  NEW.`basis_hash` IS NULL OR NEW.`basis_hash` NOT GLOB 'sha256:*' OR SUBSTR(NEW.`basis_hash`,8) GLOB '*[^0-9a-f]*' OR LENGTH(NEW.`basis_hash`)<>71 OR
  NEW.`decision_revision`<=0
)) OR (NEW.`disposition`<>'selected' AND (NEW.`basis_snapshot_json` IS NOT NULL OR NEW.`basis_hash` IS NOT NULL))
BEGIN
  SELECT RAISE(ABORT, 'A selected solution decision requires a frozen decision basis');
END;
--> statement-breakpoint
PRAGMA optimize;
