-- Work-package parent guard repair
--
-- Legacy records may retain an Objective-only parent hierarchy with no
-- Initiative identifier.  Preserve that historical evidence while enforcing
-- that every new or re-parented Initiative work package stays within its
-- owning Initiative.

DROP TRIGGER IF EXISTS `work_package_parent_same_initiative_insert`;
--> statement-breakpoint
DROP TRIGGER IF EXISTS `work_package_parent_same_initiative_update`;
--> statement-breakpoint

CREATE TRIGGER `work_package_parent_same_initiative_insert`
BEFORE INSERT ON `work_package`
WHEN NEW.`parent_id` IS NOT NULL
 AND NEW.`initiative_id` IS NOT NULL
 AND NOT EXISTS (
   SELECT 1 FROM `work_package` p
   WHERE p.`id`=NEW.`parent_id`
     AND p.`initiative_id`=NEW.`initiative_id`
 )
BEGIN
  SELECT RAISE(ABORT, 'Work package parent must belong to the same Initiative');
END;
--> statement-breakpoint

CREATE TRIGGER `work_package_parent_same_initiative_update`
BEFORE UPDATE OF `parent_id`,`initiative_id` ON `work_package`
WHEN NEW.`parent_id` IS NOT NULL
 AND NEW.`initiative_id` IS NOT NULL
 AND NOT EXISTS (
   SELECT 1 FROM `work_package` p
   WHERE p.`id`=NEW.`parent_id`
     AND p.`initiative_id`=NEW.`initiative_id`
 )
BEGIN
  SELECT RAISE(ABORT, 'Work package parent must belong to the same Initiative');
END;
