CREATE TABLE `initiative_solution_decision_revision` (
  `id` text PRIMARY KEY NOT NULL,
  `decision_id` text NOT NULL,
  `initiative_id` text NOT NULL,
  `revision` integer NOT NULL,
  `selected_option_id` text,
  `disposition` text NOT NULL,
  `decision_authority` text NOT NULL,
  `decision_date` text NOT NULL,
  `rationale` text NOT NULL,
  `accepted_residual_risk` text,
  `basis_snapshot_json` text,
  `basis_hash` text,
  `created_by_user_id` text,
  `created_at` text NOT NULL,
  FOREIGN KEY (`decision_id`) REFERENCES `initiative_solution_decision`(`id`),
  FOREIGN KEY (`initiative_id`) REFERENCES `initiative`(`id`),
  FOREIGN KEY (`selected_option_id`) REFERENCES `solution_option`(`id`),
  FOREIGN KEY (`created_by_user_id`) REFERENCES `app_user`(`id`),
  CONSTRAINT `initiative_solution_decision_revision_disposition` CHECK (`disposition` IN ('selected','deferred','no_action','legacy_unverified')),
  CONSTRAINT `initiative_solution_decision_revision_complete` CHECK (
    `revision`>0 AND LENGTH(TRIM(`decision_authority`))>0 AND LENGTH(TRIM(`decision_date`))>0 AND LENGTH(TRIM(`rationale`))>0 AND (
      (`disposition`='selected' AND `selected_option_id` IS NOT NULL AND LENGTH(TRIM(COALESCE(`basis_snapshot_json`,'')))>0 AND `basis_hash` IS NOT NULL AND `basis_hash` GLOB 'sha256:*' AND SUBSTR(`basis_hash`,8) NOT GLOB '*[^0-9a-f]*' AND LENGTH(`basis_hash`)=71) OR
      (`disposition` IN ('deferred','no_action') AND `selected_option_id` IS NULL AND `basis_snapshot_json` IS NULL AND `basis_hash` IS NULL) OR
      (`disposition`='legacy_unverified' AND `selected_option_id` IS NOT NULL AND `basis_snapshot_json` IS NULL AND `basis_hash` IS NULL)
    )
  )
);
--> statement-breakpoint
CREATE UNIQUE INDEX `initiative_solution_decision_revision_uq` ON `initiative_solution_decision_revision` (`decision_id`,`revision`);
--> statement-breakpoint
CREATE INDEX `initiative_solution_decision_revision_initiative_ix` ON `initiative_solution_decision_revision` (`initiative_id`,`revision`);
--> statement-breakpoint
CREATE TABLE `initiative_solution_decision_maintenance_lock` (
  `id` integer PRIMARY KEY NOT NULL CHECK (`id`=1),
  `operation_id` text NOT NULL,
  `created_at` text NOT NULL
);
--> statement-breakpoint
-- 0032 permitted completed selections before frozen decision bases existed.
-- Preserve their human adjudication as explicitly unverified history, then
-- return the current row to a clean Pending state. No basis is synthesized.
INSERT INTO `initiative_solution_decision_revision` (`id`,`decision_id`,`initiative_id`,`revision`,`selected_option_id`,`disposition`,`decision_authority`,`decision_date`,`rationale`,`accepted_residual_risk`,`basis_snapshot_json`,`basis_hash`,`created_by_user_id`,`created_at`)
SELECT `id` || ':revision:' || printf('%08d',1),`id`,`initiative_id`,1,`selected_option_id`,'legacy_unverified',`decision_authority`,`decision_date`,`rationale`,`accepted_residual_risk`,NULL,NULL,`created_by_user_id`,`updated_at`
FROM `initiative_solution_decision`
WHERE `disposition`='selected' AND (
  `decision_revision`<=0 OR LENGTH(TRIM(COALESCE(`basis_snapshot_json`,'')))=0 OR
  `basis_hash` IS NULL OR `basis_hash` NOT GLOB 'sha256:*' OR SUBSTR(`basis_hash`,8) GLOB '*[^0-9a-f]*' OR LENGTH(`basis_hash`)<>71
);
--> statement-breakpoint
UPDATE `initiative_solution_decision`
SET `selected_option_id`=NULL,`disposition`='pending',`decision_authority`=NULL,`decision_date`=NULL,`rationale`=NULL,`accepted_residual_risk`=NULL,`basis_snapshot_json`=NULL,`basis_hash`=NULL,`decision_revision`=1
WHERE `id` IN (SELECT `decision_id` FROM `initiative_solution_decision_revision` WHERE `disposition`='legacy_unverified');
--> statement-breakpoint
-- Pending counters created before history existed cannot identify a
-- recoverable adjudication. Reset only rows with no preserved revision.
UPDATE `initiative_solution_decision`
SET `decision_revision`=0
WHERE `disposition`='pending' AND NOT EXISTS (
  SELECT 1 FROM `initiative_solution_decision_revision` `r` WHERE `r`.`decision_id`=`initiative_solution_decision`.`id`
);
--> statement-breakpoint
-- Only the current completed state is recoverable at this upgrade boundary,
-- regardless of a pre-history counter. Record it as the first durable revision.
UPDATE `initiative_solution_decision`
SET `decision_revision`=1
WHERE `disposition`<>'pending';
--> statement-breakpoint
INSERT INTO `initiative_solution_decision_revision` (`id`,`decision_id`,`initiative_id`,`revision`,`selected_option_id`,`disposition`,`decision_authority`,`decision_date`,`rationale`,`accepted_residual_risk`,`basis_snapshot_json`,`basis_hash`,`created_by_user_id`,`created_at`)
SELECT `id` || ':revision:' || printf('%08d',`decision_revision`),`id`,`initiative_id`,`decision_revision`,`selected_option_id`,`disposition`,`decision_authority`,`decision_date`,`rationale`,`accepted_residual_risk`,`basis_snapshot_json`,`basis_hash`,`created_by_user_id`,`updated_at`
FROM `initiative_solution_decision`
WHERE `disposition`<>'pending';
--> statement-breakpoint
DROP TRIGGER IF EXISTS `initiative_solution_decision_transition_guard`;
--> statement-breakpoint
CREATE TRIGGER `initiative_solution_decision_transition_guard`
BEFORE UPDATE ON `initiative_solution_decision`
WHEN OLD.`disposition`<>'pending' AND NEW.`disposition`<>'pending'
BEGIN
  SELECT RAISE(ABORT, 'Return the Initiative adjudication to pending before changing a completed decision');
