ALTER TABLE `change_dependency` ADD `consequence_if_unmet` text;
--> statement-breakpoint
ALTER TABLE `change_dependency` ADD `owner` text;
--> statement-breakpoint
ALTER TABLE `change_dependency` ADD `confidence` text NOT NULL DEFAULT 'reported';
--> statement-breakpoint
ALTER TABLE `change_dependency` ADD `source_reference` text;
--> statement-breakpoint
ALTER TABLE `change_dependency` ADD `source_as_of` text;
--> statement-breakpoint
ALTER TABLE `change_dependency` ADD `created_by_user_id` text REFERENCES `app_user`(`id`);
--> statement-breakpoint
CREATE INDEX `change_dependency_governance_ix` ON `change_dependency` (`confidence`,`source_as_of`);
--> statement-breakpoint
UPDATE `change_dependency` SET
  `consequence_if_unmet`=COALESCE(`consequence_if_unmet`,'Downstream scope, schedule, fielding, or acceptance may be affected until this relationship is resolved.'),
  `owner`=COALESCE(`owner`,'Government Mission Systems Architecture (synthetic)'),
  `confidence`='assessed',
  `source_reference`=COALESCE(`source_reference`,'DEMO://DEPENDENCY/' || `id`),
  `source_as_of`=COALESCE(`source_as_of`,'2026-08-20')
WHERE `id` LIKE 'demo-dependency-%';
