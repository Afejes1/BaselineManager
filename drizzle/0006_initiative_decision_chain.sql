ALTER TABLE `initiative` ADD `as_is_statement` text;
--> statement-breakpoint
ALTER TABLE `initiative` ADD `to_be_statement` text;
--> statement-breakpoint
ALTER TABLE `initiative` ADD `success_measures` text;
--> statement-breakpoint
ALTER TABLE `initiative` ADD `briefing_audience` text;
--> statement-breakpoint
ALTER TABLE `initiative` ADD `decision_needed_by` text;
--> statement-breakpoint
CREATE TABLE `initiative_change_request` (
	`id` text PRIMARY KEY NOT NULL,
	`initiative_id` text NOT NULL,
	`change_request_id` text NOT NULL,
	`relationship` text DEFAULT 'delivers' NOT NULL,
	`contribution_summary` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`initiative_id`) REFERENCES `initiative`(`id`),
	FOREIGN KEY (`change_request_id`) REFERENCES `change_request`(`id`),
	CONSTRAINT `initiative_change_relationship` CHECK(`relationship` IN ('delivers','enables','constrains','supports'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `initiative_change_request_uq` ON `initiative_change_request` (`initiative_id`,`change_request_id`);
--> statement-breakpoint
CREATE INDEX `initiative_change_request_request_ix` ON `initiative_change_request` (`change_request_id`,`initiative_id`);
--> statement-breakpoint
CREATE TABLE `incumbent_objective` (
	`id` text PRIMARY KEY NOT NULL,
	`program_id` text NOT NULL,
	`change_request_id` text NOT NULL,
	`external_system` text NOT NULL,
	`external_identifier` text NOT NULL,
	`title` text NOT NULL,
	`summary` text,
	`technical_owner` text,
	`status` text DEFAULT 'proposed' NOT NULL,
	`planned_start` text,
	`planned_finish` text,
	`actual_start` text,
	`actual_finish` text,
	`source_locator` text,
	`source_as_of` text,
	`created_by_user_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`program_id`) REFERENCES `program`(`id`),
	FOREIGN KEY (`change_request_id`) REFERENCES `change_request`(`id`),
	FOREIGN KEY (`created_by_user_id`) REFERENCES `app_user`(`id`),
	CONSTRAINT `incumbent_objective_status` CHECK(`status` IN ('proposed','planned','in_progress','blocked','verification','complete','cancelled'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `incumbent_objective_external_uq` ON `incumbent_objective` (`program_id`,`external_system`,`external_identifier`);
--> statement-breakpoint
CREATE INDEX `incumbent_objective_request_ix` ON `incumbent_objective` (`change_request_id`,`status`,`planned_finish`);
--> statement-breakpoint
CREATE TABLE `objective_estimate` (
	`id` text PRIMARY KEY NOT NULL,
	`objective_id` text NOT NULL,
	`estimate_source` text NOT NULL,
	`hours_low` real,
	`hours_likely` real,
	`hours_high` real,
	`cost_low` real,
	`cost_likely` real,
	`cost_high` real,
	`basis` text NOT NULL,
	`assumptions` text,
	`source_reference` text,
	`as_of` text NOT NULL,
	`confidence` text DEFAULT 'unassessed' NOT NULL,
	`created_by_user_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`objective_id`) REFERENCES `incumbent_objective`(`id`),
	FOREIGN KEY (`created_by_user_id`) REFERENCES `app_user`(`id`),
	CONSTRAINT `objective_estimate_source` CHECK(`estimate_source` IN ('incumbent','government','independent')),
	CONSTRAINT `objective_estimate_confidence` CHECK(`confidence` IN ('unassessed','low','medium','high')),
	CONSTRAINT `objective_estimate_nonnegative` CHECK(COALESCE(`hours_low`,0) >= 0 AND COALESCE(`hours_likely`,0) >= 0 AND COALESCE(`hours_high`,0) >= 0 AND COALESCE(`cost_low`,0) >= 0 AND COALESCE(`cost_likely`,0) >= 0 AND COALESCE(`cost_high`,0) >= 0)
);
--> statement-breakpoint
CREATE INDEX `objective_estimate_objective_ix` ON `objective_estimate` (`objective_id`,`estimate_source`,`as_of`);
--> statement-breakpoint
CREATE TABLE `requirement_trace` (
	`id` text PRIMARY KEY NOT NULL,
	`objective_id` text NOT NULL,
	`external_identifier` text NOT NULL,
	`title` text NOT NULL,
	`source_system` text NOT NULL,
	`source_locator` text,
	`source_as_of` text,
	`change_action` text DEFAULT 'verify' NOT NULL,
	`before_text` text,
	`after_text` text,
	`rationale` text,
	`trace_status` text DEFAULT 'identified' NOT NULL,
	`created_by_user_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`objective_id`) REFERENCES `incumbent_objective`(`id`),
	FOREIGN KEY (`created_by_user_id`) REFERENCES `app_user`(`id`),
	CONSTRAINT `requirement_trace_action` CHECK(`change_action` IN ('add','modify','retire','verify','none')),
	CONSTRAINT `requirement_trace_status` CHECK(`trace_status` IN ('identified','analysis_needed','traced','verified','not_applicable'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `requirement_trace_objective_external_uq` ON `requirement_trace` (`objective_id`,`external_identifier`);
--> statement-breakpoint
CREATE INDEX `requirement_trace_status_ix` ON `requirement_trace` (`objective_id`,`trace_status`);
--> statement-breakpoint
CREATE TABLE `acceptance_criterion` (
	`id` text PRIMARY KEY NOT NULL,
	`objective_id` text NOT NULL,
	`requirement_trace_id` text,
	`tier` text NOT NULL,
	`code` text NOT NULL,
	`statement` text NOT NULL,
	`verification_method` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`planned_date` text,
	`actual_date` text,
	`evidence_reference` text,
	`created_by_user_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`objective_id`) REFERENCES `incumbent_objective`(`id`),
	FOREIGN KEY (`requirement_trace_id`) REFERENCES `requirement_trace`(`id`),
	FOREIGN KEY (`created_by_user_id`) REFERENCES `app_user`(`id`),
	CONSTRAINT `acceptance_criterion_tier` CHECK(`tier` IN ('tier_3','tier_4','other')),
	CONSTRAINT `acceptance_criterion_method` CHECK(`verification_method` IN ('analysis','demonstration','inspection','test','review')),
	CONSTRAINT `acceptance_criterion_status` CHECK(`status` IN ('draft','ready','in_verification','passed','failed','waived'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `acceptance_criterion_objective_code_uq` ON `acceptance_criterion` (`objective_id`,`code`);
--> statement-breakpoint
CREATE INDEX `acceptance_criterion_status_ix` ON `acceptance_criterion` (`objective_id`,`status`,`planned_date`);
--> statement-breakpoint
CREATE TABLE `acceptance_signoff` (
	`id` text PRIMARY KEY NOT NULL,
	`criterion_id` text NOT NULL,
	`signoff_role` text NOT NULL,
	`signer` text,
	`decision` text DEFAULT 'pending' NOT NULL,
	`decided_at` text,
	`rationale` text,
	`evidence_document_id` text,
	`created_by_user_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`criterion_id`) REFERENCES `acceptance_criterion`(`id`),
	FOREIGN KEY (`created_by_user_id`) REFERENCES `app_user`(`id`),
	CONSTRAINT `acceptance_signoff_decision` CHECK(`decision` IN ('pending','accepted','rejected','waived'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `acceptance_signoff_role_uq` ON `acceptance_signoff` (`criterion_id`,`signoff_role`);
--> statement-breakpoint
CREATE INDEX `acceptance_signoff_decision_ix` ON `acceptance_signoff` (`criterion_id`,`decision`);
--> statement-breakpoint
CREATE TABLE `initiative_milestone` (
	`id` text PRIMARY KEY NOT NULL,
	`initiative_id` text NOT NULL,
	`change_request_id` text,
	`objective_id` text,
	`title` text NOT NULL,
	`milestone_type` text NOT NULL,
	`planned_date` text NOT NULL,
	`actual_date` text,
	`status` text DEFAULT 'planned' NOT NULL,
	`consequence_if_missed` text,
	`owner` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_by_user_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`initiative_id`) REFERENCES `initiative`(`id`),
	FOREIGN KEY (`change_request_id`) REFERENCES `change_request`(`id`),
	FOREIGN KEY (`objective_id`) REFERENCES `incumbent_objective`(`id`),
	FOREIGN KEY (`created_by_user_id`) REFERENCES `app_user`(`id`),
	CONSTRAINT `initiative_milestone_type` CHECK(`milestone_type` IN ('decision','delivery','verification','fielding','dependency')),
	CONSTRAINT `initiative_milestone_status` CHECK(`status` IN ('planned','at_risk','complete','missed'))
);
--> statement-breakpoint
CREATE INDEX `initiative_milestone_timeline_ix` ON `initiative_milestone` (`initiative_id`,`planned_date`,`status`);
--> statement-breakpoint
CREATE INDEX `initiative_milestone_request_ix` ON `initiative_milestone` (`change_request_id`,`planned_date`);
--> statement-breakpoint
PRAGMA optimize;
