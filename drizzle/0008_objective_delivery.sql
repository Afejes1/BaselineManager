ALTER TABLE `incumbent_objective` ADD `external_item_type` text DEFAULT 'Objective' NOT NULL;
--> statement-breakpoint
ALTER TABLE `work_package` RENAME TO `work_package_legacy`;
--> statement-breakpoint
CREATE TABLE `work_package` (
  `id` text PRIMARY KEY NOT NULL,
  `initiative_id` text,
  `change_request_id` text,
  `objective_id` text,
  `parent_id` text,
  `wbs_code` text NOT NULL,
  `title` text NOT NULL,
  `owner` text,
  `planned_start` text,
  `due_date` text,
  `actual_start` text,
  `actual_finish` text,
  `status` text DEFAULT 'planned' NOT NULL,
  `definition_of_done` text,
  `progress_basis` text,
  `notes` text,
  `sort_order` integer DEFAULT 0 NOT NULL,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  FOREIGN KEY (`initiative_id`) REFERENCES `initiative`(`id`),
  FOREIGN KEY (`change_request_id`) REFERENCES `change_request`(`id`),
  FOREIGN KEY (`objective_id`) REFERENCES `incumbent_objective`(`id`),
  CONSTRAINT `work_package_status` CHECK(`status` IN ('planned','in_progress','on_hold','complete')),
  CONSTRAINT `work_package_context` CHECK(`objective_id` IS NOT NULL OR `initiative_id` IS NOT NULL)
);
--> statement-breakpoint
INSERT INTO `work_package` (`id`,`initiative_id`,`parent_id`,`wbs_code`,`title`,`owner`,`due_date`,`status`,`notes`,`sort_order`,`created_at`,`updated_at`)
SELECT `id`,`initiative_id`,`parent_id`,`wbs_code`,`title`,`owner`,`due_date`,`status`,`notes`,`sort_order`,`created_at`,`updated_at` FROM `work_package_legacy`;
--> statement-breakpoint
DROP TABLE `work_package_legacy`;
--> statement-breakpoint
CREATE UNIQUE INDEX `work_package_objective_code_uq` ON `work_package` (`objective_id`,`wbs_code`);
--> statement-breakpoint
CREATE INDEX `work_package_initiative_status_ix` ON `work_package` (`initiative_id`,`status`,`due_date`);
--> statement-breakpoint
CREATE INDEX `work_package_objective_status_ix` ON `work_package` (`objective_id`,`status`,`due_date`);
--> statement-breakpoint
CREATE INDEX `work_package_request_ix` ON `work_package` (`change_request_id`,`status`);
--> statement-breakpoint
CREATE TABLE `work_package_dependency` (
  `id` text PRIMARY KEY NOT NULL,
  `predecessor_work_package_id` text NOT NULL,
  `successor_work_package_id` text NOT NULL,
  `relationship` text DEFAULT 'FS' NOT NULL,
  `lag_days` integer DEFAULT 0 NOT NULL,
  `status` text DEFAULT 'proposed' NOT NULL,
  `rationale` text NOT NULL,
  `source_reference` text,
  `created_by_user_id` text,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  FOREIGN KEY (`predecessor_work_package_id`) REFERENCES `work_package`(`id`),
  FOREIGN KEY (`successor_work_package_id`) REFERENCES `work_package`(`id`),
  FOREIGN KEY (`created_by_user_id`) REFERENCES `app_user`(`id`),
  CONSTRAINT `work_package_dependency_relationship` CHECK(`relationship` IN ('FS','SS','FF','SF')),
  CONSTRAINT `work_package_dependency_status` CHECK(`status` IN ('proposed','accepted','rejected','retired')),
  CONSTRAINT `work_package_dependency_not_self` CHECK(`predecessor_work_package_id` <> `successor_work_package_id`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `work_package_dependency_uq` ON `work_package_dependency` (`predecessor_work_package_id`,`successor_work_package_id`,`relationship`);
--> statement-breakpoint
CREATE INDEX `work_package_dependency_successor_ix` ON `work_package_dependency` (`successor_work_package_id`,`status`);
--> statement-breakpoint
CREATE TABLE `objective_source_package` (
  `id` text PRIMARY KEY NOT NULL,
  `program_id` text NOT NULL,
  `external_system` text NOT NULL,
  `file_name` text NOT NULL,
  `sheet_name` text,
  `content_hash` text NOT NULL,
  `received_at` text NOT NULL,
  `status` text DEFAULT 'staged' NOT NULL,
  `row_count` integer DEFAULT 0 NOT NULL,
  `added_count` integer DEFAULT 0 NOT NULL,
  `changed_count` integer DEFAULT 0 NOT NULL,
  `unchanged_count` integer DEFAULT 0 NOT NULL,
  `blocked_count` integer DEFAULT 0 NOT NULL,
  `created_by_user_id` text,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  FOREIGN KEY (`program_id`) REFERENCES `program`(`id`),
  FOREIGN KEY (`created_by_user_id`) REFERENCES `app_user`(`id`),
  CONSTRAINT `objective_source_package_status` CHECK(`status` IN ('staged','applied','rejected'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `objective_source_package_hash_uq` ON `objective_source_package` (`program_id`,`external_system`,`content_hash`);
--> statement-breakpoint
CREATE INDEX `objective_source_package_received_ix` ON `objective_source_package` (`program_id`,`received_at`);
--> statement-breakpoint
CREATE TABLE `objective_source_row` (
  `id` text PRIMARY KEY NOT NULL,
  `source_package_id` text NOT NULL,
  `row_number` integer NOT NULL,
  `external_system` text NOT NULL,
  `external_identifier` text NOT NULL,
  `raw_payload` text NOT NULL,
  `disposition` text NOT NULL,
  `objective_id` text,
  `created_at` text NOT NULL,
  FOREIGN KEY (`source_package_id`) REFERENCES `objective_source_package`(`id`),
  FOREIGN KEY (`objective_id`) REFERENCES `incumbent_objective`(`id`),
  CONSTRAINT `objective_source_row_disposition` CHECK(`disposition` IN ('add','change','unchanged','blocked'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `objective_source_row_number_uq` ON `objective_source_row` (`source_package_id`,`row_number`);
--> statement-breakpoint
CREATE INDEX `objective_source_row_key_ix` ON `objective_source_row` (`external_system`,`external_identifier`);
--> statement-breakpoint
PRAGMA optimize;
