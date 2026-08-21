CREATE TABLE `external_source_subject` (
  `id` text PRIMARY KEY NOT NULL,
  `program_id` text NOT NULL,
  `source_system` text NOT NULL,
  `dataset_key` text NOT NULL,
  `entity_kind` text NOT NULL,
  `source_key` text NOT NULL,
  `title` text NOT NULL,
  `canonical_entity_kind` text,
  `canonical_entity_id` text,
  `first_seen_at` text NOT NULL,
  `last_seen_at` text NOT NULL,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  FOREIGN KEY (`program_id`) REFERENCES `program`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `external_source_subject_identity_uq` ON `external_source_subject` (`program_id`,`source_system`,`dataset_key`,`source_key`);
--> statement-breakpoint
CREATE INDEX `external_source_subject_canonical_ix` ON `external_source_subject` (`program_id`,`canonical_entity_kind`,`canonical_entity_id`);
--> statement-breakpoint
CREATE INDEX `external_source_subject_dataset_ix` ON `external_source_subject` (`program_id`,`dataset_key`,`last_seen_at`);
--> statement-breakpoint
CREATE TABLE `external_source_observation` (
  `id` text PRIMARY KEY NOT NULL,
  `run_id` text NOT NULL,
  `subject_id` text NOT NULL,
  `disposition` text NOT NULL,
  `source_updated_at` text,
  `source_as_of` text NOT NULL,
  `content_hash` text NOT NULL,
  `raw_payload` text NOT NULL,
  `normalized_payload` text NOT NULL,
  `observed_at` text NOT NULL,
  `created_at` text NOT NULL,
  FOREIGN KEY (`run_id`) REFERENCES `ingestion_run`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`subject_id`) REFERENCES `external_source_subject`(`id`) ON UPDATE no action ON DELETE no action,
  CONSTRAINT `external_source_observation_disposition` CHECK(`disposition` IN ('add','change','unchanged'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `external_source_observation_run_subject_uq` ON `external_source_observation` (`run_id`,`subject_id`);
--> statement-breakpoint
CREATE INDEX `external_source_observation_subject_ix` ON `external_source_observation` (`subject_id`,`source_as_of`,`observed_at`);
--> statement-breakpoint
CREATE TABLE `external_source_delta` (
  `id` text PRIMARY KEY NOT NULL,
  `observation_id` text NOT NULL,
  `field_name` text NOT NULL,
  `before_value` text,
  `after_value` text,
  `created_at` text NOT NULL,
  FOREIGN KEY (`observation_id`) REFERENCES `external_source_observation`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `external_source_delta_observation_ix` ON `external_source_delta` (`observation_id`,`field_name`);
--> statement-breakpoint
CREATE TABLE `external_source_relation` (
  `id` text PRIMARY KEY NOT NULL,
  `observation_id` text NOT NULL,
  `relation_type` text NOT NULL,
  `target_reference` text NOT NULL,
  `target_subject_id` text,
  `canonical_target_kind` text,
  `canonical_target_id` text,
  `created_at` text NOT NULL,
  FOREIGN KEY (`observation_id`) REFERENCES `external_source_observation`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`target_subject_id`) REFERENCES `external_source_subject`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `external_source_relation_observation_ix` ON `external_source_relation` (`observation_id`,`relation_type`);
--> statement-breakpoint
CREATE INDEX `external_source_relation_target_ix` ON `external_source_relation` (`target_subject_id`,`target_reference`);
--> statement-breakpoint
PRAGMA optimize;
