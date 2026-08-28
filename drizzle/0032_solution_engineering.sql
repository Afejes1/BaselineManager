-- An Initiative is a Government outcome and decision case.  Candidate
-- solutions remain separate alternatives that reference retained Change
-- Requests and incumbent Objectives rather than copying their source facts.
ALTER TABLE `initiative` ADD COLUMN `problem_statement` text;
--> statement-breakpoint
ALTER TABLE `initiative` ADD COLUMN `drivers_constraints` text;
--> statement-breakpoint
CREATE TABLE `solution_option` (
  `id` text PRIMARY KEY NOT NULL,
  `initiative_id` text NOT NULL,
  `title` text NOT NULL,
  `normalized_title` text NOT NULL,
  `option_type` text NOT NULL DEFAULT 'candidate',
  `status` text NOT NULL DEFAULT 'draft',
  `summary` text,
  `projected_outcome` text,
  `expected_consequences` text,
  `residual_risks` text,
  `assumptions` text,
  `sort_order` integer NOT NULL DEFAULT 0,
  `created_by_user_id` text,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  FOREIGN KEY (`initiative_id`) REFERENCES `initiative`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`created_by_user_id`) REFERENCES `app_user`(`id`) ON UPDATE no action ON DELETE no action,
  CONSTRAINT `solution_option_type` CHECK (`option_type` IN ('candidate','status_quo')),
  CONSTRAINT `solution_option_status` CHECK (`status` IN ('draft','under_review','recommended','not_selected','retired'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `solution_option_title_uq` ON `solution_option` (`initiative_id`,`normalized_title`);
--> statement-breakpoint
CREATE INDEX `solution_option_initiative_ix` ON `solution_option` (`initiative_id`,`status`,`sort_order`);
--> statement-breakpoint
CREATE TABLE `solution_option_step` (
  `id` text PRIMARY KEY NOT NULL,
  `option_id` text NOT NULL,
  `title` text NOT NULL,
  `description` text,
  `expected_result` text,
  `sort_order` integer NOT NULL DEFAULT 0,
  `created_by_user_id` text,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  FOREIGN KEY (`option_id`) REFERENCES `solution_option`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`created_by_user_id`) REFERENCES `app_user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `solution_option_step_order_uq` ON `solution_option_step` (`option_id`,`sort_order`);
--> statement-breakpoint
CREATE TABLE `solution_option_change_request` (
  `id` text PRIMARY KEY NOT NULL,
  `option_id` text NOT NULL,
  `change_request_id` text NOT NULL,
  `relationship` text NOT NULL DEFAULT 'delivers',
  `rationale` text,
  `created_by_user_id` text,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  FOREIGN KEY (`option_id`) REFERENCES `solution_option`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`change_request_id`) REFERENCES `change_request`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`created_by_user_id`) REFERENCES `app_user`(`id`) ON UPDATE no action ON DELETE no action,
  CONSTRAINT `solution_option_change_relationship` CHECK (`relationship` IN ('delivers','enables','constrains','supports'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `solution_option_change_uq` ON `solution_option_change_request` (`option_id`,`change_request_id`);
--> statement-breakpoint
CREATE INDEX `solution_option_change_request_ix` ON `solution_option_change_request` (`change_request_id`,`option_id`);
--> statement-breakpoint
CREATE TABLE `solution_option_objective` (
  `id` text PRIMARY KEY NOT NULL,
  `option_id` text NOT NULL,
  `objective_id` text NOT NULL,
  `role` text NOT NULL DEFAULT 'required',
  `rationale` text,
  `created_by_user_id` text,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  FOREIGN KEY (`option_id`) REFERENCES `solution_option`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`objective_id`) REFERENCES `incumbent_objective`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`created_by_user_id`) REFERENCES `app_user`(`id`) ON UPDATE no action ON DELETE no action,
  CONSTRAINT `solution_option_objective_role` CHECK (`role` IN ('required','enabling','optional'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `solution_option_objective_uq` ON `solution_option_objective` (`option_id`,`objective_id`);
--> statement-breakpoint
CREATE INDEX `solution_option_objective_objective_ix` ON `solution_option_objective` (`objective_id`,`option_id`);
--> statement-breakpoint
CREATE TABLE `solution_option_assessment` (
  `id` text PRIMARY KEY NOT NULL,
  `option_id` text NOT NULL,
  `criterion` text NOT NULL,
  `rating` text NOT NULL DEFAULT 'unassessed',
  `narrative` text,
  `source_reference` text,
  `confidence` text NOT NULL DEFAULT 'unassessed',
  `created_by_user_id` text,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  FOREIGN KEY (`option_id`) REFERENCES `solution_option`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`created_by_user_id`) REFERENCES `app_user`(`id`) ON UPDATE no action ON DELETE no action,
  CONSTRAINT `solution_option_assessment_criterion` CHECK (`criterion` IN ('outcome_alignment','delivery_effort','schedule_feasibility','cyber_lifecycle','mission_operational_impact','stakeholder_impact','requirements_acceptance')),
  CONSTRAINT `solution_option_assessment_rating` CHECK (`rating` IN ('favorable','mixed','unfavorable','unassessed')),
  CONSTRAINT `solution_option_assessment_confidence` CHECK (`confidence` IN ('low','medium','high','unassessed'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `solution_option_assessment_uq` ON `solution_option_assessment` (`option_id`,`criterion`);
--> statement-breakpoint
CREATE TABLE `initiative_solution_decision` (
  `id` text PRIMARY KEY NOT NULL,
  `initiative_id` text NOT NULL,
  `selected_option_id` text,
  `disposition` text NOT NULL DEFAULT 'pending',
  `decision_authority` text,
  `decision_date` text,
  `rationale` text,
  `accepted_residual_risk` text,
  `created_by_user_id` text,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  FOREIGN KEY (`initiative_id`) REFERENCES `initiative`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`selected_option_id`) REFERENCES `solution_option`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`created_by_user_id`) REFERENCES `app_user`(`id`) ON UPDATE no action ON DELETE no action,
  CONSTRAINT `initiative_solution_disposition` CHECK (`disposition` IN ('pending','selected','deferred','no_action')),
  CONSTRAINT `initiative_solution_decision_complete` CHECK (
    (`disposition`='pending' AND `selected_option_id` IS NULL) OR
    (`disposition`='selected' AND `selected_option_id` IS NOT NULL AND LENGTH(TRIM(COALESCE(`decision_authority`,'')))>0 AND LENGTH(TRIM(COALESCE(`decision_date`,'')))>0 AND LENGTH(TRIM(COALESCE(`rationale`,'')))>0) OR
    (`disposition` IN ('deferred','no_action') AND `selected_option_id` IS NULL AND LENGTH(TRIM(COALESCE(`decision_authority`,'')))>0 AND LENGTH(TRIM(COALESCE(`decision_date`,'')))>0 AND LENGTH(TRIM(COALESCE(`rationale`,'')))>0)
  )
);
--> statement-breakpoint
CREATE UNIQUE INDEX `initiative_solution_decision_uq` ON `initiative_solution_decision` (`initiative_id`);
--> statement-breakpoint
CREATE TRIGGER `initiative_solution_decision_option_insert_guard`
BEFORE INSERT ON `initiative_solution_decision`
WHEN NEW.`selected_option_id` IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM `solution_option` `o` WHERE `o`.`id`=NEW.`selected_option_id` AND `o`.`initiative_id`=NEW.`initiative_id`
)
BEGIN
  SELECT RAISE(ABORT, 'Selected solution option must belong to the Initiative');
END;
--> statement-breakpoint
CREATE TRIGGER `initiative_solution_decision_option_update_guard`
BEFORE UPDATE OF `initiative_id`,`selected_option_id` ON `initiative_solution_decision`
WHEN NEW.`selected_option_id` IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM `solution_option` `o` WHERE `o`.`id`=NEW.`selected_option_id` AND `o`.`initiative_id`=NEW.`initiative_id`
)
BEGIN
  SELECT RAISE(ABORT, 'Selected solution option must belong to the Initiative');
END;
--> statement-breakpoint
PRAGMA optimize;
