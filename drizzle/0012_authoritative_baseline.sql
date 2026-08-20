-- Phase 1: the application database is authoritative.  Imported A2O rows are
-- immutable evidence linked to a Baseline Record; they are no longer a
-- required identity for that record.
PRAGMA foreign_keys=OFF;
-- D1 applies a migration inside a transaction, where foreign_keys cannot be
-- toggled. Deferral is transaction-scoped and lets dependent rows remain valid
-- once the replacement table is renamed back to baseline_occurrence.
PRAGMA defer_foreign_keys=ON;

-- baseline_occurrence has three direct FK children. change_effect has one
-- further child. Keep their complete row sets in temporary tables, remove the
-- FK-bearing tables, then recreate them against the replacement parent.
CREATE TABLE `managed_deployment_profile_authoritative_backup` AS
SELECT * FROM `managed_deployment_profile`;
CREATE TABLE `platform_baseline_assignment_authoritative_backup` AS
SELECT * FROM `platform_baseline_assignment`;
CREATE TABLE `objective_effect_attribution_authoritative_backup` AS
SELECT * FROM `objective_effect_attribution`;
CREATE TABLE `change_effect_authoritative_backup` AS
SELECT * FROM `change_effect`;
DROP TABLE `objective_effect_attribution`;
DROP TABLE `managed_deployment_profile`;
DROP TABLE `platform_baseline_assignment`;
DROP TABLE `change_effect`;

-- SQLite cannot relax NOT NULL in place. Rebuild only the parent table while
-- preserving its existing identifiers so all dependent references remain valid.
CREATE TABLE `baseline_occurrence_next` (
  `id` text PRIMARY KEY NOT NULL,
  `program_id` text NOT NULL REFERENCES `program`(`id`),
  `workspace_id` text NOT NULL REFERENCES `baseline_workspace`(`id`),
  `source_row_id` text REFERENCES `source_row_24`(`id`),
  `release_id` text REFERENCES `release`(`id`),
  `baseline_id` text REFERENCES `configuration_baseline`(`id`),
  `configuration_node_id` text REFERENCES `configuration_node`(`id`),
  `product_id` text REFERENCES `product`(`id`),
  `deployment_id` text REFERENCES `deployment`(`id`),
  -- Transitional compatibility cache. New application reads assemble the A2O
  -- export from normalized state plus baseline_record_extension instead.
  `projection_payload` text NOT NULL,
  `materialization_status` text DEFAULT 'reported' NOT NULL,
  `lifecycle_status` text DEFAULT 'active' NOT NULL,
  `lifecycle_reason` text,
  `voided_at` text,
  `voided_by_user_id` text,
  `revision` integer DEFAULT 0 NOT NULL,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL
);
INSERT INTO `baseline_occurrence_next` (
  `id`,`program_id`,`workspace_id`,`source_row_id`,`release_id`,`baseline_id`,
  `configuration_node_id`,`product_id`,`deployment_id`,`projection_payload`,
  `materialization_status`,`lifecycle_status`,`lifecycle_reason`,`voided_at`,
  `voided_by_user_id`,`revision`,`created_at`,`updated_at`
)
SELECT
  `id`,`program_id`,`workspace_id`,`source_row_id`,`release_id`,`baseline_id`,
  `configuration_node_id`,`product_id`,`deployment_id`,`projection_payload`,
  `materialization_status`,`lifecycle_status`,`lifecycle_reason`,`voided_at`,
  `voided_by_user_id`,`revision`,`created_at`,`updated_at`
FROM `baseline_occurrence`;
DROP TABLE `baseline_occurrence`;
ALTER TABLE `baseline_occurrence_next` RENAME TO `baseline_occurrence`;
CREATE UNIQUE INDEX `baseline_occurrence_workspace_source_uq` ON `baseline_occurrence` (`workspace_id`,`source_row_id`);
CREATE INDEX `baseline_occurrence_workspace_release_ix` ON `baseline_occurrence` (`workspace_id`,`release_id`,`baseline_id`);
CREATE INDEX `baseline_occurrence_workspace_product_ix` ON `baseline_occurrence` (`workspace_id`,`product_id`);
CREATE INDEX `baseline_occurrence_workspace_lifecycle_ix` ON `baseline_occurrence` (`workspace_id`,`lifecycle_status`,`release_id`);
CREATE INDEX `baseline_occurrence_workspace_deployment_ix` ON `baseline_occurrence` (`workspace_id`,`deployment_id`,`lifecycle_status`);

