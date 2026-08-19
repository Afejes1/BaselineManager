ALTER TABLE `baseline_occurrence` ADD `lifecycle_status` text DEFAULT 'active' NOT NULL;
--> statement-breakpoint
ALTER TABLE `baseline_occurrence` ADD `lifecycle_reason` text;
--> statement-breakpoint
ALTER TABLE `baseline_occurrence` ADD `voided_at` text;
--> statement-breakpoint
ALTER TABLE `baseline_occurrence` ADD `voided_by_user_id` text;
--> statement-breakpoint
CREATE INDEX `baseline_occurrence_workspace_lifecycle_ix` ON `baseline_occurrence` (`workspace_id`,`lifecycle_status`,`release_id`);
--> statement-breakpoint
CREATE TABLE `platform` (
	`id` text PRIMARY KEY NOT NULL,
	`program_id` text NOT NULL,
	`parent_id` text,
	`configuration_node_id` text,
	`platform_type` text NOT NULL,
	`code` text NOT NULL,
	`normalized_code` text NOT NULL,
	`name` text NOT NULL,
	`normalized_name` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`description` text,
	`installation_location` text,
	`country_code` text,
	`created_by_user_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`program_id`) REFERENCES `program`(`id`),
	FOREIGN KEY (`configuration_node_id`) REFERENCES `configuration_node`(`id`),
	FOREIGN KEY (`created_by_user_id`) REFERENCES `app_user`(`id`),
	CONSTRAINT `platform_type` CHECK(`platform_type` IN ('alou','ock','obk','pma','other')),
	CONSTRAINT `platform_status` CHECK(`status` IN ('active','planned','retired')),
	CONSTRAINT `platform_not_self` CHECK(`parent_id` IS NULL OR `parent_id` <> `id`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `platform_code_uq` ON `platform` (`program_id`,`normalized_code`);
--> statement-breakpoint
CREATE UNIQUE INDEX `platform_configuration_node_uq` ON `platform` (`configuration_node_id`);
--> statement-breakpoint
CREATE INDEX `platform_parent_ix` ON `platform` (`program_id`,`parent_id`,`platform_type`);
--> statement-breakpoint
CREATE TABLE `platform_organization` (
	`id` text PRIMARY KEY NOT NULL,
	`platform_id` text NOT NULL,
	`organization_id` text NOT NULL,
	`relationship_type` text NOT NULL,
	`source_reference` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`platform_id`) REFERENCES `platform`(`id`),
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`),
	CONSTRAINT `platform_organization_relationship` CHECK(`relationship_type` IN ('owner','operator','integrator','support','supplier'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `platform_organization_uq` ON `platform_organization` (`platform_id`,`organization_id`,`relationship_type`);
--> statement-breakpoint
CREATE INDEX `platform_organization_org_ix` ON `platform_organization` (`organization_id`,`relationship_type`);
--> statement-breakpoint
CREATE TABLE `release_profile` (
	`id` text PRIMARY KEY NOT NULL,
	`program_id` text NOT NULL,
	`release_id` text NOT NULL,
	`state_role` text DEFAULT 'reported' NOT NULL,
	`effective_date` text,
	`description` text,
	`created_by_user_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`program_id`) REFERENCES `program`(`id`),
	FOREIGN KEY (`release_id`) REFERENCES `release`(`id`),
	FOREIGN KEY (`created_by_user_id`) REFERENCES `app_user`(`id`),
	CONSTRAINT `release_profile_state_role` CHECK(`state_role` IN ('historical','as_is','to_be','reported'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `release_profile_release_uq` ON `release_profile` (`release_id`);
--> statement-breakpoint
CREATE INDEX `release_profile_role_ix` ON `release_profile` (`program_id`,`state_role`,`effective_date`);
--> statement-breakpoint
CREATE TABLE `change_request_type` (
	`id` text PRIMARY KEY NOT NULL,
	`program_id` text NOT NULL,
	`code` text NOT NULL,
	`normalized_code` text NOT NULL,
	`label` text NOT NULL,
	`description` text,
	`active` integer DEFAULT true NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`program_id`) REFERENCES `program`(`id`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `change_request_type_code_uq` ON `change_request_type` (`program_id`,`normalized_code`);
--> statement-breakpoint
CREATE TABLE `change_request` (
	`id` text PRIMARY KEY NOT NULL,
	`program_id` text NOT NULL,
	`type_id` text NOT NULL,
	`external_system` text,
	`external_identifier` text NOT NULL,
	`title` text NOT NULL,
	`external_status` text,
	`external_owner` text,
	`source_locator` text,
	`source_as_of` text,
	`requested_release_id` text,
	`government_priority` text DEFAULT 'unranked' NOT NULL,
	`decision_status` text DEFAULT 'pending' NOT NULL,
	`decision_authority` text,
	`decision_at` text,
	`decision_by_user_id` text,
	`decision_rationale` text,
	`summary` text,
	`consequence_if_funded` text,
	`consequence_if_deferred` text,
	`impact_summary` text,
	`knock_on_effects` text,
	`created_by_user_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`program_id`) REFERENCES `program`(`id`),
	FOREIGN KEY (`type_id`) REFERENCES `change_request_type`(`id`),
	FOREIGN KEY (`requested_release_id`) REFERENCES `release`(`id`),
	FOREIGN KEY (`decision_by_user_id`) REFERENCES `app_user`(`id`),
	FOREIGN KEY (`created_by_user_id`) REFERENCES `app_user`(`id`),
	CONSTRAINT `change_request_priority` CHECK(`government_priority` IN ('unranked','low','medium','high','critical')),
	CONSTRAINT `change_request_decision` CHECK(`decision_status` IN ('pending','fund','defer','decline'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `change_request_external_uq` ON `change_request` (`program_id`,`external_system`,`external_identifier`);
--> statement-breakpoint
CREATE INDEX `change_request_decision_ix` ON `change_request` (`program_id`,`decision_status`,`government_priority`);
--> statement-breakpoint
CREATE INDEX `change_request_release_ix` ON `change_request` (`program_id`,`requested_release_id`);
--> statement-breakpoint
CREATE TABLE `change_effect` (
	`id` text PRIMARY KEY NOT NULL,
	`change_request_id` text NOT NULL,
	`subject_kind` text NOT NULL,
	`subject_id` text NOT NULL,
	`action` text DEFAULT 'modify' NOT NULL,
	`aspect` text DEFAULT 'configuration' NOT NULL,
	`from_release_id` text,
	`to_release_id` text,
	`current_value` text,
	`target_value` text,
	`consequence` text,
	`rationale` text,
	`confidence` text DEFAULT 'reported' NOT NULL,
	`source_occurrence_id` text,
	`created_by_user_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`change_request_id`) REFERENCES `change_request`(`id`),
	FOREIGN KEY (`from_release_id`) REFERENCES `release`(`id`),
	FOREIGN KEY (`to_release_id`) REFERENCES `release`(`id`),
	FOREIGN KEY (`source_occurrence_id`) REFERENCES `baseline_occurrence`(`id`),
	FOREIGN KEY (`created_by_user_id`) REFERENCES `app_user`(`id`),
	CONSTRAINT `change_effect_subject` CHECK(`subject_kind` IN ('product','platform','configuration_node','occurrence','release','organization')),
	CONSTRAINT `change_effect_action` CHECK(`action` IN ('add','remove','move','modify','assess')),
	CONSTRAINT `change_effect_confidence` CHECK(`confidence` IN ('reported','assessed','confirmed'))
);
--> statement-breakpoint
CREATE INDEX `change_effect_request_ix` ON `change_effect` (`change_request_id`,`subject_kind`);
--> statement-breakpoint
CREATE INDEX `change_effect_subject_ix` ON `change_effect` (`subject_kind`,`subject_id`);
--> statement-breakpoint
CREATE TABLE `change_dependency` (
	`id` text PRIMARY KEY NOT NULL,
	`predecessor_request_id` text NOT NULL,
	`successor_request_id` text NOT NULL,
	`dependency_type` text NOT NULL,
	`rationale` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`predecessor_request_id`) REFERENCES `change_request`(`id`),
	FOREIGN KEY (`successor_request_id`) REFERENCES `change_request`(`id`),
	CONSTRAINT `change_dependency_not_self` CHECK(`predecessor_request_id` <> `successor_request_id`),
	CONSTRAINT `change_dependency_type` CHECK(`dependency_type` IN ('requires','enables','blocks','conflicts','overlaps'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `change_dependency_uq` ON `change_dependency` (`predecessor_request_id`,`successor_request_id`,`dependency_type`);
--> statement-breakpoint
CREATE INDEX `change_dependency_successor_ix` ON `change_dependency` (`successor_request_id`,`dependency_type`);
