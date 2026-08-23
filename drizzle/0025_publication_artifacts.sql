ALTER TABLE `brief_publication` ADD COLUMN `byte_size` integer NOT NULL DEFAULT 0;
ALTER TABLE `brief_publication` ADD COLUMN `source_hash` text NOT NULL DEFAULT 'legacy-unverified';
ALTER TABLE `brief_publication` ADD COLUMN `renderer_version` text NOT NULL DEFAULT 'legacy';
ALTER TABLE `brief_publication` ADD COLUMN `artifact_document_id` text REFERENCES `evidence_document`(`id`);
CREATE UNIQUE INDEX `brief_publication_artifact_uq` ON `brief_publication` (`artifact_document_id`);
UPDATE `executive_brief`
SET `status` = 'reviewed', `published_at` = NULL
WHERE `status` = 'published'
  AND NOT EXISTS (
    SELECT 1 FROM `brief_publication`
    WHERE `brief_publication`.`brief_id` = `executive_brief`.`id`
      AND `brief_publication`.`artifact_document_id` IS NOT NULL
  );
