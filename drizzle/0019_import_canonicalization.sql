-- Import canonicalization
--
-- External delivery data is materialized as real application objects.  A
-- Lockheed Objective can legitimately arrive before any MCP/DSOR association
-- is reported, so the legacy direct association is optional.  Every reported
-- association is retained in objective_change_request_link rather than
-- fabricating an "unassigned" Change Request.

PRAGMA foreign_keys=OFF;
PRAGMA defer_foreign_keys=ON;

-- incumbent_objective has a substantial dependent graph. Preserve every
-- row, remove the FK-bearing tables in child-first order, rebuild the parent,
-- then recreate the original tables against the replacement parent.
CREATE TABLE `acceptance_signoff_import_backup` AS SELECT * FROM `acceptance_signoff`;
CREATE TABLE `acceptance_criterion_import_backup` AS SELECT * FROM `acceptance_criterion`;
CREATE TABLE `objective_estimate_import_backup` AS SELECT * FROM `objective_estimate`;
CREATE TABLE `requirement_trace_import_backup` AS SELECT * FROM `requirement_trace`;
CREATE TABLE `initiative_milestone_import_backup` AS SELECT * FROM `initiative_milestone`;
CREATE TABLE `change_request_objective_dependency_import_backup` AS SELECT * FROM `change_request_objective_dependency`;
CREATE TABLE `objective_effect_attribution_import_backup` AS SELECT * FROM `objective_effect_attribution`;
CREATE TABLE `objective_source_row_import_backup` AS SELECT * FROM `objective_source_row`;
CREATE TABLE `objective_requirement_import_backup` AS SELECT * FROM `objective_requirement`;
CREATE TABLE `work_package_dependency_import_backup` AS SELECT * FROM `work_package_dependency`;
CREATE TABLE `work_package_objective_import_backup` AS SELECT * FROM `work_package_objective`;
CREATE TABLE `work_package_import_backup` AS SELECT * FROM `work_package`;
CREATE TABLE `lm_objective_feed_delta_import_backup` AS SELECT * FROM `lm_objective_feed_delta`;
CREATE TABLE `lm_objective_feed_dependency_import_backup` AS SELECT * FROM `lm_objective_feed_dependency`;
CREATE TABLE `lm_objective_feed_item_import_backup` AS SELECT * FROM `lm_objective_feed_item`;
CREATE TABLE `lm_objective_feed_jpo_link_import_backup` AS SELECT * FROM `lm_objective_feed_jpo_link`;
CREATE TABLE `lm_objective_feed_state_import_backup` AS SELECT * FROM `lm_objective_feed_state`;
CREATE TABLE `lm_objective_feed_subject_import_backup` AS SELECT * FROM `lm_objective_feed_subject`;
CREATE TABLE `incumbent_objective_import_backup` AS SELECT * FROM `incumbent_objective`;

DROP TABLE `acceptance_signoff`;
DROP TABLE `acceptance_criterion`;
DROP TABLE `work_package_dependency`;
DROP TABLE `work_package_objective`;
DROP TABLE `lm_objective_feed_delta`;
DROP TABLE `lm_objective_feed_dependency`;
DROP TABLE `lm_objective_feed_item`;
DROP TABLE `lm_objective_feed_jpo_link`;
DROP TABLE `lm_objective_feed_state`;
DROP TABLE `lm_objective_feed_subject`;
DROP TABLE `objective_estimate`;
DROP TABLE `requirement_trace`;
DROP TABLE `initiative_milestone`;
DROP TABLE `change_request_objective_dependency`;
DROP TABLE `objective_effect_attribution`;
DROP TABLE `objective_source_row`;
DROP TABLE `objective_requirement`;
DROP TABLE `work_package`;
DROP TABLE `incumbent_objective`;

