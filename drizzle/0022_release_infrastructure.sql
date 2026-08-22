PRAGMA foreign_keys=ON;
--> statement-breakpoint
CREATE TABLE `infrastructure_node` (
  `id` text PRIMARY KEY NOT NULL,
  `program_id` text NOT NULL REFERENCES `program`(`id`),
  `platform_id` text NOT NULL REFERENCES `platform`(`id`),
  `node_type` text NOT NULL CHECK (`node_type` IN ('ups','network_switch','chassis','blade','physical_server','storage_array','logical_drive','virtual_machine','appliance','other')),
  `code` text NOT NULL,
  `normalized_code` text NOT NULL,
  `name` text NOT NULL,
  `normalized_name` text NOT NULL,
  `manufacturer_organization_id` text REFERENCES `organization`(`id`),
  `hardware_product_id` text REFERENCES `product`(`id`),
  `asset_tag` text,
  `serial_number` text,
  `lifecycle_status` text DEFAULT 'active' NOT NULL CHECK (`lifecycle_status` IN ('active','planned','retired')),
  `description` text,
  `created_by_user_id` text REFERENCES `app_user`(`id`),
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `infrastructure_node_code_uq` ON `infrastructure_node` (`platform_id`,`normalized_code`);
--> statement-breakpoint
CREATE INDEX `infrastructure_node_platform_type_ix` ON `infrastructure_node` (`platform_id`,`node_type`,`lifecycle_status`);
--> statement-breakpoint
CREATE INDEX `infrastructure_node_hardware_product_ix` ON `infrastructure_node` (`hardware_product_id`);
--> statement-breakpoint
CREATE TABLE `release_infrastructure_node` (
  `id` text PRIMARY KEY NOT NULL,
  `program_id` text NOT NULL REFERENCES `program`(`id`),
  `release_id` text NOT NULL REFERENCES `release`(`id`),
  `platform_id` text NOT NULL REFERENCES `platform`(`id`),
  `infrastructure_node_id` text NOT NULL REFERENCES `infrastructure_node`(`id`),
  `parent_state_id` text REFERENCES `release_infrastructure_node`(`id`),
  `lifecycle_status` text DEFAULT 'active' NOT NULL CHECK (`lifecycle_status` IN ('planned','active','retired','absent')),
  `operating_state` text DEFAULT 'unknown' NOT NULL CHECK (`operating_state` IN ('unknown','operational','degraded','offline','not_installed')),
  `cpu_cores` real,
  `memory_gb` real,
  `storage_gb` real,
  `storage_type` text,
  `drive_letter` text,
  `file_system` text,
  `source_reference` text,
  `source_as_of` text,
  `notes` text,
  `created_by_user_id` text REFERENCES `app_user`(`id`),
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  CHECK (`parent_state_id` IS NULL OR `parent_state_id` <> `id`),
  CHECK ((`cpu_cores` IS NULL OR `cpu_cores` >= 0) AND (`memory_gb` IS NULL OR `memory_gb` >= 0) AND (`storage_gb` IS NULL OR `storage_gb` >= 0))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `release_infrastructure_node_uq` ON `release_infrastructure_node` (`release_id`,`infrastructure_node_id`);
--> statement-breakpoint
CREATE INDEX `release_infrastructure_platform_ix` ON `release_infrastructure_node` (`platform_id`,`release_id`,`parent_state_id`);
--> statement-breakpoint
CREATE INDEX `release_infrastructure_release_type_ix` ON `release_infrastructure_node` (`release_id`,`lifecycle_status`);
--> statement-breakpoint
CREATE TABLE `infrastructure_product_installation` (
  `id` text PRIMARY KEY NOT NULL,
  `program_id` text NOT NULL REFERENCES `program`(`id`),
  `release_id` text NOT NULL REFERENCES `release`(`id`),
  `platform_id` text NOT NULL REFERENCES `platform`(`id`),
  `node_state_id` text NOT NULL REFERENCES `release_infrastructure_node`(`id`),
  `product_id` text NOT NULL REFERENCES `product`(`id`),
  `baseline_occurrence_id` text REFERENCES `baseline_occurrence`(`id`),
  `installation_role` text NOT NULL CHECK (`installation_role` IN ('operating_system','hypervisor','application','middleware','database','runtime','firmware','agent','other')),
  `instance_name` text,
  `normalized_instance_name` text DEFAULT '' NOT NULL,
  `version` text,
  `deployment_status` text DEFAULT 'installed' NOT NULL CHECK (`deployment_status` IN ('planned','installed','retired','absent')),
  `source_reference` text,
  `source_as_of` text,
  `notes` text,
  `created_by_user_id` text REFERENCES `app_user`(`id`),
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `infrastructure_installation_position_uq` ON `infrastructure_product_installation` (`node_state_id`,`product_id`,`installation_role`,`normalized_instance_name`);
--> statement-breakpoint
CREATE UNIQUE INDEX `infrastructure_installation_occurrence_uq` ON `infrastructure_product_installation` (`baseline_occurrence_id`);
--> statement-breakpoint
CREATE INDEX `infrastructure_installation_product_ix` ON `infrastructure_product_installation` (`product_id`,`release_id`);
--> statement-breakpoint
CREATE INDEX `infrastructure_installation_platform_ix` ON `infrastructure_product_installation` (`platform_id`,`release_id`,`installation_role`);
--> statement-breakpoint
CREATE TABLE `infrastructure_connection` (
  `id` text PRIMARY KEY NOT NULL,
  `program_id` text NOT NULL REFERENCES `program`(`id`),
  `release_id` text NOT NULL REFERENCES `release`(`id`),
  `platform_id` text NOT NULL REFERENCES `platform`(`id`),
  `source_node_state_id` text NOT NULL REFERENCES `release_infrastructure_node`(`id`),
  `target_node_state_id` text NOT NULL REFERENCES `release_infrastructure_node`(`id`),
  `connection_type` text NOT NULL CHECK (`connection_type` IN ('network','power','storage','cluster','management','other')),
  `label` text,
  `status` text DEFAULT 'active' NOT NULL CHECK (`status` IN ('planned','active','retired')),
  `capacity_mbps` real,
  `source_reference` text,
  `source_as_of` text,
  `notes` text,
  `created_by_user_id` text REFERENCES `app_user`(`id`),
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  CHECK (`source_node_state_id` <> `target_node_state_id`),
  CHECK (`capacity_mbps` IS NULL OR `capacity_mbps` >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `infrastructure_connection_uq` ON `infrastructure_connection` (`release_id`,`source_node_state_id`,`target_node_state_id`,`connection_type`);
--> statement-breakpoint
CREATE INDEX `infrastructure_connection_platform_ix` ON `infrastructure_connection` (`platform_id`,`release_id`,`connection_type`);
--> statement-breakpoint
PRAGMA optimize;
