ALTER TABLE `release` ADD `description` text;
--> statement-breakpoint
ALTER TABLE `release` ADD `owner` text;
--> statement-breakpoint
ALTER TABLE `release` ADD `predecessor_release_id` text;
--> statement-breakpoint
ALTER TABLE `release` ADD `source_reference` text;
--> statement-breakpoint
ALTER TABLE `release` ADD `source_as_of` text;
--> statement-breakpoint
CREATE INDEX `release_predecessor_ix` ON `release` (`program_id`,`predecessor_release_id`);
--> statement-breakpoint
CREATE TABLE `release_milestone` (
	`id` text PRIMARY KEY NOT NULL,
	`program_id` text NOT NULL,
	`release_id` text NOT NULL,
	`milestone_type` text NOT NULL,
	`title` text NOT NULL,
	`status` text DEFAULT 'planned' NOT NULL CHECK (`status` IN ('planned','at_risk','complete','cancelled')),
	`planned_date` text,
	`forecast_date` text,
	`actual_date` text,
	`owner` text,
	`source_reference` text,
	`source_as_of` text,
	`notes` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`program_id`) REFERENCES `program`(`id`),
	FOREIGN KEY (`release_id`) REFERENCES `release`(`id`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `release_milestone_type_uq` ON `release_milestone` (`release_id`,`milestone_type`,`title`);
--> statement-breakpoint
CREATE INDEX `release_milestone_release_ix` ON `release_milestone` (`release_id`,`status`,`planned_date`);
--> statement-breakpoint
ALTER TABLE `organization` ADD `description` text;
--> statement-breakpoint
ALTER TABLE `organization` ADD `lifecycle_status` text DEFAULT 'active' NOT NULL CHECK (`lifecycle_status` IN ('active','inactive','retired'));
--> statement-breakpoint
ALTER TABLE `organization` ADD `source_reference` text;
--> statement-breakpoint
ALTER TABLE `organization` ADD `source_as_of` text;
--> statement-breakpoint
CREATE INDEX `organization_status_ix` ON `organization` (`program_id`,`lifecycle_status`);
--> statement-breakpoint
ALTER TABLE `configuration_node` ADD `lifecycle_status` text DEFAULT 'active' NOT NULL CHECK (`lifecycle_status` IN ('active','retired'));
--> statement-breakpoint
ALTER TABLE `configuration_node` ADD `source_reference` text;
--> statement-breakpoint
ALTER TABLE `configuration_node` ADD `source_as_of` text;
--> statement-breakpoint
CREATE INDEX `configuration_node_status_ix` ON `configuration_node` (`program_id`,`lifecycle_status`);
--> statement-breakpoint
ALTER TABLE `product` ADD `description` text;
--> statement-breakpoint
ALTER TABLE `product` ADD `lifecycle_status` text DEFAULT 'active' NOT NULL CHECK (`lifecycle_status` IN ('active','retired'));
--> statement-breakpoint
ALTER TABLE `product` ADD `source_reference` text;
--> statement-breakpoint
ALTER TABLE `product` ADD `source_as_of` text;
--> statement-breakpoint
CREATE INDEX `product_status_ix` ON `product` (`program_id`,`lifecycle_status`);
--> statement-breakpoint
ALTER TABLE `capability` ADD `lifecycle_status` text DEFAULT 'active' NOT NULL CHECK (`lifecycle_status` IN ('draft','active','retired'));
--> statement-breakpoint
ALTER TABLE `capability` ADD `source_reference` text;
--> statement-breakpoint
ALTER TABLE `capability` ADD `source_as_of` text;
--> statement-breakpoint
CREATE INDEX `capability_status_ix` ON `capability` (`program_id`,`lifecycle_status`);
--> statement-breakpoint
ALTER TABLE `change_request` ADD `reference_status` text DEFAULT 'active' NOT NULL CHECK (`reference_status` IN ('active','closed','superseded'));
--> statement-breakpoint
ALTER TABLE `change_request` ADD `lifecycle_rationale` text;
