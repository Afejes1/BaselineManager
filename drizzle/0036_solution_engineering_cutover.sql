-- Clean prototype cutover: Initiatives become Government decision cases.
-- Imported source domains are deliberately retained. Initiative-owned records
-- are removed because their legacy framing cannot be represented faithfully in
-- the new option-based decision model.

INSERT INTO `initiative_solution_decision_maintenance_lock` (`id`,`operation_id`,`created_at`)
VALUES (1,'0036-solution-engineering-cutover',CURRENT_TIMESTAMP)
ON CONFLICT(`id`) DO UPDATE SET `operation_id`=excluded.`operation_id`,`created_at`=excluded.`created_at`;
--> statement-breakpoint
INSERT INTO `audit_event` (`id`,`program_id`,`actor_id`,`action`,`entity_kind`,`entity_id`,`after_payload`,`created_at`)
SELECT 'audit-' || lower(hex(randomblob(16))),d.`program_id`,NULL,'evidence_object_cleanup_pending','evidence_object',d.`id`,
  json_object('r2Key',d.`r2_key`,'reason','initiative_solution_engineering_cutover','operationId','0036-solution-engineering-cutover','sourceDocumentId',d.`id`),CURRENT_TIMESTAMP
FROM `evidence_document` d
WHERE d.`initiative_id` IS NOT NULL;
--> statement-breakpoint
DELETE FROM `brief_publication` WHERE `brief_id` IN (SELECT `id` FROM `executive_brief` WHERE `initiative_id` IS NOT NULL);
--> statement-breakpoint
DELETE FROM `executive_brief` WHERE `initiative_id` IS NOT NULL;
--> statement-breakpoint
DELETE FROM `acceptance_signoff` WHERE `evidence_document_id` IN (SELECT `id` FROM `evidence_document` WHERE `initiative_id` IS NOT NULL);
--> statement-breakpoint
DELETE FROM `evidence_document` WHERE `initiative_id` IS NOT NULL;
--> statement-breakpoint
DELETE FROM `governance_record_link` WHERE `entity_kind`='initiative' OR (`entity_kind`='work_package' AND `entity_id` IN (SELECT `id` FROM `work_package`));
--> statement-breakpoint
DELETE FROM `initiative_solution_decision_revision`;
--> statement-breakpoint
DELETE FROM `initiative_solution_decision`;
--> statement-breakpoint
DELETE FROM `solution_option_assessment`;
--> statement-breakpoint
DELETE FROM `solution_option_objective`;
--> statement-breakpoint
DELETE FROM `solution_option_change_request`;
--> statement-breakpoint
DELETE FROM `solution_option_step`;
--> statement-breakpoint
DELETE FROM `solution_option`;
--> statement-breakpoint
DELETE FROM `initiative_milestone`;
--> statement-breakpoint
DELETE FROM `initiative_change_request`;
--> statement-breakpoint
DELETE FROM `work_package_dependency`;
--> statement-breakpoint
DELETE FROM `work_package_objective`;
--> statement-breakpoint
DELETE FROM `work_package`;
--> statement-breakpoint
DELETE FROM `initiative_scope`;
--> statement-breakpoint
DELETE FROM `initiative`;
--> statement-breakpoint
DELETE FROM `initiative_solution_decision_maintenance_lock` WHERE `id`=1;
--> statement-breakpoint

ALTER TABLE `initiative` ADD COLUMN `decision_question` text;
--> statement-breakpoint
ALTER TABLE `initiative` ADD COLUMN `closed_at` text;
--> statement-breakpoint
ALTER TABLE `solution_option_step` ADD COLUMN `parent_step_id` text;
--> statement-breakpoint
ALTER TABLE `solution_option_step` ADD COLUMN `wbs_code` text;
--> statement-breakpoint
ALTER TABLE `solution_option_step` ADD COLUMN `owner` text;
--> statement-breakpoint
ALTER TABLE `solution_option_step` ADD COLUMN `planning_start` text;
--> statement-breakpoint
ALTER TABLE `solution_option_step` ADD COLUMN `planning_finish` text;
--> statement-breakpoint
ALTER TABLE `solution_option_step` ADD COLUMN `planning_effort_hours` real;
--> statement-breakpoint
ALTER TABLE `solution_option_step` ADD COLUMN `planning_effort_basis` text;
--> statement-breakpoint
CREATE UNIQUE INDEX `solution_option_step_wbs_uq` ON `solution_option_step` (`option_id`,`wbs_code`) WHERE `wbs_code` IS NOT NULL;
--> statement-breakpoint
CREATE INDEX `solution_option_step_parent_ix` ON `solution_option_step` (`option_id`,`parent_step_id`,`sort_order`);
--> statement-breakpoint

