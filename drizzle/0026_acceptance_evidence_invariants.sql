-- A passed criterion without a textual evidence reference must retain at least
-- one accepted or waived sign-off that names a governed evidence document.
-- The application verifies the referenced R2 bytes before writing. These
-- triggers provide the serial SQLite invariant so concurrent writers cannot
-- each remove the last support after independently reading stale state.
-- Repair rows created before that invariant existed. Preserve the human-entered
-- signer and rationale, but never reinterpret a missing/quarantined attachment
-- as an evidence-free completed acceptance decision.
INSERT INTO `audit_event` (`id`,`program_id`,`actor_id`,`action`,`entity_kind`,`entity_id`,`before_payload`,`after_payload`,`created_at`)
SELECT 'migration-0026-' || lower(hex(randomblob(16))),o.`program_id`,NULL,
  'acceptance_signoff_evidence_compatibility_adjusted','acceptance_signoff',s.`id`,
  json_object('decision',s.`decision`,'evidenceDocumentId',s.`evidence_document_id`),
  json_object('decision',CASE WHEN s.`decision` IN ('accepted','waived') THEN 'pending' ELSE s.`decision` END,'evidenceDocumentId',NULL,'compatibilityReason','missing_evidence'),
  strftime('%Y-%m-%dT%H:%M:%fZ','now')
FROM `acceptance_signoff` s
JOIN `acceptance_criterion` c ON c.`id`=s.`criterion_id`
JOIN `incumbent_objective` o ON o.`id`=c.`objective_id`
WHERE s.`evidence_document_id` IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM `evidence_document` d WHERE d.`id`=s.`evidence_document_id`);
--> statement-breakpoint

UPDATE `acceptance_signoff`
SET `decision`=CASE WHEN `decision` IN ('accepted','waived') THEN 'pending' ELSE `decision` END,
  `decided_at`=CASE WHEN `decision` IN ('accepted','waived') THEN NULL ELSE `decided_at` END,
  `evidence_document_id`=NULL,
  `updated_at`=strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE `evidence_document_id` IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM `evidence_document` d WHERE d.`id`=`acceptance_signoff`.`evidence_document_id`);
--> statement-breakpoint

INSERT INTO `audit_event` (`id`,`program_id`,`actor_id`,`action`,`entity_kind`,`entity_id`,`before_payload`,`after_payload`,`created_at`)
SELECT 'migration-0026-' || lower(hex(randomblob(16))),o.`program_id`,NULL,
  'acceptance_signoff_evidence_compatibility_adjusted','acceptance_signoff',s.`id`,
  json_object('decision',s.`decision`,'evidenceDocumentId',s.`evidence_document_id`),
  json_object('decision','pending','evidenceDocumentId',s.`evidence_document_id`,'compatibilityReason','quarantined_evidence'),
  strftime('%Y-%m-%dT%H:%M:%fZ','now')
FROM `acceptance_signoff` s
JOIN `acceptance_criterion` c ON c.`id`=s.`criterion_id`
JOIN `incumbent_objective` o ON o.`id`=c.`objective_id`
JOIN `evidence_document` d ON d.`id`=s.`evidence_document_id`
WHERE s.`decision` IN ('accepted','waived')
  AND d.`content_type`='application/octet-stream'
  AND d.`description` LIKE '[QUARANTINED LEGACY EVIDENCE%';
--> statement-breakpoint

UPDATE `acceptance_signoff`
SET `decision`='pending',`decided_at`=NULL,`updated_at`=strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE `decision` IN ('accepted','waived')
  AND EXISTS (
    SELECT 1 FROM `evidence_document` d
    WHERE d.`id`=`acceptance_signoff`.`evidence_document_id`
      AND d.`content_type`='application/octet-stream'
      AND d.`description` LIKE '[QUARANTINED LEGACY EVIDENCE%'
  );
--> statement-breakpoint

INSERT INTO `audit_event` (`id`,`program_id`,`actor_id`,`action`,`entity_kind`,`entity_id`,`before_payload`,`after_payload`,`created_at`)
SELECT 'migration-0026-' || lower(hex(randomblob(16))),o.`program_id`,NULL,
  'acceptance_criterion_compatibility_demoted','acceptance_criterion',c.`id`,
  json_object('status',c.`status`,'evidenceReference',c.`evidence_reference`),
  json_object('status','in_verification','evidenceReference',c.`evidence_reference`,'compatibilityReason','unsupported_passed_criterion'),
  strftime('%Y-%m-%dT%H:%M:%fZ','now')
