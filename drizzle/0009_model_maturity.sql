CREATE TABLE `canonical_alias` (
	`id` text PRIMARY KEY NOT NULL,
	`program_id` text NOT NULL,
	`entity_kind` text NOT NULL,
	`entity_id` text NOT NULL,
	`alias` text NOT NULL,
	`normalized_alias` text NOT NULL,
	`namespace` text DEFAULT 'name' NOT NULL,
	`source_reference` text,
	`status` text DEFAULT 'accepted' NOT NULL,
	`reviewed_by_user_id` text,
	`reviewed_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`program_id`) REFERENCES `program`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`reviewed_by_user_id`) REFERENCES `app_user`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "canonical_alias_kind" CHECK(`entity_kind` IN ('product','organization','configuration_node')),
	CONSTRAINT "canonical_alias_status" CHECK(`status` IN ('proposed','accepted','rejected','retired'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `canonical_alias_name_uq` ON `canonical_alias` (`program_id`,`entity_kind`,`namespace`,`normalized_alias`);
--> statement-breakpoint
CREATE INDEX `canonical_alias_entity_ix` ON `canonical_alias` (`entity_kind`,`entity_id`,`status`);
--> statement-breakpoint
CREATE TABLE `canonical_merge_event` (
	`id` text PRIMARY KEY NOT NULL,
	`program_id` text NOT NULL,
	`entity_kind` text NOT NULL,
	`source_entity_id` text NOT NULL,
	`target_entity_id` text NOT NULL,
	`rationale` text NOT NULL,
	`source_reference` text,
	`merged_by_user_id` text,
	`merged_at` text NOT NULL,
	FOREIGN KEY (`program_id`) REFERENCES `program`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`merged_by_user_id`) REFERENCES `app_user`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "canonical_merge_kind" CHECK(`entity_kind` IN ('product','organization','configuration_node')),
	CONSTRAINT "canonical_merge_not_self" CHECK(`source_entity_id` <> `target_entity_id`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `canonical_merge_source_uq` ON `canonical_merge_event` (`program_id`,`entity_kind`,`source_entity_id`);
--> statement-breakpoint
CREATE INDEX `canonical_merge_target_ix` ON `canonical_merge_event` (`entity_kind`,`target_entity_id`,`merged_at`);
--> statement-breakpoint
CREATE TABLE `platform_baseline_assignment` (
	`id` text PRIMARY KEY NOT NULL,
	`program_id` text NOT NULL,
	`platform_id` text NOT NULL,
	`baseline_occurrence_id` text NOT NULL,
	`release_id` text NOT NULL,
	`assignment_role` text DEFAULT 'primary' NOT NULL,
	`confidence` text DEFAULT 'assessed' NOT NULL,
	`review_status` text DEFAULT 'not_reviewed' NOT NULL,
	`source_reference` text,
	`source_as_of` text,
	`reviewed_by_user_id` text,
	`reviewed_at` text,
	`created_by_user_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`program_id`) REFERENCES `program`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`platform_id`) REFERENCES `platform`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`baseline_occurrence_id`) REFERENCES `baseline_occurrence`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`release_id`) REFERENCES `release`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`reviewed_by_user_id`) REFERENCES `app_user`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `app_user`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "platform_assignment_role" CHECK(`assignment_role` IN ('primary','supporting')),
	CONSTRAINT "platform_assignment_confidence" CHECK(`confidence` IN ('reported','assessed','confirmed')),
	CONSTRAINT "platform_assignment_review" CHECK(`review_status` IN ('not_reviewed','reviewed','follow_up'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `platform_assignment_occurrence_role_uq` ON `platform_baseline_assignment` (`baseline_occurrence_id`,`assignment_role`);
--> statement-breakpoint
CREATE INDEX `platform_assignment_platform_release_ix` ON `platform_baseline_assignment` (`platform_id`,`release_id`,`review_status`);
--> statement-breakpoint
INSERT OR IGNORE INTO `platform_baseline_assignment` (`id`,`program_id`,`platform_id`,`baseline_occurrence_id`,`release_id`,`assignment_role`,`confidence`,`review_status`,`source_reference`,`created_at`,`updated_at`)
SELECT 'legacy-platform-assignment-' || bo.id,p.program_id,p.id,bo.id,bo.release_id,'primary','assessed','not_reviewed','Migrated legacy configuration-node anchor',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP
FROM platform p JOIN baseline_occurrence bo ON bo.configuration_node_id=p.configuration_node_id
WHERE p.configuration_node_id IS NOT NULL AND bo.lifecycle_status='active';
--> statement-breakpoint
ALTER TABLE `work_package` ADD `work_type` text DEFAULT 'analysis' NOT NULL;
--> statement-breakpoint
CREATE TABLE `work_package_objective` (
	`id` text PRIMARY KEY NOT NULL,
	`work_package_id` text NOT NULL,
	`objective_id` text NOT NULL,
	`relationship` text DEFAULT 'supports' NOT NULL,
	`rationale` text,
	`created_by_user_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`work_package_id`) REFERENCES `work_package`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`objective_id`) REFERENCES `incumbent_objective`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `app_user`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "work_package_objective_relationship" CHECK(`relationship` IN ('supports','assesses','verifies','coordinates'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `work_package_objective_uq` ON `work_package_objective` (`work_package_id`,`objective_id`,`relationship`);
--> statement-breakpoint
CREATE INDEX `work_package_objective_objective_ix` ON `work_package_objective` (`objective_id`,`relationship`);
--> statement-breakpoint
INSERT OR IGNORE INTO `work_package_objective` (`id`,`work_package_id`,`objective_id`,`relationship`,`rationale`,`created_at`,`updated_at`)
SELECT 'migrated-work-objective-' || id,id,objective_id,'supports','Migrated from the legacy Objective-owned work-package field',created_at,updated_at FROM work_package WHERE objective_id IS NOT NULL;
