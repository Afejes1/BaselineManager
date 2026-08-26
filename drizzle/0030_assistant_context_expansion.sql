-- Objective and Release analysis remains user-curated scratchpad material. It
-- is deliberately separate from source evidence, assessments, and decisions.
CREATE TABLE `assistant_saved_prompt_next` (
  `id` text PRIMARY KEY NOT NULL,
  `program_id` text NOT NULL REFERENCES `program`(`id`) ON DELETE CASCADE,
  `scope_kind` text CHECK (`scope_kind` IS NULL OR `scope_kind` IN ('initiative','change_request','objective','product','platform','release')),
  `title` text NOT NULL,
  `prompt_text` text NOT NULL,
  `created_by_user_id` text NOT NULL REFERENCES `app_user`(`id`),
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  UNIQUE(`program_id`,`scope_kind`,`title`)
);
--> statement-breakpoint
INSERT INTO `assistant_saved_prompt_next` (`id`,`program_id`,`scope_kind`,`title`,`prompt_text`,`created_by_user_id`,`created_at`,`updated_at`)
SELECT `id`,`program_id`,`scope_kind`,`title`,`prompt_text`,`created_by_user_id`,`created_at`,`updated_at` FROM `assistant_saved_prompt`;
--> statement-breakpoint
DROP TABLE `assistant_saved_prompt`;
--> statement-breakpoint
ALTER TABLE `assistant_saved_prompt_next` RENAME TO `assistant_saved_prompt`;
--> statement-breakpoint
CREATE INDEX `idx_assistant_saved_prompt_scope` ON `assistant_saved_prompt` (`program_id`,`scope_kind`,`updated_at` DESC);
--> statement-breakpoint
CREATE TABLE `assistant_scratchpad_entry_next` (
  `id` text PRIMARY KEY NOT NULL,
  `program_id` text NOT NULL REFERENCES `program`(`id`) ON DELETE CASCADE,
  `context_kind` text NOT NULL CHECK (`context_kind` IN ('initiative','change_request','objective','product','platform','release')),
  `context_id` text NOT NULL,
  `context_label` text NOT NULL,
  `title` text NOT NULL,
  `prompt_text` text NOT NULL,
  `response_text` text NOT NULL,
  `proposal_json` text,
  `model_name` text,
  `grounding_summary` text NOT NULL,
  `created_by_user_id` text NOT NULL REFERENCES `app_user`(`id`),
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL
);
--> statement-breakpoint
INSERT INTO `assistant_scratchpad_entry_next` (`id`,`program_id`,`context_kind`,`context_id`,`context_label`,`title`,`prompt_text`,`response_text`,`proposal_json`,`model_name`,`grounding_summary`,`created_by_user_id`,`created_at`,`updated_at`)
SELECT `id`,`program_id`,`context_kind`,`context_id`,`context_label`,`title`,`prompt_text`,`response_text`,`proposal_json`,`model_name`,`grounding_summary`,`created_by_user_id`,`created_at`,`updated_at` FROM `assistant_scratchpad_entry`;
--> statement-breakpoint
DROP TABLE `assistant_scratchpad_entry`;
--> statement-breakpoint
ALTER TABLE `assistant_scratchpad_entry_next` RENAME TO `assistant_scratchpad_entry`;
--> statement-breakpoint
CREATE INDEX `idx_assistant_scratchpad_context` ON `assistant_scratchpad_entry` (`program_id`,`context_kind`,`context_id`,`updated_at` DESC);
--> statement-breakpoint
CREATE INDEX `idx_assistant_scratchpad_register` ON `assistant_scratchpad_entry` (`program_id`,`updated_at` DESC);
--> statement-breakpoint
PRAGMA optimize;
