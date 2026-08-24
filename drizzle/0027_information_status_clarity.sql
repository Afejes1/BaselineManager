-- A governance record may preserve a source assertion, Government analysis,
-- or a formal decision.  Keep those distinctions explicit without changing
-- the supplier's source material or retroactively classifying historic rows.
ALTER TABLE `governance_record` ADD COLUMN `information_origin` text DEFAULT 'unclassified' NOT NULL;
--> statement-breakpoint
ALTER TABLE `governance_record` ADD COLUMN `adjudication_authority` text;
--> statement-breakpoint
ALTER TABLE `governance_record` ADD COLUMN `adjudicated_at` text;
--> statement-breakpoint
ALTER TABLE `governance_record` ADD COLUMN `adjudication_rationale` text;
--> statement-breakpoint
CREATE INDEX `governance_record_origin_ix` ON `governance_record` (`program_id`,`information_origin`,`record_type`,`status`);
--> statement-breakpoint
PRAGMA optimize;