CREATE TABLE `incumbent_objective` (
  `id` text PRIMARY KEY NOT NULL,
  `program_id` text NOT NULL,
  -- Compatibility / analyst-designated primary association only. Supplier
  -- feeds may report no association or several associations.
  `change_request_id` text,
  `external_system` text NOT NULL,
  `external_identifier` text NOT NULL,
  `external_item_type` text DEFAULT 'Objective' NOT NULL,
  `title` text NOT NULL,
  `summary` text,
  `technical_owner` text,
  `status` text DEFAULT 'proposed' NOT NULL,
  `planned_start` text,
  `planned_finish` text,
  `actual_start` text,
  `actual_finish` text,
  `source_locator` text,
  `source_as_of` text,
  `created_by_user_id` text,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  FOREIGN KEY (`program_id`) REFERENCES `program`(`id`),
  FOREIGN KEY (`change_request_id`) REFERENCES `change_request`(`id`),
  FOREIGN KEY (`created_by_user_id`) REFERENCES `app_user`(`id`),
  CONSTRAINT `incumbent_objective_status` CHECK(`status` IN ('proposed','planned','in_progress','blocked','verification','complete','cancelled'))
);
CREATE UNIQUE INDEX `incumbent_objective_external_uq` ON `incumbent_objective` (`program_id`,`external_system`,`external_identifier`);
CREATE INDEX `incumbent_objective_request_ix` ON `incumbent_objective` (`change_request_id`,`status`,`planned_finish`);
-- `external_item_type` was appended to the legacy table after `updated_at`.
-- Name the columns explicitly so an in-place rebuild cannot shift existing
-- title/status values into a different field.
INSERT INTO `incumbent_objective` (
  `id`,`program_id`,`change_request_id`,`external_system`,`external_identifier`,
  `external_item_type`,`title`,`summary`,`technical_owner`,`status`,
  `planned_start`,`planned_finish`,`actual_start`,`actual_finish`,
  `source_locator`,`source_as_of`,`created_by_user_id`,`created_at`,`updated_at`
)
SELECT
  `id`,`program_id`,`change_request_id`,`external_system`,`external_identifier`,
  `external_item_type`,`title`,`summary`,`technical_owner`,`status`,
  `planned_start`,`planned_finish`,`actual_start`,`actual_finish`,
  `source_locator`,`source_as_of`,`created_by_user_id`,`created_at`,`updated_at`
FROM `incumbent_objective_import_backup`;

-- A source can report one Objective against zero, one, or several Change
-- Requests. These links record what was reported; they do not make a funding
-- decision, establish incumbent ownership, or overwrite Government analysis.
CREATE TABLE `objective_change_request_link` (
  `id` text PRIMARY KEY NOT NULL,
  `program_id` text NOT NULL,
  `objective_id` text NOT NULL,
  `change_request_id` text NOT NULL,
  `relationship` text DEFAULT 'reported' NOT NULL,
  `source_system` text,
  `source_locator` text,
  `source_as_of` text,
  `created_by_user_id` text,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  FOREIGN KEY (`program_id`) REFERENCES `program`(`id`),
  FOREIGN KEY (`objective_id`) REFERENCES `incumbent_objective`(`id`),
  FOREIGN KEY (`change_request_id`) REFERENCES `change_request`(`id`),
  FOREIGN KEY (`created_by_user_id`) REFERENCES `app_user`(`id`),
  CONSTRAINT `objective_change_request_link_relationship` CHECK(`relationship` IN ('primary','reported','related'))
);
CREATE UNIQUE INDEX `objective_change_request_link_uq` ON `objective_change_request_link` (`objective_id`,`change_request_id`,`relationship`);
CREATE INDEX `objective_change_request_link_request_ix` ON `objective_change_request_link` (`change_request_id`,`relationship`,`objective_id`);
CREATE INDEX `objective_change_request_link_objective_ix` ON `objective_change_request_link` (`objective_id`,`relationship`,`change_request_id`);
INSERT INTO `objective_change_request_link` (`id`,`program_id`,`objective_id`,`change_request_id`,`relationship`,`source_system`,`source_locator`,`source_as_of`,`created_by_user_id`,`created_at`,`updated_at`)
SELECT 'migrated-objective-cr-' || `id`,`program_id`,`id`,`change_request_id`,'primary','Legacy application association',`source_locator`,`source_as_of`,`created_by_user_id`,`created_at`,`updated_at`
FROM `incumbent_objective_import_backup`
WHERE `change_request_id` IS NOT NULL;

