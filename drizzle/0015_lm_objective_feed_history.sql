-- Immutable Lockheed GitLab Pages objective-feed history. Feed subjects exist
-- independently of legacy Objectives and Change Requests, so a blank or
-- unresolved JPO/MCP never creates a fictitious ownership record.

CREATE TABLE `lm_objective_feed_snapshot` (
  `id` text PRIMARY KEY NOT NULL, `program_id` text NOT NULL, `external_system` text NOT NULL, `file_name` text NOT NULL,
  `source_locator` text, `source_as_of` text, `observed_at` text NOT NULL, `content_hash` text NOT NULL, `snapshot_payload` text NOT NULL,
  `record_count` integer DEFAULT 0 NOT NULL, `added_count` integer DEFAULT 0 NOT NULL, `changed_count` integer DEFAULT 0 NOT NULL, `unchanged_count` integer DEFAULT 0 NOT NULL, `removed_count` integer DEFAULT 0 NOT NULL, `blocked_count` integer DEFAULT 0 NOT NULL,
  `status` text DEFAULT 'applied' NOT NULL, `created_by_user_id` text, `created_at` text NOT NULL, `updated_at` text NOT NULL,
  FOREIGN KEY (`program_id`) REFERENCES `program`(`id`), FOREIGN KEY (`created_by_user_id`) REFERENCES `app_user`(`id`),
  CONSTRAINT `lm_objective_feed_snapshot_status` CHECK(`status` IN ('staged','applied','rejected'))
);
--> statement-breakpoint
CREATE INDEX `lm_objective_feed_snapshot_hash_ix` ON `lm_objective_feed_snapshot` (`program_id`,`external_system`,`content_hash`);
--> statement-breakpoint
CREATE INDEX `lm_objective_feed_snapshot_observed_ix` ON `lm_objective_feed_snapshot` (`program_id`,`external_system`,`observed_at`);
--> statement-breakpoint
CREATE TABLE `lm_objective_feed_subject` (
  `id` text PRIMARY KEY NOT NULL, `program_id` text NOT NULL, `external_system` text NOT NULL, `feed_key` text NOT NULL,
  `jira_identifier` text, `url` text, `canonical_objective_id` text, `created_at` text NOT NULL, `updated_at` text NOT NULL,
  FOREIGN KEY (`program_id`) REFERENCES `program`(`id`), FOREIGN KEY (`canonical_objective_id`) REFERENCES `incumbent_objective`(`id`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `lm_objective_feed_subject_key_uq` ON `lm_objective_feed_subject` (`program_id`,`external_system`,`feed_key`);
--> statement-breakpoint
CREATE INDEX `lm_objective_feed_subject_objective_ix` ON `lm_objective_feed_subject` (`canonical_objective_id`);
--> statement-breakpoint
CREATE TABLE `lm_objective_feed_item` (
  `id` text PRIMARY KEY NOT NULL, `snapshot_id` text NOT NULL, `subject_id` text NOT NULL, `feed_key` text NOT NULL,
  `jira_identifier` text, `jpo_raw` text, `disposition` text NOT NULL, `normalized_payload` text NOT NULL, `raw_payload` text NOT NULL, `content_hash` text NOT NULL, `created_at` text NOT NULL,
  FOREIGN KEY (`snapshot_id`) REFERENCES `lm_objective_feed_snapshot`(`id`), FOREIGN KEY (`subject_id`) REFERENCES `lm_objective_feed_subject`(`id`),
  CONSTRAINT `lm_objective_feed_item_disposition` CHECK(`disposition` IN ('add','change','unchanged','blocked'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `lm_objective_feed_item_snapshot_key_uq` ON `lm_objective_feed_item` (`snapshot_id`,`feed_key`);
--> statement-breakpoint
CREATE INDEX `lm_objective_feed_item_subject_ix` ON `lm_objective_feed_item` (`subject_id`,`snapshot_id`);
--> statement-breakpoint
CREATE TABLE `lm_objective_feed_state` (
  `subject_id` text PRIMARY KEY NOT NULL, `latest_snapshot_id` text NOT NULL, `feed_key` text NOT NULL, `url` text, `rel_to` text, `roadmap_parent` text, `scope` text,
  `domains_json` text DEFAULT '[]' NOT NULL, `item_number` integer, `target_start` text, `target_finish` text, `rom` text, `percent_complete` real, `funding` text, `release` text, `overview` text, `background` text, `updated_at` text NOT NULL,
  FOREIGN KEY (`subject_id`) REFERENCES `lm_objective_feed_subject`(`id`), FOREIGN KEY (`latest_snapshot_id`) REFERENCES `lm_objective_feed_snapshot`(`id`)
);
--> statement-breakpoint
CREATE INDEX `lm_objective_feed_state_snapshot_ix` ON `lm_objective_feed_state` (`latest_snapshot_id`);
--> statement-breakpoint
CREATE TABLE `lm_objective_feed_jpo_link` (
  `id` text PRIMARY KEY NOT NULL, `subject_id` text NOT NULL, `latest_snapshot_id` text NOT NULL, `external_identifier` text NOT NULL, `change_request_id` text, `created_at` text NOT NULL, `updated_at` text NOT NULL,
  FOREIGN KEY (`subject_id`) REFERENCES `lm_objective_feed_subject`(`id`), FOREIGN KEY (`latest_snapshot_id`) REFERENCES `lm_objective_feed_snapshot`(`id`), FOREIGN KEY (`change_request_id`) REFERENCES `change_request`(`id`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `lm_objective_feed_jpo_link_uq` ON `lm_objective_feed_jpo_link` (`subject_id`,`external_identifier`);
--> statement-breakpoint
CREATE INDEX `lm_objective_feed_jpo_link_request_ix` ON `lm_objective_feed_jpo_link` (`change_request_id`);
--> statement-breakpoint
CREATE TABLE `lm_objective_feed_dependency` (
  `id` text PRIMARY KEY NOT NULL, `snapshot_id` text NOT NULL, `source_feed_key` text NOT NULL, `source_subject_id` text NOT NULL, `direction` text NOT NULL, `target_reference` text NOT NULL, `target_subject_id` text, `created_at` text NOT NULL,
  FOREIGN KEY (`snapshot_id`) REFERENCES `lm_objective_feed_snapshot`(`id`), FOREIGN KEY (`source_subject_id`) REFERENCES `lm_objective_feed_subject`(`id`), FOREIGN KEY (`target_subject_id`) REFERENCES `lm_objective_feed_subject`(`id`),
  CONSTRAINT `lm_objective_feed_dependency_direction` CHECK(`direction` IN ('blocks','blocked_by'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `lm_objective_feed_dependency_uq` ON `lm_objective_feed_dependency` (`snapshot_id`,`source_feed_key`,`direction`,`target_reference`);
--> statement-breakpoint
CREATE INDEX `lm_objective_feed_dependency_source_ix` ON `lm_objective_feed_dependency` (`source_subject_id`,`snapshot_id`);
--> statement-breakpoint
CREATE INDEX `lm_objective_feed_dependency_target_ix` ON `lm_objective_feed_dependency` (`target_subject_id`,`snapshot_id`);
--> statement-breakpoint
CREATE TABLE `lm_objective_feed_delta` (
  `id` text PRIMARY KEY NOT NULL, `snapshot_id` text NOT NULL, `subject_id` text NOT NULL, `feed_key` text NOT NULL, `change_kind` text NOT NULL, `field_name` text, `before_value` text, `after_value` text, `created_at` text NOT NULL,
  FOREIGN KEY (`snapshot_id`) REFERENCES `lm_objective_feed_snapshot`(`id`), FOREIGN KEY (`subject_id`) REFERENCES `lm_objective_feed_subject`(`id`),
  CONSTRAINT `lm_objective_feed_delta_kind` CHECK(`change_kind` IN ('added','changed','unchanged','removed','blocked'))
);
--> statement-breakpoint
CREATE INDEX `lm_objective_feed_delta_snapshot_ix` ON `lm_objective_feed_delta` (`snapshot_id`,`change_kind`);
--> statement-breakpoint
CREATE INDEX `lm_objective_feed_delta_subject_ix` ON `lm_objective_feed_delta` (`subject_id`,`snapshot_id`);
--> statement-breakpoint
PRAGMA optimize;
