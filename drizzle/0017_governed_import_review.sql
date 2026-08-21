CREATE TABLE `ingestion_run` (
  `id` text PRIMARY KEY NOT NULL,
  `program_id` text NOT NULL,
  `adapter_key` text NOT NULL,
  `source_system` text NOT NULL,
  `file_name` text NOT NULL,
  `sheet_name` text,
  `source_locator` text,
  `source_as_of` text,
  `content_hash` text NOT NULL,
  `idempotency_key` text NOT NULL,
  `status` text DEFAULT 'staged' NOT NULL,
  `record_count` integer DEFAULT 0 NOT NULL,
  `added_count` integer DEFAULT 0 NOT NULL,
  `changed_count` integer DEFAULT 0 NOT NULL,
  `unchanged_count` integer DEFAULT 0 NOT NULL,
  `skipped_count` integer DEFAULT 0 NOT NULL,
  `blocked_count` integer DEFAULT 0 NOT NULL,
  `target_snapshot_kind` text,
  `target_snapshot_id` text,
  `reviewed_by_user_id` text,
  `reviewed_at` text,
  `applied_by_user_id` text,
  `applied_at` text,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  FOREIGN KEY (`program_id`) REFERENCES `program`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`reviewed_by_user_id`) REFERENCES `app_user`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`applied_by_user_id`) REFERENCES `app_user`(`id`) ON UPDATE no action ON DELETE no action,
  CONSTRAINT `ingestion_run_status` CHECK(`status` IN ('staged','reviewed','applied','rejected','failed'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ingestion_run_idempotency_uq` ON `ingestion_run` (`program_id`,`idempotency_key`);
--> statement-breakpoint
CREATE INDEX `ingestion_run_adapter_ix` ON `ingestion_run` (`program_id`,`adapter_key`,`created_at`);
--> statement-breakpoint
CREATE TABLE `ingestion_item` (
  `id` text PRIMARY KEY NOT NULL,
  `run_id` text NOT NULL,
  `row_number` integer NOT NULL,
  `source_key` text NOT NULL,
  `target_kind` text,
  `target_id` text,
  `match_method` text NOT NULL,
  `decision` text NOT NULL,
  `disposition` text NOT NULL,
  `raw_payload` text NOT NULL,
  `normalized_payload` text NOT NULL,
  `changes_payload` text DEFAULT '[]' NOT NULL,
  `issues_payload` text DEFAULT '[]' NOT NULL,
  `created_at` text NOT NULL,
  FOREIGN KEY (`run_id`) REFERENCES `ingestion_run`(`id`) ON UPDATE no action ON DELETE no action,
  CONSTRAINT `ingestion_item_decision` CHECK(`decision` IN ('approve','skip')),
  CONSTRAINT `ingestion_item_disposition` CHECK(`disposition` IN ('add','change','unchanged','blocked'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ingestion_item_run_row_uq` ON `ingestion_item` (`run_id`,`row_number`);
--> statement-breakpoint
CREATE INDEX `ingestion_item_target_ix` ON `ingestion_item` (`target_kind`,`target_id`);
--> statement-breakpoint
CREATE TABLE `external_change_source_state` (
  `change_request_id` text PRIMARY KEY NOT NULL,
  `latest_run_id` text NOT NULL,
  `external_system` text NOT NULL,
  `raw_payload` text NOT NULL,
  `normalized_payload` text NOT NULL,
  `source_as_of` text,
  `updated_at` text NOT NULL,
  FOREIGN KEY (`change_request_id`) REFERENCES `change_request`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`latest_run_id`) REFERENCES `ingestion_run`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `external_change_source_state_system_ix` ON `external_change_source_state` (`external_system`,`source_as_of`);
--> statement-breakpoint
PRAGMA optimize;
