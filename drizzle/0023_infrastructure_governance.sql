PRAGMA foreign_keys=ON;
--> statement-breakpoint
CREATE TABLE `infrastructure_reference_value` (
  `id` text PRIMARY KEY NOT NULL,
  `program_id` text NOT NULL REFERENCES `program`(`id`),
  `category` text NOT NULL CHECK (`category` IN ('storage_medium','file_system')),
  `code` text NOT NULL,
  `normalized_code` text NOT NULL,
  `name` text NOT NULL,
  `description` text,
  `lifecycle_status` text DEFAULT 'active' NOT NULL CHECK (`lifecycle_status` IN ('active','retired')),
  `created_by_user_id` text REFERENCES `app_user`(`id`),
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `infrastructure_reference_code_uq` ON `infrastructure_reference_value` (`program_id`,`category`,`normalized_code`);
--> statement-breakpoint
CREATE INDEX `infrastructure_reference_category_ix` ON `infrastructure_reference_value` (`program_id`,`category`,`lifecycle_status`,`name`);
--> statement-breakpoint
INSERT OR IGNORE INTO `infrastructure_reference_value` (`id`,`program_id`,`category`,`code`,`normalized_code`,`name`,`description`,`lifecycle_status`,`created_at`,`updated_at`)
SELECT 'infra-storage-hdd','program-jsf','storage_medium','HDD','hdd','Hard disk drive','Magnetic disk storage','active',datetime('now'),datetime('now') FROM `program` WHERE `id`='program-jsf';
--> statement-breakpoint
INSERT OR IGNORE INTO `infrastructure_reference_value` (`id`,`program_id`,`category`,`code`,`normalized_code`,`name`,`description`,`lifecycle_status`,`created_at`,`updated_at`)
SELECT 'infra-storage-ssd','program-jsf','storage_medium','SSD','ssd','Solid-state drive','Solid-state block storage','active',datetime('now'),datetime('now') FROM `program` WHERE `id`='program-jsf';
--> statement-breakpoint
INSERT OR IGNORE INTO `infrastructure_reference_value` (`id`,`program_id`,`category`,`code`,`normalized_code`,`name`,`description`,`lifecycle_status`,`created_at`,`updated_at`)
SELECT 'infra-storage-nvme','program-jsf','storage_medium','NVME','nvme','NVMe','NVMe solid-state storage','active',datetime('now'),datetime('now') FROM `program` WHERE `id`='program-jsf';
--> statement-breakpoint
INSERT OR IGNORE INTO `infrastructure_reference_value` (`id`,`program_id`,`category`,`code`,`normalized_code`,`name`,`description`,`lifecycle_status`,`created_at`,`updated_at`)
SELECT 'infra-storage-san','program-jsf','storage_medium','SAN','san','Storage area network','SAN-provided storage','active',datetime('now'),datetime('now') FROM `program` WHERE `id`='program-jsf';
--> statement-breakpoint
INSERT OR IGNORE INTO `infrastructure_reference_value` (`id`,`program_id`,`category`,`code`,`normalized_code`,`name`,`description`,`lifecycle_status`,`created_at`,`updated_at`)
SELECT 'infra-storage-nas','program-jsf','storage_medium','NAS','nas','Network-attached storage','NAS-provided storage','active',datetime('now'),datetime('now') FROM `program` WHERE `id`='program-jsf';
--> statement-breakpoint
INSERT OR IGNORE INTO `infrastructure_reference_value` (`id`,`program_id`,`category`,`code`,`normalized_code`,`name`,`description`,`lifecycle_status`,`created_at`,`updated_at`)
SELECT 'infra-storage-flash','program-jsf','storage_medium','FLASH','flash','Flash array','Shared flash storage','active',datetime('now'),datetime('now') FROM `program` WHERE `id`='program-jsf';
--> statement-breakpoint
INSERT OR IGNORE INTO `infrastructure_reference_value` (`id`,`program_id`,`category`,`code`,`normalized_code`,`name`,`description`,`lifecycle_status`,`created_at`,`updated_at`)
SELECT 'infra-storage-optical','program-jsf','storage_medium','OPTICAL','optical','Optical media','Optical storage media','active',datetime('now'),datetime('now') FROM `program` WHERE `id`='program-jsf';
--> statement-breakpoint
INSERT OR IGNORE INTO `infrastructure_reference_value` (`id`,`program_id`,`category`,`code`,`normalized_code`,`name`,`description`,`lifecycle_status`,`created_at`,`updated_at`)
SELECT 'infra-storage-tape','program-jsf','storage_medium','TAPE','tape','Tape','Tape storage','active',datetime('now'),datetime('now') FROM `program` WHERE `id`='program-jsf';
--> statement-breakpoint
INSERT OR IGNORE INTO `infrastructure_reference_value` (`id`,`program_id`,`category`,`code`,`normalized_code`,`name`,`description`,`lifecycle_status`,`created_at`,`updated_at`)
SELECT 'infra-storage-ephemeral','program-jsf','storage_medium','EPHEMERAL','ephemeral','Ephemeral storage','Non-persistent runtime storage','active',datetime('now'),datetime('now') FROM `program` WHERE `id`='program-jsf';
--> statement-breakpoint
INSERT OR IGNORE INTO `infrastructure_reference_value` (`id`,`program_id`,`category`,`code`,`normalized_code`,`name`,`description`,`lifecycle_status`,`created_at`,`updated_at`)
SELECT 'infra-storage-other','program-jsf','storage_medium','OTHER','other','Other governed medium','Reviewed storage medium not represented by a standard value','active',datetime('now'),datetime('now') FROM `program` WHERE `id`='program-jsf';
--> statement-breakpoint
INSERT OR IGNORE INTO `infrastructure_reference_value` (`id`,`program_id`,`category`,`code`,`normalized_code`,`name`,`description`,`lifecycle_status`,`created_at`,`updated_at`)
SELECT 'infra-fs-ntfs','program-jsf','file_system','NTFS','ntfs','NTFS','Windows NT File System','active',datetime('now'),datetime('now') FROM `program` WHERE `id`='program-jsf';
--> statement-breakpoint
INSERT OR IGNORE INTO `infrastructure_reference_value` (`id`,`program_id`,`category`,`code`,`normalized_code`,`name`,`description`,`lifecycle_status`,`created_at`,`updated_at`)
SELECT 'infra-fs-refs','program-jsf','file_system','REFS','refs','ReFS','Resilient File System','active',datetime('now'),datetime('now') FROM `program` WHERE `id`='program-jsf';
--> statement-breakpoint
INSERT OR IGNORE INTO `infrastructure_reference_value` (`id`,`program_id`,`category`,`code`,`normalized_code`,`name`,`description`,`lifecycle_status`,`created_at`,`updated_at`)
SELECT 'infra-fs-ext4','program-jsf','file_system','EXT4','ext4','ext4','Fourth extended file system','active',datetime('now'),datetime('now') FROM `program` WHERE `id`='program-jsf';
--> statement-breakpoint
INSERT OR IGNORE INTO `infrastructure_reference_value` (`id`,`program_id`,`category`,`code`,`normalized_code`,`name`,`description`,`lifecycle_status`,`created_at`,`updated_at`)
SELECT 'infra-fs-xfs','program-jsf','file_system','XFS','xfs','XFS','XFS file system','active',datetime('now'),datetime('now') FROM `program` WHERE `id`='program-jsf';
--> statement-breakpoint
INSERT OR IGNORE INTO `infrastructure_reference_value` (`id`,`program_id`,`category`,`code`,`normalized_code`,`name`,`description`,`lifecycle_status`,`created_at`,`updated_at`)
SELECT 'infra-fs-zfs','program-jsf','file_system','ZFS','zfs','ZFS','ZFS file system','active',datetime('now'),datetime('now') FROM `program` WHERE `id`='program-jsf';
--> statement-breakpoint
INSERT OR IGNORE INTO `infrastructure_reference_value` (`id`,`program_id`,`category`,`code`,`normalized_code`,`name`,`description`,`lifecycle_status`,`created_at`,`updated_at`)
SELECT 'infra-fs-nfs','program-jsf','file_system','NFS','nfs','NFS','Network File System','active',datetime('now'),datetime('now') FROM `program` WHERE `id`='program-jsf';
--> statement-breakpoint
INSERT OR IGNORE INTO `infrastructure_reference_value` (`id`,`program_id`,`category`,`code`,`normalized_code`,`name`,`description`,`lifecycle_status`,`created_at`,`updated_at`)
SELECT 'infra-fs-vmfs','program-jsf','file_system','VMFS','vmfs','VMFS','VMware Virtual Machine File System','active',datetime('now'),datetime('now') FROM `program` WHERE `id`='program-jsf';
--> statement-breakpoint
INSERT OR IGNORE INTO `infrastructure_reference_value` (`id`,`program_id`,`category`,`code`,`normalized_code`,`name`,`description`,`lifecycle_status`,`created_at`,`updated_at`)
SELECT 'infra-fs-other','program-jsf','file_system','OTHER','other','Other governed file system','Reviewed file system not represented by a standard value','active',datetime('now'),datetime('now') FROM `program` WHERE `id`='program-jsf';
--> statement-breakpoint
ALTER TABLE `release_infrastructure_node` ADD `storage_medium_id` text REFERENCES `infrastructure_reference_value`(`id`);
--> statement-breakpoint
ALTER TABLE `release_infrastructure_node` ADD `file_system_value_id` text REFERENCES `infrastructure_reference_value`(`id`);
--> statement-breakpoint
UPDATE `release_infrastructure_node` SET `storage_medium_id`=(SELECT `id` FROM `infrastructure_reference_value` WHERE `program_id`=`release_infrastructure_node`.`program_id` AND `category`='storage_medium' AND `normalized_code`=lower(trim(`release_infrastructure_node`.`storage_type`))) WHERE trim(COALESCE(`storage_type`,''))<>'';
--> statement-breakpoint
UPDATE `release_infrastructure_node` SET `file_system_value_id`=(SELECT `id` FROM `infrastructure_reference_value` WHERE `program_id`=`release_infrastructure_node`.`program_id` AND `category`='file_system' AND `normalized_code`=lower(trim(`release_infrastructure_node`.`file_system`))) WHERE trim(COALESCE(`file_system`,''))<>'';
--> statement-breakpoint
CREATE INDEX `release_infrastructure_storage_medium_ix` ON `release_infrastructure_node` (`storage_medium_id`);
--> statement-breakpoint
CREATE INDEX `release_infrastructure_file_system_ix` ON `release_infrastructure_node` (`file_system_value_id`);
--> statement-breakpoint
CREATE TABLE `governance_record_link_next` (
  `id` text PRIMARY KEY NOT NULL,
  `governance_record_id` text NOT NULL REFERENCES `governance_record`(`id`),
  `entity_kind` text NOT NULL CHECK (`entity_kind` IN ('initiative','work_package','release','product','capability','occurrence','configuration_node','platform','organization','change_request','objective','infrastructure_node','infrastructure_state','infrastructure_installation','infrastructure_connection')),
  `entity_id` text NOT NULL,
  `relationship` text DEFAULT 'affects' NOT NULL,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL
);
--> statement-breakpoint
INSERT INTO `governance_record_link_next` (`id`,`governance_record_id`,`entity_kind`,`entity_id`,`relationship`,`created_at`,`updated_at`) SELECT `id`,`governance_record_id`,`entity_kind`,`entity_id`,`relationship`,`created_at`,`updated_at` FROM `governance_record_link`;
--> statement-breakpoint
DROP TABLE `governance_record_link`;
--> statement-breakpoint
ALTER TABLE `governance_record_link_next` RENAME TO `governance_record_link`;
--> statement-breakpoint
CREATE UNIQUE INDEX `governance_record_link_uq` ON `governance_record_link` (`governance_record_id`,`entity_kind`,`entity_id`,`relationship`);
--> statement-breakpoint
CREATE INDEX `governance_record_link_target_ix` ON `governance_record_link` (`entity_kind`,`entity_id`);
--> statement-breakpoint
PRAGMA optimize;