CREATE TABLE `objective_estimate` (
  `id` text PRIMARY KEY NOT NULL, `objective_id` text NOT NULL, `estimate_source` text NOT NULL,
  `hours_low` real, `hours_likely` real, `hours_high` real, `cost_low` real, `cost_likely` real, `cost_high` real,
  `basis` text NOT NULL, `assumptions` text, `source_reference` text, `as_of` text NOT NULL, `confidence` text DEFAULT 'unassessed' NOT NULL,
  `created_by_user_id` text, `created_at` text NOT NULL, `updated_at` text NOT NULL,
  FOREIGN KEY (`objective_id`) REFERENCES `incumbent_objective`(`id`), FOREIGN KEY (`created_by_user_id`) REFERENCES `app_user`(`id`),
  CONSTRAINT `objective_estimate_source` CHECK(`estimate_source` IN ('incumbent','government','independent')),
  CONSTRAINT `objective_estimate_confidence` CHECK(`confidence` IN ('unassessed','low','medium','high')),
  CONSTRAINT `objective_estimate_nonnegative` CHECK(COALESCE(`hours_low`,0) >= 0 AND COALESCE(`hours_likely`,0) >= 0 AND COALESCE(`hours_high`,0) >= 0 AND COALESCE(`cost_low`,0) >= 0 AND COALESCE(`cost_likely`,0) >= 0 AND COALESCE(`cost_high`,0) >= 0)
);
CREATE INDEX `objective_estimate_objective_ix` ON `objective_estimate` (`objective_id`,`estimate_source`,`as_of`);
INSERT INTO `objective_estimate` SELECT * FROM `objective_estimate_import_backup`;

CREATE TABLE `requirement_trace` (
  `id` text PRIMARY KEY NOT NULL, `objective_id` text NOT NULL, `external_identifier` text NOT NULL, `title` text NOT NULL,
  `source_system` text NOT NULL, `source_locator` text, `source_as_of` text, `change_action` text DEFAULT 'verify' NOT NULL,
  `before_text` text, `after_text` text, `rationale` text, `trace_status` text DEFAULT 'identified' NOT NULL,
  `created_by_user_id` text, `created_at` text NOT NULL, `updated_at` text NOT NULL,
  FOREIGN KEY (`objective_id`) REFERENCES `incumbent_objective`(`id`), FOREIGN KEY (`created_by_user_id`) REFERENCES `app_user`(`id`),
  CONSTRAINT `requirement_trace_action` CHECK(`change_action` IN ('add','modify','retire','verify','none')),
  CONSTRAINT `requirement_trace_status` CHECK(`trace_status` IN ('identified','analysis_needed','traced','verified','not_applicable'))
);
CREATE UNIQUE INDEX `requirement_trace_objective_external_uq` ON `requirement_trace` (`objective_id`,`external_identifier`);
CREATE INDEX `requirement_trace_status_ix` ON `requirement_trace` (`objective_id`,`trace_status`);
INSERT INTO `requirement_trace` SELECT * FROM `requirement_trace_import_backup`;

CREATE TABLE `acceptance_criterion` (
  `id` text PRIMARY KEY NOT NULL, `objective_id` text NOT NULL, `requirement_trace_id` text, `tier` text NOT NULL,
  `code` text NOT NULL, `statement` text NOT NULL, `verification_method` text NOT NULL, `status` text DEFAULT 'draft' NOT NULL,
  `planned_date` text, `actual_date` text, `evidence_reference` text, `created_by_user_id` text,
  `created_at` text NOT NULL, `updated_at` text NOT NULL, `objective_requirement_id` text,
  FOREIGN KEY (`objective_id`) REFERENCES `incumbent_objective`(`id`), FOREIGN KEY (`requirement_trace_id`) REFERENCES `requirement_trace`(`id`), FOREIGN KEY (`created_by_user_id`) REFERENCES `app_user`(`id`),
  CONSTRAINT `acceptance_criterion_tier` CHECK(`tier` IN ('tier_3','tier_4','other')),
  CONSTRAINT `acceptance_criterion_method` CHECK(`verification_method` IN ('analysis','demonstration','inspection','test','review')),
  CONSTRAINT `acceptance_criterion_status` CHECK(`status` IN ('draft','ready','in_verification','passed','failed','waived'))
);
CREATE UNIQUE INDEX `acceptance_criterion_objective_code_uq` ON `acceptance_criterion` (`objective_id`,`code`);
CREATE INDEX `acceptance_criterion_status_ix` ON `acceptance_criterion` (`objective_id`,`status`,`planned_date`);
CREATE INDEX `acceptance_criterion_objective_requirement_ix` ON `acceptance_criterion` (`objective_requirement_id`);
INSERT INTO `acceptance_criterion` SELECT * FROM `acceptance_criterion_import_backup`;

