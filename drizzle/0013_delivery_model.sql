-- Delivery model maturity
--
-- A Government Initiative owns the analysis work plan.  LM Objectives remain
-- incumbent delivery commitments and are linked to Government work through a
-- many-to-many relationship.  The former work_package objective_id and
-- change_request_id columns remain only as backwards-compatible historical
-- columns; new application code does not use them.

CREATE UNIQUE INDEX IF NOT EXISTS `work_package_initiative_code_v2_uq`
  ON `work_package` (`initiative_id`,`wbs_code`)
  WHERE `initiative_id` IS NOT NULL;
--> statement-breakpoint

CREATE TRIGGER IF NOT EXISTS `work_package_parent_same_initiative_insert`
BEFORE INSERT ON `work_package`
WHEN NEW.`parent_id` IS NOT NULL
 AND NOT EXISTS (
   SELECT 1 FROM `work_package` p
   WHERE p.`id`=NEW.`parent_id` AND p.`initiative_id`=NEW.`initiative_id`
 )
BEGIN
  SELECT RAISE(ABORT, 'Work package parent must belong to the same Initiative');
END;
--> statement-breakpoint

CREATE TRIGGER IF NOT EXISTS `work_package_parent_same_initiative_update`
BEFORE UPDATE OF `parent_id`,`initiative_id` ON `work_package`
WHEN NEW.`parent_id` IS NOT NULL
 AND NOT EXISTS (
   SELECT 1 FROM `work_package` p
   WHERE p.`id`=NEW.`parent_id` AND p.`initiative_id`=NEW.`initiative_id`
 )
BEGIN
  SELECT RAISE(ABORT, 'Work package parent must belong to the same Initiative');
END;
--> statement-breakpoint

-- Canonical requirements are reusable source references.  An objective does
-- not own the requirement; objective_requirement records the change/version
-- and Government disposition for that Objective.
CREATE TABLE IF NOT EXISTS `requirement` (
  `id` text PRIMARY KEY NOT NULL,
  `program_id` text NOT NULL,
  `external_identifier` text NOT NULL,
  `title` text NOT NULL,
  `source_system` text NOT NULL,
  `source_locator` text,
  `source_as_of` text,
  `current_text` text,
  `lifecycle_status` text DEFAULT 'active' NOT NULL,
  `created_by_user_id` text,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  FOREIGN KEY (`program_id`) REFERENCES `program`(`id`),
  FOREIGN KEY (`created_by_user_id`) REFERENCES `app_user`(`id`),
  CONSTRAINT `requirement_lifecycle_status` CHECK(`lifecycle_status` IN ('active','retired','superseded'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `requirement_external_uq`
  ON `requirement` (`program_id`,`source_system`,`external_identifier`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `requirement_program_ix`
  ON `requirement` (`program_id`,`lifecycle_status`,`updated_at`);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS `objective_requirement` (
  `id` text PRIMARY KEY NOT NULL,
  `objective_id` text NOT NULL,
  `requirement_id` text NOT NULL,
  `version_label` text DEFAULT '1' NOT NULL,
  `change_action` text DEFAULT 'verify' NOT NULL,
  `before_text` text,
  `after_text` text,
  `rationale` text,
  `disposition` text DEFAULT 'identified' NOT NULL,
  `source_reference` text,
  `source_as_of` text,
  `created_by_user_id` text,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  FOREIGN KEY (`objective_id`) REFERENCES `incumbent_objective`(`id`),
  FOREIGN KEY (`requirement_id`) REFERENCES `requirement`(`id`),
  FOREIGN KEY (`created_by_user_id`) REFERENCES `app_user`(`id`),
  CONSTRAINT `objective_requirement_action` CHECK(`change_action` IN ('add','modify','retire','verify','none')),
  CONSTRAINT `objective_requirement_disposition` CHECK(`disposition` IN ('identified','analysis_needed','traced','verified','not_applicable'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `objective_requirement_version_uq`
  ON `objective_requirement` (`objective_id`,`requirement_id`,`version_label`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `objective_requirement_requirement_ix`
  ON `objective_requirement` (`requirement_id`,`disposition`);
--> statement-breakpoint

-- Preserve existing delivery traces while moving their reusable identity into
-- the canonical requirement table.
INSERT OR IGNORE INTO `requirement`
  (`id`,`program_id`,`external_identifier`,`title`,`source_system`,`source_locator`,`source_as_of`,`current_text`,`lifecycle_status`,`created_by_user_id`,`created_at`,`updated_at`)
SELECT
  'migrated-requirement-' || q.`id`,
  o.`program_id`, q.`external_identifier`, q.`title`, q.`source_system`,
  q.`source_locator`, q.`source_as_of`, COALESCE(q.`after_text`,q.`before_text`),
  CASE WHEN q.`change_action`='retire' THEN 'retired' ELSE 'active' END,
  q.`created_by_user_id`, q.`created_at`, q.`updated_at`
FROM `requirement_trace` q
JOIN `incumbent_objective` o ON o.`id`=q.`objective_id`;
--> statement-breakpoint
INSERT OR IGNORE INTO `objective_requirement`
  (`id`,`objective_id`,`requirement_id`,`version_label`,`change_action`,`before_text`,`after_text`,`rationale`,`disposition`,`source_reference`,`source_as_of`,`created_by_user_id`,`created_at`,`updated_at`)
SELECT
  'migrated-objective-requirement-' || q.`id`, q.`objective_id`,
  'migrated-requirement-' || q.`id`, '1', q.`change_action`, q.`before_text`,
  q.`after_text`, q.`rationale`, q.`trace_status`, q.`source_locator`,
  q.`source_as_of`, q.`created_by_user_id`, q.`created_at`, q.`updated_at`
FROM `requirement_trace` q;
--> statement-breakpoint

ALTER TABLE `acceptance_criterion` ADD `objective_requirement_id` text;
--> statement-breakpoint
UPDATE `acceptance_criterion`
SET `objective_requirement_id`='migrated-objective-requirement-' || `requirement_trace_id`
WHERE `requirement_trace_id` IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `acceptance_criterion_objective_requirement_ix`
  ON `acceptance_criterion` (`objective_requirement_id`);
--> statement-breakpoint

-- Change Request is the authoritative decision object.  The legacy MCP
-- governance-record type is retained only in the old table constraint; it is
-- converted to a technical note and cannot be created by the application.
UPDATE `governance_record` SET `record_type`='technical_note' WHERE `record_type`='mcp';