FROM `acceptance_criterion` c
JOIN `incumbent_objective` o ON o.`id`=c.`objective_id`
WHERE c.`status`='passed'
  AND length(trim(coalesce(c.`evidence_reference`,'')))=0
  AND NOT EXISTS (
    SELECT 1 FROM `acceptance_signoff` s
    JOIN `evidence_document` d ON d.`id`=s.`evidence_document_id`
    WHERE s.`criterion_id`=c.`id`
      AND s.`decision` IN ('accepted','waived')
      AND NOT (d.`content_type`='application/octet-stream' AND d.`description` LIKE '[QUARANTINED LEGACY EVIDENCE%')
  );
--> statement-breakpoint

UPDATE `acceptance_criterion`
SET `status`='in_verification',`updated_at`=strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE `status`='passed'
  AND length(trim(coalesce(`evidence_reference`,'')))=0
  AND NOT EXISTS (
    SELECT 1 FROM `acceptance_signoff` s
    JOIN `evidence_document` d ON d.`id`=s.`evidence_document_id`
    WHERE s.`criterion_id`=`acceptance_criterion`.`id`
      AND s.`decision` IN ('accepted','waived')
      AND NOT (d.`content_type`='application/octet-stream' AND d.`description` LIKE '[QUARANTINED LEGACY EVIDENCE%')
  );
--> statement-breakpoint

CREATE TRIGGER `acceptance_criterion_passed_evidence_insert`
BEFORE INSERT ON `acceptance_criterion`
WHEN NEW.`status` = 'passed'
  AND length(trim(coalesce(NEW.`evidence_reference`, ''))) = 0
  AND NOT EXISTS (
    SELECT 1 FROM `acceptance_signoff` s
    JOIN `evidence_document` d ON d.`id`=s.`evidence_document_id`
    WHERE s.`criterion_id` = NEW.`id`
      AND s.`decision` IN ('accepted', 'waived')
      AND NOT (d.`content_type`='application/octet-stream' AND d.`description` LIKE '[QUARANTINED LEGACY EVIDENCE%')
  )
BEGIN
  SELECT RAISE(ABORT, 'passed acceptance criterion requires retained governed evidence');
END;
--> statement-breakpoint

CREATE TRIGGER `acceptance_criterion_passed_evidence_update`
BEFORE UPDATE OF `status`, `evidence_reference` ON `acceptance_criterion`
WHEN NEW.`status` = 'passed'
  AND length(trim(coalesce(NEW.`evidence_reference`, ''))) = 0
  AND NOT EXISTS (
    SELECT 1 FROM `acceptance_signoff` s
    JOIN `evidence_document` d ON d.`id`=s.`evidence_document_id`
    WHERE s.`criterion_id` = NEW.`id`
      AND s.`decision` IN ('accepted', 'waived')
      AND NOT (d.`content_type`='application/octet-stream' AND d.`description` LIKE '[QUARANTINED LEGACY EVIDENCE%')
  )
BEGIN
  SELECT RAISE(ABORT, 'passed acceptance criterion requires retained governed evidence');
END;
--> statement-breakpoint

CREATE TRIGGER `acceptance_signoff_retain_passed_evidence_update`
BEFORE UPDATE OF `criterion_id`, `decision`, `evidence_document_id` ON `acceptance_signoff`
WHEN EXISTS (
    SELECT 1 FROM `acceptance_criterion` c
    WHERE c.`id` = OLD.`criterion_id`
      AND c.`status` = 'passed'
      AND length(trim(coalesce(c.`evidence_reference`, ''))) = 0
  )
  AND OLD.`decision` IN ('accepted', 'waived')
  AND EXISTS (
    SELECT 1 FROM `evidence_document` old_document
    WHERE old_document.`id`=OLD.`evidence_document_id`
      AND NOT (old_document.`content_type`='application/octet-stream' AND old_document.`description` LIKE '[QUARANTINED LEGACY EVIDENCE%')
  )
  AND NOT (
    NEW.`criterion_id` = OLD.`criterion_id`
    AND NEW.`decision` IN ('accepted', 'waived')
    AND NEW.`evidence_document_id` IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM `evidence_document` new_document
      WHERE new_document.`id`=NEW.`evidence_document_id`
        AND NOT (new_document.`content_type`='application/octet-stream' AND new_document.`description` LIKE '[QUARANTINED LEGACY EVIDENCE%')
    )
  )
  AND NOT EXISTS (
    SELECT 1 FROM `acceptance_signoff` s
    JOIN `evidence_document` d ON d.`id`=s.`evidence_document_id`
    WHERE s.`criterion_id` = OLD.`criterion_id`
      AND s.`id` <> OLD.`id`
      AND s.`decision` IN ('accepted', 'waived')
      AND NOT (d.`content_type`='application/octet-stream' AND d.`description` LIKE '[QUARANTINED LEGACY EVIDENCE%')
  )
