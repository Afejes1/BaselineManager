PRAGMA foreign_keys=ON;

DROP INDEX IF EXISTS `source_row_package_key_uq`;
CREATE INDEX IF NOT EXISTS `source_row_package_key_ix` ON `source_row_24` (`source_package_id`,`source_key`);

CREATE TABLE IF NOT EXISTS `baseline_workspace` (
  `id` text PRIMARY KEY NOT NULL,
  `program_id` text NOT NULL REFERENCES `program`(`id`),
  `label` text NOT NULL,
  `active_import_package_id` text REFERENCES `source_package`(`id`),
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS `baseline_workspace_program_label_uq` ON `baseline_workspace` (`program_id`,`label`);

CREATE TABLE IF NOT EXISTS `baseline_occurrence` (
  `id` text PRIMARY KEY NOT NULL,
  `program_id` text NOT NULL REFERENCES `program`(`id`),
  `workspace_id` text NOT NULL REFERENCES `baseline_workspace`(`id`),
  `source_row_id` text NOT NULL REFERENCES `source_row_24`(`id`),
  `release_id` text REFERENCES `release`(`id`),
  `baseline_id` text REFERENCES `configuration_baseline`(`id`),
  `configuration_node_id` text REFERENCES `configuration_node`(`id`),
  `product_id` text REFERENCES `product`(`id`),
  `deployment_id` text REFERENCES `deployment`(`id`),
  `projection_payload` text NOT NULL,
  `materialization_status` text DEFAULT 'reported' NOT NULL,
  `revision` integer DEFAULT 0 NOT NULL,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS `baseline_occurrence_workspace_source_uq` ON `baseline_occurrence` (`workspace_id`,`source_row_id`);
CREATE INDEX IF NOT EXISTS `baseline_occurrence_workspace_release_ix` ON `baseline_occurrence` (`workspace_id`,`release_id`,`baseline_id`);
CREATE INDEX IF NOT EXISTS `baseline_occurrence_workspace_product_ix` ON `baseline_occurrence` (`workspace_id`,`product_id`);

CREATE TABLE IF NOT EXISTS `source_occurrence_review_v2` (
  `id` text PRIMARY KEY NOT NULL,
  `program_id` text NOT NULL REFERENCES `program`(`id`),
  `source_row_id` text NOT NULL REFERENCES `source_row_24`(`id`),
  `status` text DEFAULT 'not_reviewed' NOT NULL,
  `reviewed_at` text,
  `note` text,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  CONSTRAINT `source_occurrence_review_v2_status` CHECK (`status` IN ('not_reviewed','reviewed','follow_up'))
);
CREATE UNIQUE INDEX IF NOT EXISTS `source_occurrence_review_v2_source_uq` ON `source_occurrence_review_v2` (`source_row_id`);
CREATE INDEX IF NOT EXISTS `source_occurrence_review_v2_status_ix` ON `source_occurrence_review_v2` (`program_id`,`status`,`reviewed_at`);