CREATE TABLE `acceptance_signoff` (
  `id` text PRIMARY KEY NOT NULL, `criterion_id` text NOT NULL, `signoff_role` text NOT NULL, `signer` text,
  `decision` text DEFAULT 'pending' NOT NULL, `decided_at` text, `rationale` text, `evidence_document_id` text,
  `created_by_user_id` text, `created_at` text NOT NULL, `updated_at` text NOT NULL,
  FOREIGN KEY (`criterion_id`) REFERENCES `acceptance_criterion`(`id`), FOREIGN KEY (`created_by_user_id`) REFERENCES `app_user`(`id`),
  CONSTRAINT `acceptance_signoff_decision` CHECK(`decision` IN ('pending','accepted','rejected','waived'))
);
CREATE UNIQUE INDEX `acceptance_signoff_role_uq` ON `acceptance_signoff` (`criterion_id`,`signoff_role`);
CREATE INDEX `acceptance_signoff_decision_ix` ON `acceptance_signoff` (`criterion_id`,`decision`);
INSERT INTO `acceptance_signoff` SELECT * FROM `acceptance_signoff_import_backup`;

CREATE TABLE `initiative_milestone` (
  `id` text PRIMARY KEY NOT NULL, `initiative_id` text NOT NULL, `change_request_id` text, `objective_id` text,
  `title` text NOT NULL, `milestone_type` text NOT NULL, `planned_date` text NOT NULL, `actual_date` text,
  `status` text DEFAULT 'planned' NOT NULL, `consequence_if_missed` text, `owner` text, `sort_order` integer DEFAULT 0 NOT NULL,
  `created_by_user_id` text, `created_at` text NOT NULL, `updated_at` text NOT NULL,
  FOREIGN KEY (`initiative_id`) REFERENCES `initiative`(`id`), FOREIGN KEY (`change_request_id`) REFERENCES `change_request`(`id`), FOREIGN KEY (`objective_id`) REFERENCES `incumbent_objective`(`id`), FOREIGN KEY (`created_by_user_id`) REFERENCES `app_user`(`id`),
  CONSTRAINT `initiative_milestone_type` CHECK(`milestone_type` IN ('decision','delivery','verification','fielding','dependency')),
  CONSTRAINT `initiative_milestone_status` CHECK(`status` IN ('planned','at_risk','complete','missed'))
);
CREATE INDEX `initiative_milestone_timeline_ix` ON `initiative_milestone` (`initiative_id`,`planned_date`,`status`);
CREATE INDEX `initiative_milestone_request_ix` ON `initiative_milestone` (`change_request_id`,`planned_date`);
INSERT INTO `initiative_milestone` SELECT * FROM `initiative_milestone_import_backup`;

CREATE TABLE `change_request_objective_dependency` (
  `id` text PRIMARY KEY NOT NULL, `dependent_change_request_id` text NOT NULL, `prerequisite_objective_id` text NOT NULL,
  `relationship` text DEFAULT 'requires' NOT NULL, `status` text DEFAULT 'proposed' NOT NULL, `rationale` text NOT NULL,
  `source_reference` text, `source_as_of` text, `evidence_reference` text, `created_by_user_id` text,
  `created_at` text NOT NULL, `updated_at` text NOT NULL,
  FOREIGN KEY (`dependent_change_request_id`) REFERENCES `change_request`(`id`), FOREIGN KEY (`prerequisite_objective_id`) REFERENCES `incumbent_objective`(`id`), FOREIGN KEY (`created_by_user_id`) REFERENCES `app_user`(`id`),
  CONSTRAINT `change_request_objective_dependency_relationship` CHECK(`relationship` IN ('requires','enables','blocks','consumes')),
  CONSTRAINT `change_request_objective_dependency_status` CHECK(`status` IN ('proposed','accepted','rejected','retired'))
);
CREATE UNIQUE INDEX `change_request_objective_dependency_uq` ON `change_request_objective_dependency` (`dependent_change_request_id`,`prerequisite_objective_id`,`relationship`);
CREATE INDEX `change_request_objective_dependency_objective_ix` ON `change_request_objective_dependency` (`prerequisite_objective_id`,`status`);
CREATE INDEX `change_request_objective_dependency_request_ix` ON `change_request_objective_dependency` (`dependent_change_request_id`,`status`);
INSERT INTO `change_request_objective_dependency` SELECT * FROM `change_request_objective_dependency_import_backup`;

