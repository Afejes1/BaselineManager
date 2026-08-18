PRAGMA foreign_keys=ON;

CREATE TABLE `managed_host_profile` (
  `id` text PRIMARY KEY NOT NULL,
  `program_id` text NOT NULL REFERENCES `program`(`id`),
  `release_id` text NOT NULL REFERENCES `release`(`id`),
  `configuration_node_id` text NOT NULL REFERENCES `configuration_node`(`id`),
  `installation_location` text,
  `facility_or_enclave` text,
  `equipment_rack` text,
  `hardware_blade` text,
  `virtualization_platform` text,
  `source_reference` text,
  `notes` text,
  `created_by_user_id` text REFERENCES `app_user`(`id`),
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL
);
CREATE UNIQUE INDEX `managed_host_profile_release_node_uq` ON `managed_host_profile` (`release_id`,`configuration_node_id`);
CREATE INDEX `managed_host_profile_release_ix` ON `managed_host_profile` (`program_id`,`release_id`);

CREATE TABLE `managed_deployment_profile` (
  `id` text PRIMARY KEY NOT NULL,
  `program_id` text NOT NULL REFERENCES `program`(`id`),
  `baseline_occurrence_id` text NOT NULL REFERENCES `baseline_occurrence`(`id`),
  `release_id` text NOT NULL REFERENCES `release`(`id`),
  `configuration_node_id` text REFERENCES `configuration_node`(`id`),
  `product_id` text REFERENCES `product`(`id`),
  `virtual_machine` text,
  `container_instance` text,
  `application_version` text,
  `installation_identifier` text,
  `deployment_role` text,
  `source_reference` text,
  `notes` text,
  `created_by_user_id` text REFERENCES `app_user`(`id`),
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL
);
CREATE UNIQUE INDEX `managed_deployment_profile_occurrence_uq` ON `managed_deployment_profile` (`baseline_occurrence_id`);
CREATE INDEX `managed_deployment_profile_release_product_ix` ON `managed_deployment_profile` (`program_id`,`release_id`,`product_id`);
