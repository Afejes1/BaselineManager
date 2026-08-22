-- Resource is the Platform in the A2O Technical Baseline exchange.  Tier is
-- the reported descriptor of that Platform and host is the deployment node
-- beneath it.  Backfill source-derived Platform records without replacing a
-- Government-assessed or confirmed Platform assignment.
WITH resource_occurrences AS (
  SELECT
    bo.id AS baseline_occurrence_id,
    bo.program_id,
    bo.release_id,
    resource.id AS resource_id,
    resource.name AS resource_name,
    resource.normalized_name AS resource_normalized_name,
    COALESCE(tier.name, 'Unassigned') AS tier_name
  FROM baseline_occurrence bo
  JOIN configuration_node host ON host.id=bo.configuration_node_id
  JOIN configuration_node resource ON resource.id=CASE WHEN host.node_type='resource' THEN host.id ELSE host.parent_id END
    AND resource.node_type='resource'
  LEFT JOIN configuration_node tier ON tier.id=resource.parent_id AND tier.node_type='tier'
  WHERE bo.program_id='program-jsf' AND bo.workspace_id='workspace-jsf-current' AND bo.lifecycle_status='active'
)
INSERT OR IGNORE INTO platform (
  id,program_id,parent_id,configuration_node_id,platform_type,code,normalized_code,
  name,normalized_name,status,description,installation_location,country_code,
  created_by_user_id,created_at,updated_at
)
SELECT
  'a2o-resource-platform-' || resource_id,
  program_id,
  NULL,
  resource_id,
  'other',
  'A2O-RESOURCE-' || resource_id,
  lower('a2o-resource-' || resource_id),
  resource_name,
  resource_normalized_name,
  'active',
  'A2O Resource Platform · Tier descriptor: ' || tier_name,
  NULL,
  NULL,
  NULL,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM resource_occurrences
GROUP BY resource_id;
--> statement-breakpoint
WITH resource_occurrences AS (
  SELECT
    bo.id AS baseline_occurrence_id,
    bo.program_id,
    bo.release_id,
    resource.id AS resource_id,
    resource.name AS resource_name,
    COALESCE(tier.name, 'Unassigned') AS tier_name
  FROM baseline_occurrence bo
  JOIN configuration_node host ON host.id=bo.configuration_node_id
  JOIN configuration_node resource ON resource.id=CASE WHEN host.node_type='resource' THEN host.id ELSE host.parent_id END
    AND resource.node_type='resource'
  LEFT JOIN configuration_node tier ON tier.id=resource.parent_id AND tier.node_type='tier'
  WHERE bo.program_id='program-jsf' AND bo.workspace_id='workspace-jsf-current' AND bo.lifecycle_status='active'
)
INSERT OR IGNORE INTO platform_baseline_assignment (
  id,program_id,platform_id,baseline_occurrence_id,release_id,assignment_role,
  confidence,review_status,source_reference,source_as_of,reviewed_by_user_id,
  reviewed_at,created_by_user_id,created_at,updated_at
)
SELECT
  'a2o-resource-assignment-' || baseline_occurrence_id,
  occurrence.program_id,
  platform.id,
  occurrence.baseline_occurrence_id,
  occurrence.release_id,
  'primary',
  'reported',
  'not_reviewed',
  'A2O Tech Stack · Tier: ' || occurrence.tier_name || ' · Resource Platform: ' || occurrence.resource_name,
  NULL,
  NULL,
  NULL,
  NULL,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM resource_occurrences occurrence
JOIN platform ON platform.configuration_node_id=occurrence.resource_id
  AND platform.program_id=occurrence.program_id;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `platform_a2o_resource_ix`
ON `platform` (`program_id`,`configuration_node_id`,`status`);