CREATE TABLE `objective_effect_attribution` (
  `id` text PRIMARY KEY NOT NULL, `objective_id` text NOT NULL REFERENCES `incumbent_objective`(`id`),
  `change_effect_id` text NOT NULL REFERENCES `change_effect`(`id`), `attribution` text DEFAULT 'contributing' NOT NULL CHECK(`attribution` IN ('primary','contributing','uncertain')),
  `rationale` text NOT NULL, `source_reference` text, `source_as_of` text, `evidence_reference` text,
  `confidence` text DEFAULT 'unassessed' NOT NULL CHECK(`confidence` IN ('unassessed','low','medium','high')),
  `created_by_user_id` text REFERENCES `app_user`(`id`), `created_at` text NOT NULL, `updated_at` text NOT NULL
);
CREATE UNIQUE INDEX `objective_effect_attribution_uq` ON `objective_effect_attribution` (`objective_id`,`change_effect_id`);
CREATE INDEX `objective_effect_attribution_effect_ix` ON `objective_effect_attribution` (`change_effect_id`,`attribution`);
CREATE INDEX `objective_effect_attribution_objective_ix` ON `objective_effect_attribution` (`objective_id`,`attribution`);
INSERT INTO `objective_effect_attribution` SELECT * FROM `objective_effect_attribution_import_backup`;

CREATE TABLE `objective_source_row` (
  `id` text PRIMARY KEY NOT NULL, `source_package_id` text NOT NULL, `row_number` integer NOT NULL, `external_system` text NOT NULL,
  `external_identifier` text NOT NULL, `raw_payload` text NOT NULL, `disposition` text NOT NULL, `objective_id` text,
  `created_at` text NOT NULL, FOREIGN KEY (`source_package_id`) REFERENCES `objective_source_package`(`id`), FOREIGN KEY (`objective_id`) REFERENCES `incumbent_objective`(`id`),
  CONSTRAINT `objective_source_row_disposition` CHECK(`disposition` IN ('add','change','unchanged','blocked'))
);
CREATE UNIQUE INDEX `objective_source_row_number_uq` ON `objective_source_row` (`source_package_id`,`row_number`);
CREATE INDEX `objective_source_row_key_ix` ON `objective_source_row` (`external_system`,`external_identifier`);
INSERT INTO `objective_source_row` SELECT * FROM `objective_source_row_import_backup`;

CREATE TABLE `objective_requirement` (
  `id` text PRIMARY KEY NOT NULL, `objective_id` text NOT NULL, `requirement_id` text NOT NULL, `version_label` text DEFAULT '1' NOT NULL,
  `change_action` text DEFAULT 'verify' NOT NULL, `before_text` text, `after_text` text, `rationale` text,
  `disposition` text DEFAULT 'identified' NOT NULL, `source_reference` text, `source_as_of` text, `created_by_user_id` text,
  `created_at` text NOT NULL, `updated_at` text NOT NULL,
  FOREIGN KEY (`objective_id`) REFERENCES `incumbent_objective`(`id`), FOREIGN KEY (`requirement_id`) REFERENCES `requirement`(`id`), FOREIGN KEY (`created_by_user_id`) REFERENCES `app_user`(`id`),
  CONSTRAINT `objective_requirement_action` CHECK(`change_action` IN ('add','modify','retire','verify','none')),
  CONSTRAINT `objective_requirement_disposition` CHECK(`disposition` IN ('identified','analysis_needed','traced','verified','not_applicable'))
);
CREATE UNIQUE INDEX `objective_requirement_version_uq` ON `objective_requirement` (`objective_id`,`requirement_id`,`version_label`);
CREATE INDEX `objective_requirement_requirement_ix` ON `objective_requirement` (`requirement_id`,`disposition`);
INSERT INTO `objective_requirement` SELECT * FROM `objective_requirement_import_backup`;