CREATE TABLE `solution_step_reference` (
  `id` text PRIMARY KEY NOT NULL,
  `option_id` text NOT NULL REFERENCES `solution_option`(`id`),
  `step_id` text NOT NULL REFERENCES `solution_option_step`(`id`),
  `reference_kind` text NOT NULL CHECK (`reference_kind` IN ('change_request','objective','jira','confluence','other')),
  `source_id` text,
  `reference` text,
  `label` text NOT NULL,
  `rationale` text,
  `created_by_user_id` text REFERENCES `app_user`(`id`),
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  CHECK (`source_id` IS NOT NULL OR LENGTH(TRIM(COALESCE(`reference`,'')))>0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `solution_step_reference_uq` ON `solution_step_reference` (`step_id`,`reference_kind`,COALESCE(`source_id`,''),COALESCE(`reference`,''));
--> statement-breakpoint
CREATE INDEX `solution_step_reference_option_ix` ON `solution_step_reference` (`option_id`,`step_id`);
--> statement-breakpoint

CREATE TABLE `solution_step_dependency` (
  `id` text PRIMARY KEY NOT NULL,
  `option_id` text NOT NULL REFERENCES `solution_option`(`id`),
  `predecessor_step_id` text NOT NULL REFERENCES `solution_option_step`(`id`),
  `successor_step_id` text NOT NULL REFERENCES `solution_option_step`(`id`),
  `relationship` text NOT NULL DEFAULT 'FS' CHECK (`relationship` IN ('FS','SS','FF','SF')),
  `lag_days` integer NOT NULL DEFAULT 0,
  `rationale` text NOT NULL,
  `created_by_user_id` text REFERENCES `app_user`(`id`),
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  CHECK (`predecessor_step_id`<>`successor_step_id`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `solution_step_dependency_uq` ON `solution_step_dependency` (`predecessor_step_id`,`successor_step_id`,`relationship`);
--> statement-breakpoint
CREATE INDEX `solution_step_dependency_option_ix` ON `solution_step_dependency` (`option_id`,`successor_step_id`);
--> statement-breakpoint

CREATE TABLE `solution_option_knock_on` (
  `id` text PRIMARY KEY NOT NULL,
  `option_id` text NOT NULL REFERENCES `solution_option`(`id`),
  `classification` text NOT NULL CHECK (`classification` IN ('benefit','risk','constraint','dependency','second_order_effect')),
  `affected_kind` text,
  `affected_id` text,
  `affected_reference` text,
  `timing` text,
  `likelihood` text NOT NULL DEFAULT 'unassessed' CHECK (`likelihood` IN ('low','medium','high','unassessed')),
  `impact` text NOT NULL DEFAULT 'unassessed' CHECK (`impact` IN ('low','medium','high','unassessed')),
  `confidence` text NOT NULL DEFAULT 'unassessed' CHECK (`confidence` IN ('low','medium','high','unassessed')),
  `narrative` text NOT NULL,
  `mitigation` text,
  `created_by_user_id` text REFERENCES `app_user`(`id`),
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `solution_option_knock_on_option_ix` ON `solution_option_knock_on` (`option_id`,`classification`,`updated_at`);
--> statement-breakpoint

CREATE UNIQUE INDEX `solution_option_status_quo_uq` ON `solution_option` (`initiative_id`) WHERE `option_type`='status_quo';
--> statement-breakpoint
CREATE TRIGGER `solution_option_status_quo_delete_guard`
BEFORE DELETE ON `solution_option`
WHEN OLD.`option_type`='status_quo' AND NOT EXISTS (SELECT 1 FROM `initiative_solution_decision_maintenance_lock` WHERE `id`=1)
BEGIN SELECT RAISE(ABORT,'The required status-quo option cannot be deleted'); END;
--> statement-breakpoint
CREATE TRIGGER `solution_option_status_quo_type_guard`
BEFORE UPDATE OF `option_type`,`initiative_id` ON `solution_option`
WHEN OLD.`option_type`='status_quo' AND (NEW.`option_type`<>'status_quo' OR NEW.`initiative_id`<>OLD.`initiative_id`)
BEGIN SELECT RAISE(ABORT,'The required status-quo option cannot be converted or moved'); END;
--> statement-breakpoint
CREATE TRIGGER `solution_step_parent_insert_guard`
BEFORE INSERT ON `solution_option_step`
WHEN NEW.`parent_step_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `solution_option_step` p WHERE p.`id`=NEW.`parent_step_id` AND p.`option_id`=NEW.`option_id`)
BEGIN SELECT RAISE(ABORT,'A solution step parent must belong to the same option'); END;
--> statement-breakpoint
CREATE TRIGGER `solution_step_parent_update_guard`
BEFORE UPDATE OF `parent_step_id`,`option_id` ON `solution_option_step`
WHEN NEW.`parent_step_id` IS NOT NULL AND (NEW.`parent_step_id`=NEW.`id` OR NOT EXISTS (SELECT 1 FROM `solution_option_step` p WHERE p.`id`=NEW.`parent_step_id` AND p.`option_id`=NEW.`option_id`))
BEGIN SELECT RAISE(ABORT,'A solution step parent must belong to the same option and cannot be itself'); END;
--> statement-breakpoint
CREATE TRIGGER `solution_step_reference_guard`
BEFORE INSERT ON `solution_step_reference`
WHEN NOT EXISTS (SELECT 1 FROM `solution_option_step` s WHERE s.`id`=NEW.`step_id` AND s.`option_id`=NEW.`option_id`)
  OR (NEW.`reference_kind`='change_request' AND NOT EXISTS (SELECT 1 FROM `solution_option_change_request` l WHERE l.`option_id`=NEW.`option_id` AND l.`change_request_id`=NEW.`source_id`))
  OR (NEW.`reference_kind`='objective' AND NOT EXISTS (SELECT 1 FROM `solution_option_objective` l WHERE l.`option_id`=NEW.`option_id` AND l.`objective_id`=NEW.`source_id`))
BEGIN SELECT RAISE(ABORT,'A step reference must belong to the option and use a selected source'); END;
--> statement-breakpoint
CREATE TRIGGER `solution_step_dependency_insert_guard`
BEFORE INSERT ON `solution_step_dependency`
WHEN NOT EXISTS (SELECT 1 FROM `solution_option_step` s WHERE s.`id`=NEW.`predecessor_step_id` AND s.`option_id`=NEW.`option_id`)
  OR NOT EXISTS (SELECT 1 FROM `solution_option_step` s WHERE s.`id`=NEW.`successor_step_id` AND s.`option_id`=NEW.`option_id`)
BEGIN SELECT RAISE(ABORT,'A planning dependency must connect steps in the same option'); END;
--> statement-breakpoint
PRAGMA optimize;
