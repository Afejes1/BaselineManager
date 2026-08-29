-- Narrative authority and persisted, non-authoritative GenAI solution drafts.
ALTER TABLE `change_request` ADD COLUMN `source_description` text;
ALTER TABLE `change_request` ADD COLUMN `government_synopsis` text;
ALTER TABLE `change_request` ADD COLUMN `description_authority` text NOT NULL DEFAULT 'migrated_unclassified'
  CHECK (`description_authority` IN ('reported','analyst_transcribed','migrated_unclassified'));
UPDATE `change_request` SET `source_description`=`summary` WHERE `source_description` IS NULL;

ALTER TABLE `incumbent_objective` ADD COLUMN `source_description` text;
ALTER TABLE `incumbent_objective` ADD COLUMN `government_synopsis` text;
ALTER TABLE `incumbent_objective` ADD COLUMN `description_authority` text NOT NULL DEFAULT 'migrated_unclassified'
  CHECK (`description_authority` IN ('reported','analyst_transcribed','migrated_unclassified'));
UPDATE `incumbent_objective` SET `source_description`=`summary` WHERE `source_description` IS NULL;
UPDATE `incumbent_objective`
SET `description_authority`='reported'
WHERE EXISTS (SELECT 1 FROM `objective_source_row` r WHERE r.`objective_id`=`incumbent_objective`.`id`)
   OR EXISTS (SELECT 1 FROM `lm_objective_feed_subject` s WHERE s.`canonical_objective_id`=`incumbent_objective`.`id`);

CREATE TABLE `assistant_solution_generation` (
  `id` text PRIMARY KEY NOT NULL,
  `program_id` text NOT NULL REFERENCES `program`(`id`),
  `initiative_id` text NOT NULL REFERENCES `initiative`(`id`),
  `revision` integer NOT NULL,
  `discovery_mode` text NOT NULL CHECK (`discovery_mode` IN ('portfolio','shortlist')),
  `prompt_text` text NOT NULL,
  `candidate_manifest_json` text NOT NULL,
  `grounding_fingerprint` text NOT NULL,
  `model_name` text NOT NULL,
  `response_payload_json` text NOT NULL,
  `reviewed_payload_json` text,
  `applied_payload_json` text,
  `payload_hash` text NOT NULL CHECK (`payload_hash` GLOB 'sha256:*' AND LENGTH(`payload_hash`)=71),
  `status` text NOT NULL DEFAULT 'generated' CHECK (`status` IN ('generated','reviewed','partially_applied','applied','dismissed','stale')),
  `created_by_user_id` text REFERENCES `app_user`(`id`),
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL
);
CREATE UNIQUE INDEX `assistant_solution_generation_revision_uq` ON `assistant_solution_generation` (`initiative_id`,`revision`);
CREATE INDEX `assistant_solution_generation_initiative_ix` ON `assistant_solution_generation` (`initiative_id`,`created_at` DESC);

