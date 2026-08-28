ALTER TABLE `initiative_solution_decision` ADD COLUMN `basis_snapshot_json` text;
--> statement-breakpoint
ALTER TABLE `initiative_solution_decision` ADD COLUMN `basis_hash` text;
--> statement-breakpoint
ALTER TABLE `initiative_solution_decision` ADD COLUMN `decision_revision` integer NOT NULL DEFAULT 0;
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
CREATE TRIGGER `initiative_solution_decision_transition_guard`
BEFORE UPDATE OF `disposition`,`selected_option_id` ON `initiative_solution_decision`
WHEN OLD.`disposition`<>'pending' AND NEW.`disposition`<>'pending' AND (
  OLD.`disposition`<>NEW.`disposition` OR COALESCE(OLD.`selected_option_id`,'')<>COALESCE(NEW.`selected_option_id`,'')
)
BEGIN
  SELECT RAISE(ABORT, 'Return the Initiative adjudication to pending before changing a completed decision');
END;
--> statement-breakpoint
CREATE TRIGGER `selected_solution_option_update_guard`
BEFORE UPDATE ON `solution_option`
WHEN EXISTS (SELECT 1 FROM `initiative_solution_decision` `d` WHERE `d`.`selected_option_id`=OLD.`id` AND `d`.`disposition`='selected')
BEGIN SELECT RAISE(ABORT, 'Return the Initiative adjudication to pending before changing its selected solution option'); END;
--> statement-breakpoint
CREATE TRIGGER `selected_solution_option_delete_guard`
BEFORE DELETE ON `solution_option`
WHEN EXISTS (SELECT 1 FROM `initiative_solution_decision` `d` WHERE `d`.`selected_option_id`=OLD.`id` AND `d`.`disposition`='selected')
BEGIN SELECT RAISE(ABORT, 'Return the Initiative adjudication to pending before changing its selected solution option'); END;
--> statement-breakpoint
CREATE TRIGGER `selected_solution_step_insert_guard`
BEFORE INSERT ON `solution_option_step`
WHEN EXISTS (SELECT 1 FROM `initiative_solution_decision` `d` WHERE `d`.`selected_option_id`=NEW.`option_id` AND `d`.`disposition`='selected')
BEGIN SELECT RAISE(ABORT, 'Return the Initiative adjudication to pending before changing its selected solution option'); END;
--> statement-breakpoint
CREATE TRIGGER `selected_solution_step_update_guard`
BEFORE UPDATE ON `solution_option_step`
WHEN EXISTS (SELECT 1 FROM `initiative_solution_decision` `d` WHERE (`d`.`selected_option_id`=OLD.`option_id` OR `d`.`selected_option_id`=NEW.`option_id`) AND `d`.`disposition`='selected')
BEGIN SELECT RAISE(ABORT, 'Return the Initiative adjudication to pending before changing its selected solution option'); END;
--> statement-breakpoint
CREATE TRIGGER `selected_solution_step_delete_guard`
BEFORE DELETE ON `solution_option_step`
WHEN EXISTS (SELECT 1 FROM `initiative_solution_decision` `d` WHERE `d`.`selected_option_id`=OLD.`option_id` AND `d`.`disposition`='selected')
BEGIN SELECT RAISE(ABORT, 'Return the Initiative adjudication to pending before changing its selected solution option'); END;
--> statement-breakpoint
CREATE TRIGGER `selected_solution_change_insert_guard`
BEFORE INSERT ON `solution_option_change_request`
WHEN EXISTS (SELECT 1 FROM `initiative_solution_decision` `d` WHERE `d`.`selected_option_id`=NEW.`option_id` AND `d`.`disposition`='selected')
BEGIN SELECT RAISE(ABORT, 'Return the Initiative adjudication to pending before changing its selected solution option'); END;
--> statement-breakpoint
CREATE TRIGGER `selected_solution_change_update_guard`
BEFORE UPDATE ON `solution_option_change_request`
WHEN EXISTS (SELECT 1 FROM `initiative_solution_decision` `d` WHERE (`d`.`selected_option_id`=OLD.`option_id` OR `d`.`selected_option_id`=NEW.`option_id`) AND `d`.`disposition`='selected')
BEGIN SELECT RAISE(ABORT, 'Return the Initiative adjudication to pending before changing its selected solution option'); END;
--> statement-breakpoint
CREATE TRIGGER `selected_solution_change_delete_guard`
BEFORE DELETE ON `solution_option_change_request`
WHEN EXISTS (SELECT 1 FROM `initiative_solution_decision` `d` WHERE `d`.`selected_option_id`=OLD.`option_id` AND `d`.`disposition`='selected')
BEGIN SELECT RAISE(ABORT, 'Return the Initiative adjudication to pending before changing its selected solution option'); END;
--> statement-breakpoint
CREATE TRIGGER `selected_solution_objective_insert_guard`
BEFORE INSERT ON `solution_option_objective`
WHEN EXISTS (SELECT 1 FROM `initiative_solution_decision` `d` WHERE `d`.`selected_option_id`=NEW.`option_id` AND `d`.`disposition`='selected')
BEGIN SELECT RAISE(ABORT, 'Return the Initiative adjudication to pending before changing its selected solution option'); END;
--> statement-breakpoint
CREATE TRIGGER `selected_solution_objective_update_guard`
BEFORE UPDATE ON `solution_option_objective`
WHEN EXISTS (SELECT 1 FROM `initiative_solution_decision` `d` WHERE (`d`.`selected_option_id`=OLD.`option_id` OR `d`.`selected_option_id`=NEW.`option_id`) AND `d`.`disposition`='selected')
BEGIN SELECT RAISE(ABORT, 'Return the Initiative adjudication to pending before changing its selected solution option'); END;
--> statement-breakpoint
CREATE TRIGGER `selected_solution_objective_delete_guard`
BEFORE DELETE ON `solution_option_objective`
WHEN EXISTS (SELECT 1 FROM `initiative_solution_decision` `d` WHERE `d`.`selected_option_id`=OLD.`option_id` AND `d`.`disposition`='selected')
BEGIN SELECT RAISE(ABORT, 'Return the Initiative adjudication to pending before changing its selected solution option'); END;
--> statement-breakpoint
CREATE TRIGGER `selected_solution_assessment_insert_guard`
BEFORE INSERT ON `solution_option_assessment`
WHEN EXISTS (SELECT 1 FROM `initiative_solution_decision` `d` WHERE `d`.`selected_option_id`=NEW.`option_id` AND `d`.`disposition`='selected')
BEGIN SELECT RAISE(ABORT, 'Return the Initiative adjudication to pending before changing its selected solution option'); END;
--> statement-breakpoint
CREATE TRIGGER `selected_solution_assessment_update_guard`
BEFORE UPDATE ON `solution_option_assessment`
WHEN EXISTS (SELECT 1 FROM `initiative_solution_decision` `d` WHERE (`d`.`selected_option_id`=OLD.`option_id` OR `d`.`selected_option_id`=NEW.`option_id`) AND `d`.`disposition`='selected')
BEGIN SELECT RAISE(ABORT, 'Return the Initiative adjudication to pending before changing its selected solution option'); END;
--> statement-breakpoint
CREATE TRIGGER `selected_solution_assessment_delete_guard`
BEFORE DELETE ON `solution_option_assessment`
WHEN EXISTS (SELECT 1 FROM `initiative_solution_decision` `d` WHERE `d`.`selected_option_id`=OLD.`option_id` AND `d`.`disposition`='selected')
BEGIN SELECT RAISE(ABORT, 'Return the Initiative adjudication to pending before changing its selected solution option'); END;
--> statement-breakpoint
PRAGMA optimize;