CREATE TABLE `work_package` (
  `id` text PRIMARY KEY NOT NULL, `initiative_id` text, `change_request_id` text, `objective_id` text, `parent_id` text,
  `wbs_code` text NOT NULL, `title` text NOT NULL, `owner` text, `planned_start` text, `due_date` text, `actual_start` text, `actual_finish` text,
  `status` text DEFAULT 'planned' NOT NULL, `definition_of_done` text, `progress_basis` text, `notes` text, `sort_order` integer DEFAULT 0 NOT NULL,
  `created_at` text NOT NULL, `updated_at` text NOT NULL, `work_type` text DEFAULT 'analysis' NOT NULL,
  FOREIGN KEY (`initiative_id`) REFERENCES `initiative`(`id`), FOREIGN KEY (`change_request_id`) REFERENCES `change_request`(`id`), FOREIGN KEY (`objective_id`) REFERENCES `incumbent_objective`(`id`),
  CONSTRAINT `work_package_status` CHECK(`status` IN ('planned','in_progress','on_hold','complete')),
  CONSTRAINT `work_package_context` CHECK(`objective_id` IS NOT NULL OR `initiative_id` IS NOT NULL)
);
CREATE UNIQUE INDEX `work_package_objective_code_uq` ON `work_package` (`objective_id`,`wbs_code`);
CREATE UNIQUE INDEX `work_package_initiative_code_v2_uq` ON `work_package` (`initiative_id`,`wbs_code`) WHERE `initiative_id` IS NOT NULL;
CREATE INDEX `work_package_initiative_status_ix` ON `work_package` (`initiative_id`,`status`,`due_date`);
CREATE INDEX `work_package_objective_status_ix` ON `work_package` (`objective_id`,`status`,`due_date`);
CREATE INDEX `work_package_request_ix` ON `work_package` (`change_request_id`,`status`);
INSERT INTO `work_package` SELECT * FROM `work_package_import_backup`;
-- Preserve pre-existing work-package rows during canonicalization.  Some
-- legacy rows retained a parent from a different Initiative; the forward
-- guard must not prevent their historical import.  New or re-parented
-- Initiative work is governed immediately after the data is materialized.
CREATE TRIGGER `work_package_parent_same_initiative_insert`
BEFORE INSERT ON `work_package`
WHEN NEW.`parent_id` IS NOT NULL AND NEW.`initiative_id` IS NOT NULL
 AND NOT EXISTS (SELECT 1 FROM `work_package` p WHERE p.`id`=NEW.`parent_id` AND p.`initiative_id`=NEW.`initiative_id`)
BEGIN SELECT RAISE(ABORT, 'Work package parent must belong to the same Initiative'); END;
CREATE TRIGGER `work_package_parent_same_initiative_update`
BEFORE UPDATE OF `parent_id`,`initiative_id` ON `work_package`
WHEN NEW.`parent_id` IS NOT NULL AND NEW.`initiative_id` IS NOT NULL
 AND NOT EXISTS (SELECT 1 FROM `work_package` p WHERE p.`id`=NEW.`parent_id` AND p.`initiative_id`=NEW.`initiative_id`)
BEGIN SELECT RAISE(ABORT, 'Work package parent must belong to the same Initiative'); END;

CREATE TABLE `work_package_objective` (
  `id` text PRIMARY KEY NOT NULL, `work_package_id` text NOT NULL, `objective_id` text NOT NULL, `relationship` text DEFAULT 'supports' NOT NULL,
  `rationale` text, `created_by_user_id` text, `created_at` text NOT NULL, `updated_at` text NOT NULL,
  FOREIGN KEY (`work_package_id`) REFERENCES `work_package`(`id`), FOREIGN KEY (`objective_id`) REFERENCES `incumbent_objective`(`id`), FOREIGN KEY (`created_by_user_id`) REFERENCES `app_user`(`id`),
  CONSTRAINT `work_package_objective_relationship` CHECK(`relationship` IN ('supports','assesses','verifies','coordinates'))
);
CREATE UNIQUE INDEX `work_package_objective_uq` ON `work_package_objective` (`work_package_id`,`objective_id`,`relationship`);
CREATE INDEX `work_package_objective_objective_ix` ON `work_package_objective` (`objective_id`,`relationship`);
INSERT INTO `work_package_objective` SELECT * FROM `work_package_objective_import_backup`;

CREATE TABLE `work_package_dependency` (
  `id` text PRIMARY KEY NOT NULL, `predecessor_work_package_id` text NOT NULL, `successor_work_package_id` text NOT NULL,
  `relationship` text DEFAULT 'FS' NOT NULL, `lag_days` integer DEFAULT 0 NOT NULL, `status` text DEFAULT 'proposed' NOT NULL,
  `rationale` text NOT NULL, `source_reference` text, `created_by_user_id` text, `created_at` text NOT NULL, `updated_at` text NOT NULL,
  FOREIGN KEY (`predecessor_work_package_id`) REFERENCES `work_package`(`id`), FOREIGN KEY (`successor_work_package_id`) REFERENCES `work_package`(`id`), FOREIGN KEY (`created_by_user_id`) REFERENCES `app_user`(`id`),
  CONSTRAINT `work_package_dependency_relationship` CHECK(`relationship` IN ('FS','SS','FF','SF')),
  CONSTRAINT `work_package_dependency_status` CHECK(`status` IN ('proposed','accepted','rejected','retired')),
  CONSTRAINT `work_package_dependency_not_self` CHECK(`predecessor_work_package_id` <> `successor_work_package_id`)
);
CREATE UNIQUE INDEX `work_package_dependency_uq` ON `work_package_dependency` (`predecessor_work_package_id`,`successor_work_package_id`,`relationship`);
CREATE INDEX `work_package_dependency_successor_ix` ON `work_package_dependency` (`successor_work_package_id`,`status`);
INSERT INTO `work_package_dependency` SELECT * FROM `work_package_dependency_import_backup`;