END;
--> statement-breakpoint
CREATE TRIGGER `initiative_solution_decision_pending_insert_guard`
BEFORE INSERT ON `initiative_solution_decision`
WHEN (NEW.`disposition`='pending' AND (
  NEW.`selected_option_id` IS NOT NULL OR NEW.`decision_authority` IS NOT NULL OR NEW.`decision_date` IS NOT NULL OR
  NEW.`rationale` IS NOT NULL OR NEW.`accepted_residual_risk` IS NOT NULL OR NEW.`basis_snapshot_json` IS NOT NULL OR NEW.`basis_hash` IS NOT NULL
)) OR (NOT EXISTS (SELECT 1 FROM `initiative_solution_decision_maintenance_lock` WHERE `id`=1) AND (
  (NEW.`disposition`='pending' AND NEW.`decision_revision`<>0) OR (NEW.`disposition`<>'pending' AND NEW.`decision_revision`<>1)
))
BEGIN
  SELECT RAISE(ABORT, 'A new Initiative adjudication must begin at a valid initial revision with no pending decision metadata');
END;
--> statement-breakpoint
CREATE TRIGGER `initiative_solution_decision_pending_update_guard`
BEFORE UPDATE ON `initiative_solution_decision`
WHEN NEW.`id`<>OLD.`id` OR NEW.`initiative_id`<>OLD.`initiative_id` OR (NEW.`disposition`='pending' AND (
  NEW.`selected_option_id` IS NOT NULL OR NEW.`decision_authority` IS NOT NULL OR NEW.`decision_date` IS NOT NULL OR
  NEW.`rationale` IS NOT NULL OR NEW.`accepted_residual_risk` IS NOT NULL OR NEW.`basis_snapshot_json` IS NOT NULL OR NEW.`basis_hash` IS NOT NULL
)) OR (NEW.`disposition`='pending' AND NEW.`decision_revision`<>OLD.`decision_revision`)
   OR (OLD.`disposition`='pending' AND NEW.`disposition`<>'pending' AND NEW.`decision_revision`<>OLD.`decision_revision`+1)
BEGIN
  SELECT RAISE(ABORT, 'Initiative adjudication revisions must advance exactly once from a clean pending decision');
END;
--> statement-breakpoint
CREATE TRIGGER `initiative_solution_decision_delete_guard`
BEFORE DELETE ON `initiative_solution_decision`
WHEN OLD.`disposition`<>'pending' OR (
  EXISTS (SELECT 1 FROM `initiative_solution_decision_revision` `r` WHERE `r`.`decision_id`=OLD.`id`) AND
  NOT EXISTS (SELECT 1 FROM `initiative_solution_decision_maintenance_lock` WHERE `id`=1)
)
BEGIN
  SELECT RAISE(ABORT, 'A recorded Initiative adjudication and its revision history cannot be deleted');