CREATE TABLE `managed_deployment_profile` (
  `id` text PRIMARY KEY NOT NULL,
  `program_id` text NOT NULL REFERENCES `program`(`id`),
  `baseline_occurrence_id` text NOT NULL REFERENCES `baseline_occurrence`(`id`),
  `release_id` text NOT NULL REFERENCES `release`(`id`),
  `configuration_node_id` text REFERENCES `configuration_node`(`id`),
  `product_id` text REFERENCES `product`(`id`),
  `virtual_machine` text,
  `container_instance` text,
  `application_version` text,
  `installation_identifier` text,
  `deployment_role` text,
  `source_reference` text,
  `notes` text,
  `created_by_user_id` text REFERENCES `app_user`(`id`),
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL
);
CREATE UNIQUE INDEX `managed_deployment_profile_occurrence_uq` ON `managed_deployment_profile` (`baseline_occurrence_id`);
CREATE INDEX `managed_deployment_profile_release_product_ix` ON `managed_deployment_profile` (`program_id`,`release_id`,`product_id`);
INSERT INTO `managed_deployment_profile` SELECT * FROM `managed_deployment_profile_authoritative_backup`;
DROP TABLE `managed_deployment_profile_authoritative_backup`;

CREATE TABLE `platform_baseline_assignment` (
  `id` text PRIMARY KEY NOT NULL,
  `program_id` text NOT NULL REFERENCES `program`(`id`),
  `platform_id` text NOT NULL REFERENCES `platform`(`id`),
  `baseline_occurrence_id` text NOT NULL REFERENCES `baseline_occurrence`(`id`),
  `release_id` text NOT NULL REFERENCES `release`(`id`),
  `assignment_role` text DEFAULT 'primary' NOT NULL CHECK (`assignment_role` IN ('primary','supporting')),
  `confidence` text DEFAULT 'assessed' NOT NULL CHECK (`confidence` IN ('reported','assessed','confirmed')),
  `review_status` text DEFAULT 'not_reviewed' NOT NULL CHECK (`review_status` IN ('not_reviewed','reviewed','follow_up')),
  `source_reference` text,
  `source_as_of` text,
  `reviewed_by_user_id` text REFERENCES `app_user`(`id`),
  `reviewed_at` text,
  `created_by_user_id` text REFERENCES `app_user`(`id`),
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL
);
CREATE UNIQUE INDEX `platform_assignment_occurrence_role_uq` ON `platform_baseline_assignment` (`baseline_occurrence_id`,`assignment_role`);
CREATE INDEX `platform_assignment_platform_release_ix` ON `platform_baseline_assignment` (`platform_id`,`release_id`,`review_status`);
INSERT INTO `platform_baseline_assignment` SELECT * FROM `platform_baseline_assignment_authoritative_backup`;
DROP TABLE `platform_baseline_assignment_authoritative_backup`;

CREATE TABLE `change_effect` (
  `id` text PRIMARY KEY NOT NULL,
  `change_request_id` text NOT NULL REFERENCES `change_request`(`id`),
  `subject_kind` text NOT NULL,
  `subject_id` text NOT NULL,
  `action` text DEFAULT 'modify' NOT NULL CHECK (`action` IN ('add','remove','move','modify','assess')),
  `aspect` text DEFAULT 'configuration' NOT NULL,
  `from_release_id` text REFERENCES `release`(`id`),
  `to_release_id` text REFERENCES `release`(`id`),
  `current_value` text,
  `target_value` text,
  `consequence` text,
  `rationale` text,
  `confidence` text DEFAULT 'reported' NOT NULL CHECK (`confidence` IN ('reported','assessed','confirmed')),
  `source_occurrence_id` text REFERENCES `baseline_occurrence`(`id`),
  `created_by_user_id` text REFERENCES `app_user`(`id`),
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  CHECK (`subject_kind` IN ('product','platform','configuration_node','occurrence','release','organization'))
);
CREATE INDEX `change_effect_request_ix` ON `change_effect` (`change_request_id`,`subject_kind`);
CREATE INDEX `change_effect_subject_ix` ON `change_effect` (`subject_kind`,`subject_id`);
INSERT INTO `change_effect` SELECT * FROM `change_effect_authoritative_backup`;
DROP TABLE `change_effect_authoritative_backup`;