CREATE TABLE `lm_objective_feed_subject` (
  `id` text PRIMARY KEY NOT NULL, `program_id` text NOT NULL, `external_system` text NOT NULL, `feed_key` text NOT NULL,
  `jira_identifier` text, `url` text, `canonical_objective_id` text, `created_at` text NOT NULL, `updated_at` text NOT NULL,
  FOREIGN KEY (`program_id`) REFERENCES `program`(`id`), FOREIGN KEY (`canonical_objective_id`) REFERENCES `incumbent_objective`(`id`)
);
CREATE UNIQUE INDEX `lm_objective_feed_subject_key_uq` ON `lm_objective_feed_subject` (`program_id`,`external_system`,`feed_key`);
CREATE INDEX `lm_objective_feed_subject_objective_ix` ON `lm_objective_feed_subject` (`canonical_objective_id`);
INSERT INTO `lm_objective_feed_subject` SELECT * FROM `lm_objective_feed_subject_import_backup`;

CREATE TABLE `lm_objective_feed_state` (
  `subject_id` text PRIMARY KEY NOT NULL, `latest_snapshot_id` text NOT NULL, `feed_key` text NOT NULL, `url` text, `rel_to` text,
  `roadmap_parent` text, `scope` text, `domains_json` text DEFAULT '[]' NOT NULL, `item_number` integer, `target_start` text,
  `target_finish` text, `rom` text, `percent_complete` real, `funding` text, `release` text, `overview` text, `background` text, `updated_at` text NOT NULL,
  FOREIGN KEY (`subject_id`) REFERENCES `lm_objective_feed_subject`(`id`), FOREIGN KEY (`latest_snapshot_id`) REFERENCES `lm_objective_feed_snapshot`(`id`)
);
CREATE INDEX `lm_objective_feed_state_snapshot_ix` ON `lm_objective_feed_state` (`latest_snapshot_id`);
INSERT INTO `lm_objective_feed_state` SELECT * FROM `lm_objective_feed_state_import_backup`;

CREATE TABLE `lm_objective_feed_jpo_link` (
  `id` text PRIMARY KEY NOT NULL, `subject_id` text NOT NULL, `latest_snapshot_id` text NOT NULL, `external_identifier` text NOT NULL,
  `change_request_id` text, `created_at` text NOT NULL, `updated_at` text NOT NULL,
  FOREIGN KEY (`subject_id`) REFERENCES `lm_objective_feed_subject`(`id`), FOREIGN KEY (`latest_snapshot_id`) REFERENCES `lm_objective_feed_snapshot`(`id`), FOREIGN KEY (`change_request_id`) REFERENCES `change_request`(`id`)
);
CREATE UNIQUE INDEX `lm_objective_feed_jpo_link_uq` ON `lm_objective_feed_jpo_link` (`subject_id`,`external_identifier`);
CREATE INDEX `lm_objective_feed_jpo_link_request_ix` ON `lm_objective_feed_jpo_link` (`change_request_id`);
INSERT INTO `lm_objective_feed_jpo_link` SELECT * FROM `lm_objective_feed_jpo_link_import_backup`;

CREATE TABLE `lm_objective_feed_item` (
  `id` text PRIMARY KEY NOT NULL, `snapshot_id` text NOT NULL, `subject_id` text NOT NULL, `feed_key` text NOT NULL,
  `jira_identifier` text, `jpo_raw` text, `disposition` text NOT NULL, `normalized_payload` text NOT NULL, `raw_payload` text NOT NULL,
  `content_hash` text NOT NULL, `created_at` text NOT NULL,
  FOREIGN KEY (`snapshot_id`) REFERENCES `lm_objective_feed_snapshot`(`id`), FOREIGN KEY (`subject_id`) REFERENCES `lm_objective_feed_subject`(`id`),
  CONSTRAINT `lm_objective_feed_item_disposition` CHECK(`disposition` IN ('add','change','unchanged','blocked'))
);
CREATE UNIQUE INDEX `lm_objective_feed_item_snapshot_key_uq` ON `lm_objective_feed_item` (`snapshot_id`,`feed_key`);
CREATE INDEX `lm_objective_feed_item_subject_ix` ON `lm_objective_feed_item` (`subject_id`,`snapshot_id`);
INSERT INTO `lm_objective_feed_item` SELECT * FROM `lm_objective_feed_item_import_backup`;