END;
--> statement-breakpoint
CREATE TRIGGER `initiative_solution_decision_revision_insert_guard`
BEFORE INSERT ON `initiative_solution_decision_revision`
WHEN NOT EXISTS (
  SELECT 1 FROM `initiative_solution_decision` `d`
  WHERE `d`.`id`=NEW.`decision_id` AND `d`.`initiative_id`=NEW.`initiative_id` AND NEW.`revision`<=`d`.`decision_revision`
) OR (NEW.`selected_option_id` IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM `solution_option` `o` WHERE `o`.`id`=NEW.`selected_option_id` AND `o`.`initiative_id`=NEW.`initiative_id`
)) OR (NOT EXISTS (SELECT 1 FROM `initiative_solution_decision_maintenance_lock` WHERE `id`=1) AND NOT EXISTS (
  SELECT 1 FROM `initiative_solution_decision` `d`
  WHERE `d`.`id`=NEW.`decision_id` AND `d`.`disposition`<>'pending' AND NEW.`revision`=`d`.`decision_revision`
    AND NEW.`initiative_id`=`d`.`initiative_id`
    AND NEW.`selected_option_id` IS `d`.`selected_option_id`
    AND NEW.`disposition`=`d`.`disposition`
    AND NEW.`decision_authority`=`d`.`decision_authority`
    AND NEW.`decision_date`=`d`.`decision_date`
    AND NEW.`rationale`=`d`.`rationale`
    AND NEW.`accepted_residual_risk` IS `d`.`accepted_residual_risk`
    AND NEW.`basis_snapshot_json` IS `d`.`basis_snapshot_json`
    AND NEW.`basis_hash` IS `d`.`basis_hash`
    AND NEW.`created_by_user_id` IS `d`.`created_by_user_id`
    AND NEW.`created_at`=`d`.`updated_at`
))
BEGIN
  SELECT RAISE(ABORT, 'A decision revision must match its Initiative, option, and current revision sequence');
END;
--> statement-breakpoint
CREATE TRIGGER `initiative_solution_decision_revision_update_guard`
BEFORE UPDATE ON `initiative_solution_decision_revision`
BEGIN
  SELECT RAISE(ABORT, 'Recorded Initiative decision revisions are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `initiative_solution_decision_revision_delete_guard`
BEFORE DELETE ON `initiative_solution_decision_revision`
WHEN NOT EXISTS (SELECT 1 FROM `initiative_solution_decision_maintenance_lock` WHERE `id`=1)
BEGIN
  SELECT RAISE(ABORT, 'Recorded Initiative decision revisions are append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `initiative_solution_decision_revision_after_insert`
AFTER INSERT ON `initiative_solution_decision`
WHEN NEW.`disposition`<>'pending'
BEGIN
  INSERT INTO `initiative_solution_decision_revision` (`id`,`decision_id`,`initiative_id`,`revision`,`selected_option_id`,`disposition`,`decision_authority`,`decision_date`,`rationale`,`accepted_residual_risk`,`basis_snapshot_json`,`basis_hash`,`created_by_user_id`,`created_at`)
  VALUES (NEW.`id` || ':revision:' || printf('%08d',NEW.`decision_revision`),NEW.`id`,NEW.`initiative_id`,NEW.`decision_revision`,NEW.`selected_option_id`,NEW.`disposition`,NEW.`decision_authority`,NEW.`decision_date`,NEW.`rationale`,NEW.`accepted_residual_risk`,NEW.`basis_snapshot_json`,NEW.`basis_hash`,NEW.`created_by_user_id`,NEW.`updated_at`);
END;
--> statement-breakpoint
CREATE TRIGGER `initiative_solution_decision_revision_after_update`
AFTER UPDATE ON `initiative_solution_decision`
WHEN OLD.`disposition`='pending' AND NEW.`disposition`<>'pending'
BEGIN
  INSERT INTO `initiative_solution_decision_revision` (`id`,`decision_id`,`initiative_id`,`revision`,`selected_option_id`,`disposition`,`decision_authority`,`decision_date`,`rationale`,`accepted_residual_risk`,`basis_snapshot_json`,`basis_hash`,`created_by_user_id`,`created_at`)
  VALUES (NEW.`id` || ':revision:' || printf('%08d',NEW.`decision_revision`),NEW.`id`,NEW.`initiative_id`,NEW.`decision_revision`,NEW.`selected_option_id`,NEW.`disposition`,NEW.`decision_authority`,NEW.`decision_date`,NEW.`rationale`,NEW.`accepted_residual_risk`,NEW.`basis_snapshot_json`,NEW.`basis_hash`,NEW.`created_by_user_id`,NEW.`updated_at`);
END;
--> statement-breakpoint
PRAGMA optimize;