BEGIN
  SELECT RAISE(ABORT, 'cannot remove the last governed evidence sign-off from a passed criterion');
END;
--> statement-breakpoint

CREATE TRIGGER `acceptance_signoff_evidence_exists_insert`
BEFORE INSERT ON `acceptance_signoff`
WHEN NEW.`evidence_document_id` IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM `evidence_document` d WHERE d.`id` = NEW.`evidence_document_id`)
BEGIN
  SELECT RAISE(ABORT, 'acceptance sign-off evidence document does not exist');
END;
--> statement-breakpoint

CREATE TRIGGER `acceptance_signoff_evidence_exists_update`
BEFORE UPDATE OF `criterion_id`, `decision`, `evidence_document_id` ON `acceptance_signoff`
WHEN NEW.`evidence_document_id` IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM `evidence_document` d WHERE d.`id` = NEW.`evidence_document_id`)
BEGIN
  SELECT RAISE(ABORT, 'acceptance sign-off evidence document does not exist');
END;
--> statement-breakpoint

CREATE TRIGGER `acceptance_signoff_retain_passed_evidence_delete`
BEFORE DELETE ON `acceptance_signoff`
WHEN EXISTS (
    SELECT 1 FROM `acceptance_criterion` c
    WHERE c.`id` = OLD.`criterion_id`
      AND c.`status` = 'passed'
      AND length(trim(coalesce(c.`evidence_reference`, ''))) = 0
  )
  AND OLD.`decision` IN ('accepted', 'waived')
  AND EXISTS (
    SELECT 1 FROM `evidence_document` old_document
    WHERE old_document.`id`=OLD.`evidence_document_id`
      AND NOT (old_document.`content_type`='application/octet-stream' AND old_document.`description` LIKE '[QUARANTINED LEGACY EVIDENCE%')
  )
  AND NOT EXISTS (
    SELECT 1 FROM `acceptance_signoff` s
    JOIN `evidence_document` d ON d.`id`=s.`evidence_document_id`
    WHERE s.`criterion_id` = OLD.`criterion_id`
      AND s.`id` <> OLD.`id`
      AND s.`decision` IN ('accepted', 'waived')
      AND NOT (d.`content_type`='application/octet-stream' AND d.`description` LIKE '[QUARANTINED LEGACY EVIDENCE%')
  )
BEGIN
  SELECT RAISE(ABORT, 'cannot delete the last governed evidence sign-off from a passed criterion');
END;
--> statement-breakpoint

CREATE TRIGGER `evidence_document_retain_passed_signoff_delete`
BEFORE DELETE ON `evidence_document`
WHEN EXISTS (
    SELECT 1
    FROM `acceptance_signoff` s
    JOIN `acceptance_criterion` c ON c.`id` = s.`criterion_id`
    WHERE s.`evidence_document_id` = OLD.`id`
      AND s.`decision` IN ('accepted', 'waived')
      AND c.`status` = 'passed'
      AND length(trim(coalesce(c.`evidence_reference`, ''))) = 0
      AND NOT (OLD.`content_type`='application/octet-stream' AND OLD.`description` LIKE '[QUARANTINED LEGACY EVIDENCE%')
      AND NOT EXISTS (
        SELECT 1 FROM `acceptance_signoff` alternative
        JOIN `evidence_document` d ON d.`id` = alternative.`evidence_document_id`
        WHERE alternative.`criterion_id` = c.`id`
          AND alternative.`id` <> s.`id`
          AND alternative.`decision` IN ('accepted', 'waived')
          AND alternative.`evidence_document_id` <> OLD.`id`
          AND NOT (d.`content_type`='application/octet-stream' AND d.`description` LIKE '[QUARANTINED LEGACY EVIDENCE%')
      )
  )
BEGIN
  SELECT RAISE(ABORT, 'cannot delete evidence supporting a passed acceptance criterion');
END;
--> statement-breakpoint

-- acceptance_signoff predates its governed document reference, so the column
-- could not gain a foreign key without rebuilding a large dependent graph.
-- This serial trigger supplies equivalent RESTRICT behavior and closes the
-- validate/delete race for every sign-off, not only already-passed criteria.
CREATE TRIGGER `evidence_document_referenced_signoff_delete`
BEFORE DELETE ON `evidence_document`
WHEN EXISTS (SELECT 1 FROM `acceptance_signoff` s WHERE s.`evidence_document_id` = OLD.`id`)
BEGIN
  SELECT RAISE(ABORT, 'cannot delete evidence referenced by an acceptance sign-off');
END;