CREATE TABLE `objective_effect_attribution` (
  `id` text PRIMARY KEY NOT NULL,
  `objective_id` text NOT NULL REFERENCES `incumbent_objective`(`id`),
  `change_effect_id` text NOT NULL REFERENCES `change_effect`(`id`),
  `attribution` text DEFAULT 'contributing' NOT NULL CHECK (`attribution` IN ('primary','contributing','uncertain')),
  `rationale` text NOT NULL,
  `source_reference` text,
  `source_as_of` text,
  `evidence_reference` text,
  `confidence` text DEFAULT 'unassessed' NOT NULL CHECK (`confidence` IN ('unassessed','low','medium','high')),
  `created_by_user_id` text REFERENCES `app_user`(`id`),
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL
);
CREATE UNIQUE INDEX `objective_effect_attribution_uq` ON `objective_effect_attribution` (`objective_id`,`change_effect_id`);
CREATE INDEX `objective_effect_attribution_effect_ix` ON `objective_effect_attribution` (`change_effect_id`,`attribution`);
CREATE INDEX `objective_effect_attribution_objective_ix` ON `objective_effect_attribution` (`objective_id`,`attribution`);
INSERT INTO `objective_effect_attribution` SELECT * FROM `objective_effect_attribution_authoritative_backup`;
DROP TABLE `objective_effect_attribution_authoritative_backup`;

CREATE TABLE `baseline_record_extension` (
  `baseline_occurrence_id` text PRIMARY KEY NOT NULL REFERENCES `baseline_occurrence`(`id`),
  `source_key` text,
  `notes` text,
  `capability_notes` text,
  `notes_1` text,
  `notes_2` text,
  `notes_3` text,
  `notes_4` text,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL
);
CREATE INDEX `baseline_record_extension_source_key_ix` ON `baseline_record_extension` (`source_key`);

-- Preserve existing editable values where the prior projection cache contains
-- them; otherwise retain the immutable imported value.
INSERT INTO `baseline_record_extension` (
  `baseline_occurrence_id`,`source_key`,`notes`,`capability_notes`,
  `notes_1`,`notes_2`,`notes_3`,`notes_4`,`created_at`,`updated_at`
)
SELECT
  bo.`id`,
  COALESCE(CASE WHEN json_valid(bo.`projection_payload`) THEN json_extract(bo.`projection_payload`, '$."#"') END, sr.`source_key`),
  COALESCE(CASE WHEN json_valid(bo.`projection_payload`) THEN json_extract(bo.`projection_payload`, '$.Notes') END, sr.`notes`),
  COALESCE(CASE WHEN json_valid(bo.`projection_payload`) THEN json_extract(bo.`projection_payload`, '$."Technical Capability Satisfied by this SW/Tech - Notes"') END, sr.`capability_notes`),
  COALESCE(CASE WHEN json_valid(bo.`projection_payload`) THEN json_extract(bo.`projection_payload`, '$."Notes.1"') END, sr.`notes_1`),
  COALESCE(CASE WHEN json_valid(bo.`projection_payload`) THEN json_extract(bo.`projection_payload`, '$."Notes.2"') END, sr.`notes_2`),
  COALESCE(CASE WHEN json_valid(bo.`projection_payload`) THEN json_extract(bo.`projection_payload`, '$."Notes.3"') END, sr.`notes_3`),
  COALESCE(CASE WHEN json_valid(bo.`projection_payload`) THEN json_extract(bo.`projection_payload`, '$."Notes.4"') END, sr.`notes_4`),
  bo.`created_at`, bo.`updated_at`
FROM `baseline_occurrence` bo
LEFT JOIN `source_row_24` sr ON sr.`id` = bo.`source_row_id`;

