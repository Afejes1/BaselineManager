PRAGMA foreign_keys=ON;
--> statement-breakpoint
ALTER TABLE `infrastructure_node` ADD `configuration_node_id` text REFERENCES `configuration_node`(`id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `infrastructure_node_configuration_uq` ON `infrastructure_node` (`platform_id`,`configuration_node_id`) WHERE `configuration_node_id` IS NOT NULL;
--> statement-breakpoint
ALTER TABLE `release_infrastructure_node` ADD `confidence` text DEFAULT 'reported' NOT NULL;
--> statement-breakpoint
ALTER TABLE `infrastructure_product_installation` ADD `source_identity` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `infrastructure_product_installation` ADD `confidence` text DEFAULT 'reported' NOT NULL;
--> statement-breakpoint
DROP INDEX `infrastructure_installation_position_uq`;
--> statement-breakpoint
CREATE UNIQUE INDEX `infrastructure_installation_position_uq` ON `infrastructure_product_installation` (`node_state_id`,`product_id`,`installation_role`,`normalized_instance_name`,`source_identity`);
--> statement-breakpoint
INSERT OR IGNORE INTO `infrastructure_node` (
  `id`,`program_id`,`platform_id`,`configuration_node_id`,`node_type`,`code`,`normalized_code`,`name`,`normalized_name`,`lifecycle_status`,`description`,`created_by_user_id`,`created_at`,`updated_at`
)
SELECT
  'a2o-infra-node-' || bo.`configuration_node_id`, bo.`program_id`, pba.`platform_id`, bo.`configuration_node_id`,
  'other', cn.`name`, cn.`normalized_name`, cn.`name`, cn.`normalized_name`, 'active',
  'Reported A2O HW_Host. Physical, virtual, or appliance classification has not been independently confirmed.',
  pba.`created_by_user_id`, bo.`created_at`, bo.`updated_at`
FROM `baseline_occurrence` bo
JOIN `configuration_node` cn ON cn.`id`=bo.`configuration_node_id` AND cn.`node_type`='host'
JOIN `platform_baseline_assignment` pba ON pba.`baseline_occurrence_id`=bo.`id` AND pba.`assignment_role`='primary'
WHERE bo.`lifecycle_status`='active' AND trim(COALESCE(cn.`name`,''))<>'' AND cn.`normalized_name`<>'unassigned';
--> statement-breakpoint
UPDATE `infrastructure_node`
SET `configuration_node_id`=(
  SELECT bo.`configuration_node_id`
  FROM `baseline_occurrence` bo
  JOIN `configuration_node` cn ON cn.`id`=bo.`configuration_node_id`
  JOIN `platform_baseline_assignment` pba ON pba.`baseline_occurrence_id`=bo.`id` AND pba.`assignment_role`='primary'
  WHERE pba.`platform_id`=`infrastructure_node`.`platform_id`
    AND cn.`normalized_name`=`infrastructure_node`.`normalized_code`
    AND bo.`configuration_node_id` IS NOT NULL
  ORDER BY bo.`updated_at` DESC LIMIT 1
)
WHERE `configuration_node_id` IS NULL
  AND EXISTS (
    SELECT 1 FROM `baseline_occurrence` bo
    JOIN `configuration_node` cn ON cn.`id`=bo.`configuration_node_id`
    JOIN `platform_baseline_assignment` pba ON pba.`baseline_occurrence_id`=bo.`id` AND pba.`assignment_role`='primary'
    WHERE pba.`platform_id`=`infrastructure_node`.`platform_id`
      AND cn.`normalized_name`=`infrastructure_node`.`normalized_code`
  );
--> statement-breakpoint
INSERT OR IGNORE INTO `release_infrastructure_node` (
  `id`,`program_id`,`release_id`,`platform_id`,`infrastructure_node_id`,`parent_state_id`,`lifecycle_status`,`operating_state`,`confidence`,
  `cpu_cores`,`memory_gb`,`storage_gb`,`storage_medium_id`,`storage_type`,`source_reference`,`source_as_of`,`notes`,`created_by_user_id`,`created_at`,`updated_at`
)
SELECT
  'a2o-infra-state-' || bo.`release_id` || '-' || inf.`id`, bo.`program_id`, bo.`release_id`, inf.`platform_id`, inf.`id`, NULL,
  'active','unknown','reported', bns.`cpu_cores`,bns.`ram_gb`,bns.`storage_gb`,
  (SELECT rv.`id` FROM `infrastructure_reference_value` rv WHERE rv.`program_id`=bo.`program_id` AND rv.`category`='storage_medium' AND rv.`normalized_code`=lower(trim(COALESCE(bns.`storage_type`,''))) LIMIT 1),
  bns.`storage_type`, 'A2O Tech Stack · HW_Host: ' || cn.`name`, cb.`as_of`,
  'Reported capacity. Confirm the host type and containment before treating this as an assessed configuration.',
  pba.`created_by_user_id`,bo.`created_at`,bo.`updated_at`
FROM `baseline_occurrence` bo
JOIN `configuration_node` cn ON cn.`id`=bo.`configuration_node_id` AND cn.`node_type`='host'
JOIN `platform_baseline_assignment` pba ON pba.`baseline_occurrence_id`=bo.`id` AND pba.`assignment_role`='primary'
JOIN `infrastructure_node` inf ON inf.`platform_id`=pba.`platform_id` AND inf.`configuration_node_id`=bo.`configuration_node_id`
LEFT JOIN `baseline_node_state` bns ON bns.`baseline_id`=bo.`baseline_id` AND bns.`configuration_node_id`=bo.`configuration_node_id`
LEFT JOIN `configuration_baseline` cb ON cb.`id`=bo.`baseline_id`
WHERE bo.`lifecycle_status`='active';
--> statement-breakpoint
INSERT OR IGNORE INTO `infrastructure_product_installation` (
  `id`,`program_id`,`release_id`,`platform_id`,`node_state_id`,`product_id`,`baseline_occurrence_id`,`installation_role`,`instance_name`,`normalized_instance_name`,`source_identity`,`deployment_status`,`confidence`,`source_reference`,`source_as_of`,`notes`,`created_by_user_id`,`created_at`,`updated_at`
)
SELECT
  'a2o-infra-installation-' || bo.`id`,bo.`program_id`,bo.`release_id`,ris.`platform_id`,ris.`id`,bo.`product_id`,bo.`id`,
  CASE
    WHEN lower(COALESCE(p.`product_type`,'')) LIKE '%operating system%' OR lower(p.`canonical_name`) LIKE '%windows server%' OR lower(p.`canonical_name`) LIKE '%red hat%' OR lower(p.`canonical_name`) LIKE '%linux%' THEN 'operating_system'
    WHEN lower(COALESCE(p.`product_type`,'')) LIKE '%hypervisor%' OR lower(p.`canonical_name`) LIKE '%vmware%' OR lower(p.`canonical_name`) LIKE '%hyper-v%' OR lower(p.`canonical_name`) LIKE '%esxi%' THEN 'hypervisor'
    WHEN lower(COALESCE(p.`product_type`,'')) LIKE '%database%' OR lower(p.`canonical_name`) LIKE '%database%' OR lower(p.`canonical_name`) LIKE '%dbms%' OR lower(p.`canonical_name`) LIKE '%sql server%' OR lower(p.`canonical_name`) LIKE '%postgres%' THEN 'database'
    WHEN lower(COALESCE(p.`product_type`,'')) LIKE '%runtime%' OR lower(p.`canonical_name`) LIKE '% runtime%' OR lower(p.`canonical_name`) LIKE 'java %' THEN 'runtime'
    WHEN lower(COALESCE(p.`product_type`,'')) LIKE '%middleware%' THEN 'middleware'
    WHEN lower(COALESCE(p.`product_type`,'')) LIKE '%firmware%' THEN 'firmware'
    WHEN lower(COALESCE(p.`product_type`,'')) LIKE '%agent%' OR lower(p.`canonical_name`) LIKE '% agent' THEN 'agent'
    ELSE 'application'
  END,
  NULL,'','a2o:' || bo.`id`,'installed','reported',
  'A2O Tech Stack · Baseline record ' || COALESCE(bre.`source_key`,bo.`id`),cb.`as_of`,
  'Reported Product placement. Installation role is an import classification and requires analyst confirmation.',
  pba.`created_by_user_id`,bo.`created_at`,bo.`updated_at`
FROM `baseline_occurrence` bo
JOIN `product` p ON p.`id`=bo.`product_id`
JOIN `platform_baseline_assignment` pba ON pba.`baseline_occurrence_id`=bo.`id` AND pba.`assignment_role`='primary'
JOIN `infrastructure_node` inf ON inf.`platform_id`=pba.`platform_id` AND inf.`configuration_node_id`=bo.`configuration_node_id`
JOIN `release_infrastructure_node` ris ON ris.`release_id`=bo.`release_id` AND ris.`infrastructure_node_id`=inf.`id`
LEFT JOIN `baseline_record_extension` bre ON bre.`baseline_occurrence_id`=bo.`id`
LEFT JOIN `configuration_baseline` cb ON cb.`id`=bo.`baseline_id`
WHERE bo.`lifecycle_status`='active' AND bo.`product_id` IS NOT NULL;
--> statement-breakpoint
PRAGMA optimize;