CREATE TABLE `lm_objective_feed_dependency` (
  `id` text PRIMARY KEY NOT NULL, `snapshot_id` text NOT NULL, `source_feed_key` text NOT NULL, `source_subject_id` text NOT NULL,
  `direction` text NOT NULL, `target_reference` text NOT NULL, `target_subject_id` text, `created_at` text NOT NULL,
  FOREIGN KEY (`snapshot_id`) REFERENCES `lm_objective_feed_snapshot`(`id`), FOREIGN KEY (`source_subject_id`) REFERENCES `lm_objective_feed_subject`(`id`), FOREIGN KEY (`target_subject_id`) REFERENCES `lm_objective_feed_subject`(`id`),
  CONSTRAINT `lm_objective_feed_dependency_direction` CHECK(`direction` IN ('blocks','blocked_by'))
);
CREATE UNIQUE INDEX `lm_objective_feed_dependency_uq` ON `lm_objective_feed_dependency` (`snapshot_id`,`source_feed_key`,`direction`,`target_reference`);
CREATE INDEX `lm_objective_feed_dependency_source_ix` ON `lm_objective_feed_dependency` (`source_subject_id`,`snapshot_id`);
CREATE INDEX `lm_objective_feed_dependency_target_ix` ON `lm_objective_feed_dependency` (`target_subject_id`,`snapshot_id`);
INSERT INTO `lm_objective_feed_dependency` SELECT * FROM `lm_objective_feed_dependency_import_backup`;

CREATE TABLE `lm_objective_feed_delta` (
  `id` text PRIMARY KEY NOT NULL, `snapshot_id` text NOT NULL, `subject_id` text NOT NULL, `feed_key` text NOT NULL,
  `change_kind` text NOT NULL, `field_name` text, `before_value` text, `after_value` text, `created_at` text NOT NULL,
  FOREIGN KEY (`snapshot_id`) REFERENCES `lm_objective_feed_snapshot`(`id`), FOREIGN KEY (`subject_id`) REFERENCES `lm_objective_feed_subject`(`id`),
  CONSTRAINT `lm_objective_feed_delta_kind` CHECK(`change_kind` IN ('added','changed','unchanged','removed','blocked'))
);
CREATE INDEX `lm_objective_feed_delta_snapshot_ix` ON `lm_objective_feed_delta` (`snapshot_id`,`change_kind`);
CREATE INDEX `lm_objective_feed_delta_subject_ix` ON `lm_objective_feed_delta` (`subject_id`,`snapshot_id`);
INSERT INTO `lm_objective_feed_delta` SELECT * FROM `lm_objective_feed_delta_import_backup`;

DROP TABLE `acceptance_signoff_import_backup`;
DROP TABLE `acceptance_criterion_import_backup`;
DROP TABLE `objective_estimate_import_backup`;
DROP TABLE `requirement_trace_import_backup`;
DROP TABLE `initiative_milestone_import_backup`;
DROP TABLE `change_request_objective_dependency_import_backup`;
DROP TABLE `objective_effect_attribution_import_backup`;
DROP TABLE `objective_source_row_import_backup`;
DROP TABLE `objective_requirement_import_backup`;
DROP TABLE `work_package_dependency_import_backup`;
DROP TABLE `work_package_objective_import_backup`;
DROP TABLE `work_package_import_backup`;
DROP TABLE `lm_objective_feed_delta_import_backup`;
DROP TABLE `lm_objective_feed_dependency_import_backup`;
DROP TABLE `lm_objective_feed_item_import_backup`;
DROP TABLE `lm_objective_feed_jpo_link_import_backup`;
DROP TABLE `lm_objective_feed_state_import_backup`;
DROP TABLE `lm_objective_feed_subject_import_backup`;
DROP TABLE `incumbent_objective_import_backup`;
PRAGMA optimize;