CREATE TABLE `baseline_record_source` (
  `id` text PRIMARY KEY NOT NULL,
  `baseline_occurrence_id` text NOT NULL REFERENCES `baseline_occurrence`(`id`),
  `source_row_id` text NOT NULL REFERENCES `source_row_24`(`id`),
  `relationship` text DEFAULT 'imported' NOT NULL CHECK (`relationship` IN ('imported','reconciled','reference')),
  `disposition` text DEFAULT 'current' NOT NULL CHECK (`disposition` IN ('current','superseded','rejected')),
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL
);
CREATE UNIQUE INDEX `baseline_record_source_record_row_uq` ON `baseline_record_source` (`baseline_occurrence_id`,`source_row_id`);
CREATE INDEX `baseline_record_source_row_ix` ON `baseline_record_source` (`source_row_id`,`disposition`);
CREATE INDEX `baseline_record_source_record_ix` ON `baseline_record_source` (`baseline_occurrence_id`,`disposition`);
INSERT INTO `baseline_record_source` (
  `id`,`baseline_occurrence_id`,`source_row_id`,`relationship`,`disposition`,`created_at`,`updated_at`
)
SELECT
  'migrated-baseline-source-' || bo.`id`, bo.`id`, bo.`source_row_id`,
  'imported', 'current', bo.`created_at`, bo.`updated_at`
FROM `baseline_occurrence` bo
WHERE bo.`source_row_id` IS NOT NULL;

CREATE TABLE `baseline_record_review` (
  `id` text PRIMARY KEY NOT NULL,
  `program_id` text NOT NULL REFERENCES `program`(`id`),
  `baseline_occurrence_id` text NOT NULL REFERENCES `baseline_occurrence`(`id`),
  `status` text DEFAULT 'not_reviewed' NOT NULL CHECK (`status` IN ('not_reviewed','reviewed','follow_up')),
  `reviewed_at` text,
  `reviewed_by_user_id` text REFERENCES `app_user`(`id`),
  `note` text,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL
);
CREATE UNIQUE INDEX `baseline_record_review_record_uq` ON `baseline_record_review` (`baseline_occurrence_id`);
CREATE INDEX `baseline_record_review_status_ix` ON `baseline_record_review` (`program_id`,`status`,`reviewed_at`);

-- Migrate existing source-row reviews to the record they reviewed. The legacy
-- review tables are deliberately retained for audit/read-only history.
INSERT OR IGNORE INTO `baseline_record_review` (
  `id`,`program_id`,`baseline_occurrence_id`,`status`,`reviewed_at`,`note`,`created_at`,`updated_at`
)
SELECT
  'migrated-baseline-review-' || bo.`id`, bo.`program_id`, bo.`id`, rv.`status`,
  rv.`reviewed_at`, rv.`note`, rv.`created_at`, rv.`updated_at`
FROM `baseline_occurrence` bo
JOIN `source_occurrence_review_v2` rv ON rv.`source_row_id` = bo.`source_row_id`;

-- A Configuration Baseline is independently controlled; this state is not the
-- Release lifecycle nor the As-Is/To-Be analytical role.
ALTER TABLE `configuration_baseline` ADD `revision_number` integer NOT NULL DEFAULT 1;
ALTER TABLE `configuration_baseline` ADD `approval_status` text NOT NULL DEFAULT 'working' CHECK (`approval_status` IN ('working','under_review','approved','superseded'));
ALTER TABLE `configuration_baseline` ADD `approved_at` text;
ALTER TABLE `configuration_baseline` ADD `approved_by_user_id` text REFERENCES `app_user`(`id`);
ALTER TABLE `configuration_baseline` ADD `locked_at` text;
ALTER TABLE `configuration_baseline` ADD `superseded_at` text;
ALTER TABLE `configuration_baseline` ADD `superseded_by_baseline_id` text;
CREATE INDEX `baseline_release_approval_ix` ON `configuration_baseline` (`program_id`,`release_id`,`approval_status`,`as_of`);

-- Version facts belong to the deployment state for a configuration baseline.
-- Existing reported_version stays intact rather than being guessed into either
-- of these more precise fields.
ALTER TABLE `baseline_deployment_state` ADD `application_version` text;
ALTER TABLE `baseline_deployment_state` ADD `runtime_version` text;

PRAGMA foreign_keys=ON;
PRAGMA optimize;
