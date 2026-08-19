ALTER TABLE `governance_record` ADD `participants` text;
--> statement-breakpoint
ALTER TABLE `governance_record` ADD `action_items` text;
--> statement-breakpoint
CREATE TABLE `governance_record_link_next` (
	`id` text PRIMARY KEY NOT NULL,
	`governance_record_id` text NOT NULL,
	`entity_kind` text NOT NULL,
	`entity_id` text NOT NULL,
	`relationship` text DEFAULT 'affects' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`governance_record_id`) REFERENCES `governance_record`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "governance_record_link_kind" CHECK(`entity_kind` IN ('initiative','work_package','release','product','capability','occurrence','configuration_node','platform','organization','change_request','objective'))
);
--> statement-breakpoint
INSERT INTO `governance_record_link_next` (`id`,`governance_record_id`,`entity_kind`,`entity_id`,`relationship`,`created_at`,`updated_at`)
SELECT `id`,`governance_record_id`,`entity_kind`,`entity_id`,`relationship`,`created_at`,`updated_at` FROM `governance_record_link`;
--> statement-breakpoint
DROP TABLE `governance_record_link`;
--> statement-breakpoint
ALTER TABLE `governance_record_link_next` RENAME TO `governance_record_link`;
--> statement-breakpoint
CREATE UNIQUE INDEX `governance_record_link_uq` ON `governance_record_link` (`governance_record_id`,`entity_kind`,`entity_id`,`relationship`);
--> statement-breakpoint
CREATE INDEX `governance_record_link_target_ix` ON `governance_record_link` (`entity_kind`,`entity_id`);
