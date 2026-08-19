CREATE TABLE `change_request_objective_dependency` (
	`id` text PRIMARY KEY NOT NULL,
	`dependent_change_request_id` text NOT NULL,
	`prerequisite_objective_id` text NOT NULL,
	`relationship` text DEFAULT 'requires' NOT NULL,
	`status` text DEFAULT 'proposed' NOT NULL,
	`rationale` text NOT NULL,
	`source_reference` text,
	`source_as_of` text,
	`evidence_reference` text,
	`created_by_user_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`dependent_change_request_id`) REFERENCES `change_request`(`id`),
	FOREIGN KEY (`prerequisite_objective_id`) REFERENCES `incumbent_objective`(`id`),
	FOREIGN KEY (`created_by_user_id`) REFERENCES `app_user`(`id`),
	CONSTRAINT `change_request_objective_dependency_relationship` CHECK(`relationship` IN ('requires','enables','blocks','consumes')),
	CONSTRAINT `change_request_objective_dependency_status` CHECK(`status` IN ('proposed','accepted','rejected','retired'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `change_request_objective_dependency_uq` ON `change_request_objective_dependency` (`dependent_change_request_id`,`prerequisite_objective_id`,`relationship`);
--> statement-breakpoint
CREATE INDEX `change_request_objective_dependency_objective_ix` ON `change_request_objective_dependency` (`prerequisite_objective_id`,`status`);
--> statement-breakpoint
CREATE INDEX `change_request_objective_dependency_request_ix` ON `change_request_objective_dependency` (`dependent_change_request_id`,`status`);
--> statement-breakpoint
CREATE TABLE `objective_effect_attribution` (
	`id` text PRIMARY KEY NOT NULL,
	`objective_id` text NOT NULL,
	`change_effect_id` text NOT NULL,
	`attribution` text DEFAULT 'contributing' NOT NULL,
	`rationale` text NOT NULL,
	`source_reference` text,
	`source_as_of` text,
	`evidence_reference` text,
	`confidence` text DEFAULT 'unassessed' NOT NULL,
	`created_by_user_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`objective_id`) REFERENCES `incumbent_objective`(`id`),
	FOREIGN KEY (`change_effect_id`) REFERENCES `change_effect`(`id`),
	FOREIGN KEY (`created_by_user_id`) REFERENCES `app_user`(`id`),
	CONSTRAINT `objective_effect_attribution_kind` CHECK(`attribution` IN ('primary','contributing','uncertain')),
	CONSTRAINT `objective_effect_attribution_confidence` CHECK(`confidence` IN ('unassessed','low','medium','high'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `objective_effect_attribution_uq` ON `objective_effect_attribution` (`objective_id`,`change_effect_id`);
--> statement-breakpoint
CREATE INDEX `objective_effect_attribution_effect_ix` ON `objective_effect_attribution` (`change_effect_id`,`attribution`);
--> statement-breakpoint
CREATE INDEX `objective_effect_attribution_objective_ix` ON `objective_effect_attribution` (`objective_id`,`attribution`);
--> statement-breakpoint
PRAGMA optimize;
