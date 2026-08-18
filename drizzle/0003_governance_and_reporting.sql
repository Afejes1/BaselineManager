PRAGMA foreign_keys=ON;

CREATE TABLE `app_user` (
  `id` text PRIMARY KEY NOT NULL,
  `email` text,
  `display_name` text NOT NULL,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL
);
CREATE INDEX `app_user_email_ix` ON `app_user` (`email`);

CREATE TABLE `program_role_assignment` (
  `id` text PRIMARY KEY NOT NULL,
  `program_id` text NOT NULL REFERENCES `program`(`id`),
  `user_id` text NOT NULL REFERENCES `app_user`(`id`),
  `role` text DEFAULT 'editor' NOT NULL CHECK (`role` IN ('steward','editor','viewer')),
  `assigned_by_user_id` text,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL
);
CREATE UNIQUE INDEX `program_role_assignment_program_user_uq` ON `program_role_assignment` (`program_id`,`user_id`);
CREATE INDEX `program_role_assignment_program_role_ix` ON `program_role_assignment` (`program_id`,`role`);

CREATE TABLE `initiative` (
  `id` text PRIMARY KEY NOT NULL,
  `program_id` text NOT NULL REFERENCES `program`(`id`),
  `primary_release_id` text REFERENCES `release`(`id`),
  `title` text NOT NULL,
  `normalized_title` text NOT NULL,
  `status` text DEFAULT 'draft' NOT NULL CHECK (`status` IN ('draft','active','decision_required','closed')),
  `priority` text DEFAULT 'medium' NOT NULL CHECK (`priority` IN ('low','medium','high','critical')),
  `owner` text,
  `target_date` text,
  `consequence` text,
  `desired_outcome` text,
  `decision_ask` text,
  `created_by_user_id` text REFERENCES `app_user`(`id`),
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL
);
CREATE UNIQUE INDEX `initiative_program_title_uq` ON `initiative` (`program_id`,`normalized_title`);
CREATE INDEX `initiative_program_status_ix` ON `initiative` (`program_id`,`status`,`target_date`);
CREATE INDEX `initiative_release_ix` ON `initiative` (`program_id`,`primary_release_id`);

CREATE TABLE `initiative_scope` (
  `id` text PRIMARY KEY NOT NULL,
  `initiative_id` text NOT NULL REFERENCES `initiative`(`id`),
  `scope_kind` text NOT NULL CHECK (`scope_kind` IN ('product','release','capability','occurrence','configuration_node')),
  `scope_id` text NOT NULL,
  `display_label` text,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL
);
CREATE UNIQUE INDEX `initiative_scope_uq` ON `initiative_scope` (`initiative_id`,`scope_kind`,`scope_id`);
CREATE INDEX `initiative_scope_lookup_ix` ON `initiative_scope` (`scope_kind`,`scope_id`);

CREATE TABLE `work_package` (
  `id` text PRIMARY KEY NOT NULL,
  `initiative_id` text NOT NULL REFERENCES `initiative`(`id`),
  `parent_id` text,
  `wbs_code` text NOT NULL,
  `title` text NOT NULL,
  `owner` text,
  `due_date` text,
  `status` text DEFAULT 'planned' NOT NULL CHECK (`status` IN ('planned','in_progress','on_hold','complete')),
  `notes` text,
  `sort_order` integer DEFAULT 0 NOT NULL,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL
);
CREATE UNIQUE INDEX `work_package_initiative_code_uq` ON `work_package` (`initiative_id`,`wbs_code`);
CREATE INDEX `work_package_initiative_status_ix` ON `work_package` (`initiative_id`,`status`,`due_date`);

CREATE TABLE `governance_record` (
  `id` text PRIMARY KEY NOT NULL,
  `program_id` text NOT NULL REFERENCES `program`(`id`),
  `record_type` text NOT NULL CHECK (`record_type` IN ('mcp','technical_call','decision','risk','question','technical_note')),
  `external_reference` text,
  `title` text NOT NULL,
  `status` text DEFAULT 'open' NOT NULL CHECK (`status` IN ('open','in_review','approved','closed','superseded')),
  `owner` text,
  `occurred_at` text,
  `due_date` text,
  `summary` text,
  `decision_ask` text,
  `impact` text,
  `created_by_user_id` text REFERENCES `app_user`(`id`),
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL
);
CREATE INDEX `governance_record_program_type_ix` ON `governance_record` (`program_id`,`record_type`,`status`,`occurred_at`);
CREATE INDEX `governance_record_external_reference_ix` ON `governance_record` (`program_id`,`external_reference`);

CREATE TABLE `governance_record_link` (
  `id` text PRIMARY KEY NOT NULL,
  `governance_record_id` text NOT NULL REFERENCES `governance_record`(`id`),
  `entity_kind` text NOT NULL CHECK (`entity_kind` IN ('initiative','work_package','release','product','capability','occurrence','configuration_node')),
  `entity_id` text NOT NULL,
  `relationship` text DEFAULT 'affects' NOT NULL,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL
);
CREATE UNIQUE INDEX `governance_record_link_uq` ON `governance_record_link` (`governance_record_id`,`entity_kind`,`entity_id`,`relationship`);
CREATE INDEX `governance_record_link_target_ix` ON `governance_record_link` (`entity_kind`,`entity_id`);

CREATE TABLE `evidence_document` (
  `id` text PRIMARY KEY NOT NULL,
  `program_id` text NOT NULL REFERENCES `program`(`id`),
  `governance_record_id` text REFERENCES `governance_record`(`id`),
  `initiative_id` text REFERENCES `initiative`(`id`),
  `file_name` text NOT NULL,
  `content_type` text,
  `byte_size` integer DEFAULT 0 NOT NULL,
  `r2_key` text NOT NULL,
  `description` text,
  `uploaded_by_user_id` text REFERENCES `app_user`(`id`),
  `created_at` text NOT NULL
);
CREATE UNIQUE INDEX `evidence_document_r2_key_uq` ON `evidence_document` (`r2_key`);
CREATE INDEX `evidence_document_record_ix` ON `evidence_document` (`governance_record_id`,`created_at`);
CREATE INDEX `evidence_document_initiative_ix` ON `evidence_document` (`initiative_id`,`created_at`);

CREATE TABLE `executive_brief` (
  `id` text PRIMARY KEY NOT NULL,
  `program_id` text NOT NULL REFERENCES `program`(`id`),
  `initiative_id` text REFERENCES `initiative`(`id`),
  `title` text NOT NULL,
  `status` text DEFAULT 'draft' NOT NULL CHECK (`status` IN ('draft','reviewed','published','superseded')),
  `notes` text,
  `snapshot_payload` text NOT NULL,
  `body_markdown` text NOT NULL,
  `created_by_user_id` text REFERENCES `app_user`(`id`),
  `published_at` text,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL
);
CREATE INDEX `executive_brief_program_status_ix` ON `executive_brief` (`program_id`,`status`,`updated_at`);
CREATE INDEX `executive_brief_initiative_ix` ON `executive_brief` (`initiative_id`,`updated_at`);

CREATE TABLE `brief_publication` (
  `id` text PRIMARY KEY NOT NULL,
  `brief_id` text NOT NULL REFERENCES `executive_brief`(`id`),
  `format` text NOT NULL CHECK (`format` IN ('markdown','pdf','docx')),
  `content_hash` text NOT NULL,
  `snapshot_payload` text NOT NULL,
  `created_by_user_id` text REFERENCES `app_user`(`id`),
  `created_at` text NOT NULL
);
CREATE INDEX `brief_publication_brief_ix` ON `brief_publication` (`brief_id`,`created_at`);
