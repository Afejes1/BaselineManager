-- Release and Platform are cached on placements and connections for portfolio
-- queries. The selected node state remains the governing placement, so repair
-- existing cached values and reject future mismatches.
UPDATE `infrastructure_product_installation`
SET `release_id`=(SELECT `rs`.`release_id` FROM `release_infrastructure_node` `rs` WHERE `rs`.`id`=`infrastructure_product_installation`.`node_state_id`),
    `platform_id`=(SELECT `rs`.`platform_id` FROM `release_infrastructure_node` `rs` WHERE `rs`.`id`=`infrastructure_product_installation`.`node_state_id`)
WHERE EXISTS (SELECT 1 FROM `release_infrastructure_node` `rs` WHERE `rs`.`id`=`infrastructure_product_installation`.`node_state_id` AND (`rs`.`release_id`<>`infrastructure_product_installation`.`release_id` OR `rs`.`platform_id`<>`infrastructure_product_installation`.`platform_id`));
--> statement-breakpoint
UPDATE `infrastructure_connection`
SET `release_id`=(SELECT `source_state`.`release_id` FROM `release_infrastructure_node` `source_state` WHERE `source_state`.`id`=`infrastructure_connection`.`source_node_state_id`),
    `platform_id`=(SELECT `source_state`.`platform_id` FROM `release_infrastructure_node` `source_state` WHERE `source_state`.`id`=`infrastructure_connection`.`source_node_state_id`)
WHERE EXISTS (
  SELECT 1 FROM `release_infrastructure_node` `source_state`
  JOIN `release_infrastructure_node` `target_state` ON `target_state`.`id`=`infrastructure_connection`.`target_node_state_id`
  WHERE `source_state`.`id`=`infrastructure_connection`.`source_node_state_id`
    AND `source_state`.`release_id`=`target_state`.`release_id`
    AND `source_state`.`platform_id`=`target_state`.`platform_id`
    AND (`source_state`.`release_id`<>`infrastructure_connection`.`release_id` OR `source_state`.`platform_id`<>`infrastructure_connection`.`platform_id`)
);
--> statement-breakpoint
CREATE TRIGGER `infrastructure_installation_position_insert_guard`
BEFORE INSERT ON `infrastructure_product_installation`
WHEN NOT EXISTS (
  SELECT 1 FROM `release_infrastructure_node` `rs`
  WHERE `rs`.`id`=NEW.`node_state_id`
    AND `rs`.`program_id`=NEW.`program_id`
    AND `rs`.`release_id`=NEW.`release_id`
    AND `rs`.`platform_id`=NEW.`platform_id`
)
BEGIN
  SELECT RAISE(ABORT, 'Product placement Release and Platform must match its infrastructure node state');
END;
--> statement-breakpoint
CREATE TRIGGER `infrastructure_installation_position_update_guard`
BEFORE UPDATE OF `program_id`,`release_id`,`platform_id`,`node_state_id` ON `infrastructure_product_installation`
WHEN NOT EXISTS (
  SELECT 1 FROM `release_infrastructure_node` `rs`
  WHERE `rs`.`id`=NEW.`node_state_id`
    AND `rs`.`program_id`=NEW.`program_id`
    AND `rs`.`release_id`=NEW.`release_id`
    AND `rs`.`platform_id`=NEW.`platform_id`
)
BEGIN
  SELECT RAISE(ABORT, 'Product placement Release and Platform must match its infrastructure node state');
END;
--> statement-breakpoint
CREATE TRIGGER `infrastructure_connection_position_insert_guard`
BEFORE INSERT ON `infrastructure_connection`
WHEN NOT EXISTS (
  SELECT 1 FROM `release_infrastructure_node` `source_state`
  JOIN `release_infrastructure_node` `target_state` ON `target_state`.`id`=NEW.`target_node_state_id`
  WHERE `source_state`.`id`=NEW.`source_node_state_id`
    AND `source_state`.`program_id`=NEW.`program_id`
    AND `target_state`.`program_id`=NEW.`program_id`
    AND `source_state`.`release_id`=NEW.`release_id`
    AND `target_state`.`release_id`=NEW.`release_id`
    AND `source_state`.`platform_id`=NEW.`platform_id`
    AND `target_state`.`platform_id`=NEW.`platform_id`
)
BEGIN
  SELECT RAISE(ABORT, 'Infrastructure connection Release and Platform must match both node states');
END;
--> statement-breakpoint
CREATE TRIGGER `infrastructure_connection_position_update_guard`
BEFORE UPDATE OF `program_id`,`release_id`,`platform_id`,`source_node_state_id`,`target_node_state_id` ON `infrastructure_connection`
WHEN NOT EXISTS (
  SELECT 1 FROM `release_infrastructure_node` `source_state`
  JOIN `release_infrastructure_node` `target_state` ON `target_state`.`id`=NEW.`target_node_state_id`
  WHERE `source_state`.`id`=NEW.`source_node_state_id`
    AND `source_state`.`program_id`=NEW.`program_id`
    AND `target_state`.`program_id`=NEW.`program_id`
    AND `source_state`.`release_id`=NEW.`release_id`
    AND `target_state`.`release_id`=NEW.`release_id`
    AND `source_state`.`platform_id`=NEW.`platform_id`
    AND `target_state`.`platform_id`=NEW.`platform_id`
)
BEGIN
  SELECT RAISE(ABORT, 'Infrastructure connection Release and Platform must match both node states');
END;
--> statement-breakpoint
PRAGMA optimize;
