import { sql } from "drizzle-orm";
import { check, index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

const timestamps = { createdAt: text("created_at").notNull(), updatedAt: text("updated_at").notNull() };

export const programs = sqliteTable("program", {
  id: text("id").primaryKey(), name: text("name").notNull(), description: text("description"), timezone: text("timezone").notNull().default("UTC"), ...timestamps,
}, (t) => [uniqueIndex("program_name_uq").on(t.name)]);

export const sourcePackages = sqliteTable("source_package", {
  id: text("id").primaryKey(), programId: text("program_id").notNull().references(() => programs.id), sourceSystem: text("source_system"), fileName: text("file_name").notNull(), sheetName: text("sheet_name"), contentHash: text("content_hash").notNull(), sourceAsOf: text("source_as_of"), receivedAt: text("received_at").notNull(), status: text("status").notNull().default("received"), rowCount: integer("row_count").notNull().default(0), acceptedCount: integer("accepted_count").notNull().default(0), exceptionCount: integer("exception_count").notNull().default(0), ...timestamps,
}, (t) => [uniqueIndex("source_package_hash_uq").on(t.programId, t.contentHash), index("source_package_status_ix").on(t.programId, t.status, t.receivedAt)]);

export const releases = sqliteTable("release", {
  id: text("id").primaryKey(), programId: text("program_id").notNull().references(() => programs.id), code: text("code"), normalizedCode: text("normalized_code"), name: text("name").notNull(), normalizedName: text("normalized_name").notNull(), status: text("status").notNull().default("planned"), description: text("description"), owner: text("owner"), predecessorReleaseId: text("predecessor_release_id"), targetDate: text("target_date"), actualDate: text("actual_date"), sourceReference: text("source_reference"), sourceAsOf: text("source_as_of"), ...timestamps,
}, (t) => [check("release_status", sql`${t.status} IN ('proposed','planned','in_development','integration','test','fielding','operational','superseded','cancelled')`), uniqueIndex("release_code_uq").on(t.programId, t.normalizedCode), uniqueIndex("release_name_uq").on(t.programId, t.normalizedName), index("release_status_ix").on(t.programId, t.status), index("release_predecessor_ix").on(t.programId, t.predecessorReleaseId)]);

export const releaseMilestones = sqliteTable("release_milestone", {
  id: text("id").primaryKey(),
  programId: text("program_id").notNull().references(() => programs.id),
  releaseId: text("release_id").notNull().references(() => releases.id),
  milestoneType: text("milestone_type").notNull(),
  title: text("title").notNull(),
  status: text("status").notNull().default("planned"),
  plannedDate: text("planned_date"),
  forecastDate: text("forecast_date"),
  actualDate: text("actual_date"),
  owner: text("owner"),
  sourceReference: text("source_reference"),
  sourceAsOf: text("source_as_of"),
  notes: text("notes"),
  ...timestamps,
}, (t) => [
  check("release_milestone_status", sql`${t.status} IN ('planned','at_risk','complete','cancelled')`),
  uniqueIndex("release_milestone_type_uq").on(t.releaseId, t.milestoneType, t.title),
  index("release_milestone_release_ix").on(t.releaseId, t.status, t.plannedDate),
]);

export const configurationBaselines = sqliteTable("configuration_baseline", {
  // `status` is retained for migration compatibility. New code uses the
  // explicit approval fields below, rather than overloading Release lifecycle.
  id: text("id").primaryKey(), programId: text("program_id").notNull().references(() => programs.id), releaseId: text("release_id").notNull().references(() => releases.id), name: text("name").notNull(), normalizedName: text("normalized_name").notNull(), maturity: text("maturity").notNull().default("reported"), asOf: text("as_of").notNull(), status: text("status").notNull().default("working"), revisionNumber: integer("revision_number").notNull().default(1), approvalStatus: text("approval_status").notNull().default("working"), approvedAt: text("approved_at"), approvedByUserId: text("approved_by_user_id").references(() => appUsers.id), lockedAt: text("locked_at"), supersededAt: text("superseded_at"), supersededByBaselineId: text("superseded_by_baseline_id"), description: text("description"), parentBaselineId: text("parent_baseline_id"), ...timestamps,
}, (t) => [
  check("baseline_approval_status", sql`${t.approvalStatus} IN ('working','under_review','approved','superseded')`),
  uniqueIndex("baseline_release_name_asof_uq").on(t.releaseId, t.normalizedName, t.asOf),
  index("baseline_release_ix").on(t.programId, t.releaseId, t.status),
  index("baseline_release_approval_ix").on(t.programId, t.releaseId, t.approvalStatus, t.asOf),
]);

export const organizations = sqliteTable("organization", {
  id: text("id").primaryKey(), programId: text("program_id").notNull().references(() => programs.id), name: text("name").notNull(), normalizedName: text("normalized_name").notNull(), organizationType: text("organization_type"), description: text("description"), lifecycleStatus: text("lifecycle_status").notNull().default("active"), sourceReference: text("source_reference"), sourceAsOf: text("source_as_of"), ...timestamps,
}, (t) => [check("organization_lifecycle_status", sql`${t.lifecycleStatus} IN ('active','inactive','retired')`), uniqueIndex("organization_name_uq").on(t.programId, t.normalizedName), index("organization_status_ix").on(t.programId, t.lifecycleStatus)]);

export const configurationNodes = sqliteTable("configuration_node", {
  id: text("id").primaryKey(), programId: text("program_id").notNull().references(() => programs.id), parentId: text("parent_id"), nodeType: text("node_type").notNull(), code: text("code"), normalizedCode: text("normalized_code"), name: text("name").notNull(), normalizedName: text("normalized_name").notNull(), description: text("description"), ownerOrganizationId: text("owner_organization_id").references(() => organizations.id), lifecycleStatus: text("lifecycle_status").notNull().default("active"), sourceReference: text("source_reference"), sourceAsOf: text("source_as_of"), ...timestamps,
}, (t) => [check("configuration_node_not_self", sql`${t.parentId} IS NULL OR ${t.parentId} <> ${t.id}`), check("configuration_node_lifecycle_status", sql`${t.lifecycleStatus} IN ('active','retired')`), uniqueIndex("configuration_node_code_uq").on(t.programId, t.normalizedCode), uniqueIndex("configuration_node_position_uq").on(t.programId, t.parentId, t.nodeType, t.normalizedName), index("configuration_node_parent_ix").on(t.programId, t.parentId, t.nodeType), index("configuration_node_status_ix").on(t.programId, t.lifecycleStatus)]);

export const products = sqliteTable("product", {
  id: text("id").primaryKey(), programId: text("program_id").notNull().references(() => programs.id), canonicalName: text("canonical_name").notNull(), normalizedName: text("normalized_name").notNull(), shortName: text("short_name"), productType: text("product_type"), softwareClassification: text("software_classification"), ownerOrganizationId: text("owner_organization_id").references(() => organizations.id), description: text("description"), lifecycleStatus: text("lifecycle_status").notNull().default("active"), sourceReference: text("source_reference"), sourceAsOf: text("source_as_of"), ...timestamps,
}, (t) => [check("product_lifecycle_status", sql`${t.lifecycleStatus} IN ('active','retired')`), uniqueIndex("product_name_uq").on(t.programId, t.normalizedName), index("product_search_ix").on(t.programId, t.shortName), index("product_status_ix").on(t.programId, t.lifecycleStatus)]);

// Canonical aliases are steward decisions.  They are deliberately separate
// from source rows so an imported spelling remains visible while future
// materialization and analyst searches resolve it to the governed identity.
export const canonicalAliases = sqliteTable("canonical_alias", {
  id: text("id").primaryKey(),
  programId: text("program_id").notNull().references(() => programs.id),
  entityKind: text("entity_kind").notNull(),
  entityId: text("entity_id").notNull(),
  alias: text("alias").notNull(),
  normalizedAlias: text("normalized_alias").notNull(),
  namespace: text("namespace").notNull().default("name"),
  sourceReference: text("source_reference"),
  status: text("status").notNull().default("accepted"),
  reviewedByUserId: text("reviewed_by_user_id").references(() => appUsers.id),
  reviewedAt: text("reviewed_at"),
  ...timestamps,
}, (t) => [
  check("canonical_alias_kind", sql`${t.entityKind} IN ('product','organization','configuration_node')`),
  check("canonical_alias_status", sql`${t.status} IN ('proposed','accepted','rejected','retired')`),
  uniqueIndex("canonical_alias_name_uq").on(t.programId, t.entityKind, t.namespace, t.normalizedAlias),
  index("canonical_alias_entity_ix").on(t.entityKind, t.entityId, t.status),
]);

export const canonicalMergeEvents = sqliteTable("canonical_merge_event", {
  id: text("id").primaryKey(),
  programId: text("program_id").notNull().references(() => programs.id),
  entityKind: text("entity_kind").notNull(),
  sourceEntityId: text("source_entity_id").notNull(),
  targetEntityId: text("target_entity_id").notNull(),
  rationale: text("rationale").notNull(),
  sourceReference: text("source_reference"),
  mergedByUserId: text("merged_by_user_id").references(() => appUsers.id),
  mergedAt: text("merged_at").notNull(),
}, (t) => [
  check("canonical_merge_kind", sql`${t.entityKind} IN ('product','organization','configuration_node')`),
  check("canonical_merge_not_self", sql`${t.sourceEntityId} <> ${t.targetEntityId}`),
  uniqueIndex("canonical_merge_source_uq").on(t.programId, t.entityKind, t.sourceEntityId),
  index("canonical_merge_target_ix").on(t.entityKind, t.targetEntityId, t.mergedAt),
]);

export const productSuppliers = sqliteTable("product_supplier", {
  productId: text("product_id").notNull().references(() => products.id), organizationId: text("organization_id").notNull().references(() => organizations.id), supplierRole: text("supplier_role").notNull(), ...timestamps,
}, (t) => [uniqueIndex("product_supplier_uq").on(t.productId, t.organizationId, t.supplierRole)]);

export const capabilities = sqliteTable("capability", {
  id: text("id").primaryKey(), programId: text("program_id").notNull().references(() => programs.id), parentId: text("parent_id"), code: text("code"), name: text("name").notNull(), normalizedName: text("normalized_name").notNull(), description: text("description"), lifecycleStatus: text("lifecycle_status").notNull().default("active"), sourceReference: text("source_reference"), sourceAsOf: text("source_as_of"), ...timestamps,
}, (t) => [check("capability_lifecycle_status", sql`${t.lifecycleStatus} IN ('draft','active','retired')`), uniqueIndex("capability_name_uq").on(t.programId, t.normalizedName), index("capability_parent_ix").on(t.programId, t.parentId), index("capability_status_ix").on(t.programId, t.lifecycleStatus)]);

export const productCapabilities = sqliteTable("product_capability", {
  productId: text("product_id").notNull().references(() => products.id), capabilityId: text("capability_id").notNull().references(() => capabilities.id), relationship: text("relationship").notNull().default("satisfies"), rationale: text("rationale"), ...timestamps,
}, (t) => [uniqueIndex("product_capability_uq").on(t.productId, t.capabilityId, t.relationship)]);

export const deployments = sqliteTable("deployment", {
  id: text("id").primaryKey(), programId: text("program_id").notNull().references(() => programs.id), productId: text("product_id").notNull().references(() => products.id), configurationNodeId: text("configuration_node_id").notNull().references(() => configurationNodes.id), environment: text("environment").notNull().default("unknown"), site: text("site").notNull().default("unknown"), deploymentRole: text("deployment_role"), ...timestamps,
}, (t) => [uniqueIndex("deployment_position_uq").on(t.programId, t.productId, t.configurationNodeId, t.environment, t.site), index("deployment_node_ix").on(t.configurationNodeId, t.productId)]);

export const baselineNodeStates = sqliteTable("baseline_node_state", {
  id: text("id").primaryKey(), programId: text("program_id").notNull().references(() => programs.id), baselineId: text("baseline_id").notNull().references(() => configurationBaselines.id), configurationNodeId: text("configuration_node_id").notNull().references(() => configurationNodes.id), sourceRowId: text("source_row_id"), storageType: text("storage_type"), storageGb: real("storage_gb"), cpuCores: real("cpu_cores"), ramGb: real("ram_gb"), stateNotes: text("state_notes"), ...timestamps,
}, (t) => [uniqueIndex("baseline_node_state_uq").on(t.baselineId, t.configurationNodeId), index("baseline_node_state_node_ix").on(t.baselineId, t.configurationNodeId)]);

export const baselineDeploymentStates = sqliteTable("baseline_deployment_state", {
  // `reportedVersion` is retained for imported legacy values. Application and
  // runtime version are distinct governed baseline state from this migration.
  id: text("id").primaryKey(), programId: text("program_id").notNull().references(() => programs.id), baselineId: text("baseline_id").notNull().references(() => configurationBaselines.id), deploymentId: text("deployment_id").notNull().references(() => deployments.id), sourceRowId: text("source_row_id"), reportedVersion: text("reported_version"), applicationVersion: text("application_version"), runtimeVersion: text("runtime_version"), presence: text("presence").notNull().default("unknown"), status: text("status").notNull().default("reported"), installationType: text("installation_type"), containerized: text("containerized"), containerTechnology: text("container_technology"), containerType: text("container_type"), language: text("language"), notes: text("notes"), ...timestamps,
}, (t) => [check("baseline_deployment_presence", sql`${t.presence} IN ('present','absent','unknown')`), uniqueIndex("baseline_deployment_state_uq").on(t.baselineId, t.deploymentId), index("baseline_deployment_state_baseline_ix").on(t.baselineId, t.status, t.presence)]);

// Every original cell is kept as text (including the five notes fields) and the
// JSON payload preserves types/empty-cell distinctions from the reader.
export const sourceRows24 = sqliteTable("source_row_24", {
  id: text("id").primaryKey(), sourcePackageId: text("source_package_id").notNull().references(() => sourcePackages.id), sourceKey: text("source_key"), rowNumber: integer("row_number").notNull(), rowHash: text("row_hash").notNull(), rawPayload: text("raw_payload").notNull(),
  colReleaseName: text("release_name"), colTier: text("tier"), colResource: text("resource"), colTechStackType: text("tech_stack_type"), colShortName: text("short_name"), colHwHost: text("hw_host"), colHwStorageType: text("hw_storage_type"), colHwStorageGb: text("hw_storage_gb"), colHwCpuCores: text("hw_cpu_cores"), colHwRamGb: text("hw_ram_gb"), colSwLanguage: text("sw_language"), colSoftwareType: text("software_type"), colOem: text("oem"), colContainerized: text("containerized"), colContainerTechnology: text("container_technology"), colContainerType: text("container_type"), colLongName: text("long_name"), colNotes: text("notes"), colCapabilityNotes: text("capability_notes"), colNotes1: text("notes_1"), colNotes2: text("notes_2"), colNotes3: text("notes_3"), colNotes4: text("notes_4"),
  releaseId: text("release_id").references(() => releases.id), baselineId: text("baseline_id").references(() => configurationBaselines.id), configurationNodeId: text("configuration_node_id").references(() => configurationNodes.id), productId: text("product_id").references(() => products.id), deploymentId: text("deployment_id").references(() => deployments.id), materializationStatus: text("materialization_status").notNull().default("unreviewed"), ...timestamps,
}, (t) => [index("source_row_package_key_ix").on(t.sourcePackageId, t.sourceKey), uniqueIndex("source_row_package_number_uq").on(t.sourcePackageId, t.rowNumber), index("source_row_review_ix").on(t.sourcePackageId, t.materializationStatus, t.rowNumber), index("source_row_release_ix").on(t.releaseId, t.baselineId)]);

// A workspace chooses the current, editable Government projection without
// changing the immutable source package or source-row payload.
export const baselineWorkspaces = sqliteTable("baseline_workspace", {
  id: text("id").primaryKey(),
  programId: text("program_id").notNull().references(() => programs.id),
  label: text("label").notNull(),
  activeImportPackageId: text("active_import_package_id").references(() => sourcePackages.id),
  ...timestamps,
}, (t) => [uniqueIndex("baseline_workspace_program_label_uq").on(t.programId, t.label)]);

// This is the authoritative Baseline Record. A2O source rows may be linked to
// it, but source-row provenance is optional so analyst-created records are not
// forced to masquerade as workbook imports. New canonical IDs are UUID text
// values; legacy deterministic text IDs continue to be valid foreign keys.
export const baselineOccurrences = sqliteTable("baseline_occurrence", {
  id: text("id").primaryKey(),
  programId: text("program_id").notNull().references(() => programs.id),
  workspaceId: text("workspace_id").notNull().references(() => baselineWorkspaces.id),
  sourceRowId: text("source_row_id").references(() => sourceRows24.id),
  releaseId: text("release_id").references(() => releases.id),
  baselineId: text("baseline_id").references(() => configurationBaselines.id),
  configurationNodeId: text("configuration_node_id").references(() => configurationNodes.id),
  productId: text("product_id").references(() => products.id),
  deploymentId: text("deployment_id").references(() => deployments.id),
  projectionPayload: text("projection_payload").notNull(),
  materializationStatus: text("materialization_status").notNull().default("reported"),
  lifecycleStatus: text("lifecycle_status").notNull().default("active"),
  lifecycleReason: text("lifecycle_reason"),
  voidedAt: text("voided_at"),
  voidedByUserId: text("voided_by_user_id"),
  revision: integer("revision").notNull().default(0),
  ...timestamps,
}, (t) => [
  uniqueIndex("baseline_occurrence_workspace_source_uq").on(t.workspaceId, t.sourceRowId),
  index("baseline_occurrence_workspace_release_ix").on(t.workspaceId, t.releaseId, t.baselineId),
  index("baseline_occurrence_workspace_product_ix").on(t.workspaceId, t.productId),
  index("baseline_occurrence_workspace_lifecycle_ix").on(t.workspaceId, t.lifecycleStatus, t.releaseId),
  index("baseline_occurrence_workspace_deployment_ix").on(t.workspaceId, t.deploymentId, t.lifecycleStatus),
]);

// These fields are A2O exchange-only values which do not have a governed
// normalized owner. They retain the exact 24-column export without making the
// exchange projection the source of truth.
export const baselineRecordExtensions = sqliteTable("baseline_record_extension", {
  baselineOccurrenceId: text("baseline_occurrence_id").primaryKey().references(() => baselineOccurrences.id),
  sourceKey: text("source_key"),
  notes: text("notes"),
  capabilityNotes: text("capability_notes"),
  notes1: text("notes_1"),
  notes2: text("notes_2"),
  notes3: text("notes_3"),
  notes4: text("notes_4"),
  ...timestamps,
}, (t) => [index("baseline_record_extension_source_key_ix").on(t.sourceKey)]);

// Source rows are immutable import evidence. A record can retain more than
// one row over time, while the nullable convenience pointer above represents
// its current imported row when one exists.
export const baselineRecordSources = sqliteTable("baseline_record_source", {
  id: text("id").primaryKey(),
  baselineOccurrenceId: text("baseline_occurrence_id").notNull().references(() => baselineOccurrences.id),
  sourceRowId: text("source_row_id").notNull().references(() => sourceRows24.id),
  relationship: text("relationship").notNull().default("imported"),
  disposition: text("disposition").notNull().default("current"),
  ...timestamps,
}, (t) => [
  check("baseline_record_source_relationship", sql`${t.relationship} IN ('imported','reconciled','reference')`),
  check("baseline_record_source_disposition", sql`${t.disposition} IN ('current','superseded','rejected')`),
  uniqueIndex("baseline_record_source_record_row_uq").on(t.baselineOccurrenceId, t.sourceRowId),
  index("baseline_record_source_row_ix").on(t.sourceRowId, t.disposition),
  index("baseline_record_source_record_ix").on(t.baselineOccurrenceId, t.disposition),
]);

// Manual review is a decision about the canonical Baseline Record, not a
// transient source row. The older source-row review tables remain readable
// during the data transition only.
export const baselineRecordReviews = sqliteTable("baseline_record_review", {
  id: text("id").primaryKey(),
  programId: text("program_id").notNull().references(() => programs.id),
  baselineOccurrenceId: text("baseline_occurrence_id").notNull().references(() => baselineOccurrences.id),
  status: text("status").notNull().default("not_reviewed"),
  reviewedAt: text("reviewed_at"),
  reviewedByUserId: text("reviewed_by_user_id").references(() => appUsers.id),
  note: text("note"),
  ...timestamps,
}, (t) => [
  check("baseline_record_review_status", sql`${t.status} IN ('not_reviewed','reviewed','follow_up')`),
  uniqueIndex("baseline_record_review_record_uq").on(t.baselineOccurrenceId),
  index("baseline_record_review_status_ix").on(t.programId, t.status, t.reviewedAt),
]);

// Steward review is governed application metadata. It is intentionally kept
// outside source_row_24 so the retained workbook projection stays unchanged.
export const sourceOccurrenceReviews = sqliteTable("source_occurrence_review", {
  id: text("id").primaryKey(),
  programId: text("program_id").notNull().references(() => programs.id),
  releaseName: text("release_name").notNull(),
  sourceKey: text("source_key").notNull(),
  status: text("status").notNull().default("not_reviewed"),
  reviewedAt: text("reviewed_at"),
  note: text("note"),
  ...timestamps,
}, (t) => [
  check("source_occurrence_review_status", sql`${t.status} IN ('not_reviewed','reviewed','follow_up')`),
  uniqueIndex("source_occurrence_review_identity_uq").on(t.programId, t.releaseName, t.sourceKey),
  index("source_occurrence_review_status_ix").on(t.programId, t.status, t.reviewedAt),
]);

// Review identity is the immutable source row, not a value from the workbook.
// The legacy table remains readable for historic records, while new reviews use
// this source-row keyed table.
export const sourceOccurrenceReviewsV2 = sqliteTable("source_occurrence_review_v2", {
  id: text("id").primaryKey(),
  programId: text("program_id").notNull().references(() => programs.id),
  sourceRowId: text("source_row_id").notNull().references(() => sourceRows24.id),
  status: text("status").notNull().default("not_reviewed"),
  reviewedAt: text("reviewed_at"),
  note: text("note"),
  ...timestamps,
}, (t) => [
  check("source_occurrence_review_v2_status", sql`${t.status} IN ('not_reviewed','reviewed','follow_up')`),
  uniqueIndex("source_occurrence_review_v2_source_uq").on(t.sourceRowId),
  index("source_occurrence_review_v2_status_ix").on(t.programId, t.status, t.reviewedAt),
]);

// Governance records are deliberately separate from the spreadsheet contract.
// They give the Government a durable way to steer the working baseline without
// promoting meeting notes, MCPs, or decisions into source cells.
export const appUsers = sqliteTable("app_user", {
  id: text("id").primaryKey(),
  email: text("email"),
  displayName: text("display_name").notNull(),
  ...timestamps,
}, (t) => [index("app_user_email_ix").on(t.email)]);

export const programRoleAssignments = sqliteTable("program_role_assignment", {
  id: text("id").primaryKey(),
  programId: text("program_id").notNull().references(() => programs.id),
  userId: text("user_id").notNull().references(() => appUsers.id),
  role: text("role").notNull().default("editor"),
  assignedByUserId: text("assigned_by_user_id"),
  ...timestamps,
}, (t) => [
  check("program_role_assignment_role", sql`${t.role} IN ('steward','editor','viewer')`),
  uniqueIndex("program_role_assignment_program_user_uq").on(t.programId, t.userId),
  index("program_role_assignment_program_role_ix").on(t.programId, t.role),
]);

// The workbook does not report installation location, rack/blade identity, VM
// identity, or application version. These are governed extension facts, kept
// separately from the 24-column projection and explicitly scoped to a release.
// A host profile applies to every deployment on that host in the release.
export const managedHostProfiles = sqliteTable("managed_host_profile", {
  id: text("id").primaryKey(),
  programId: text("program_id").notNull().references(() => programs.id),
  releaseId: text("release_id").notNull().references(() => releases.id),
  configurationNodeId: text("configuration_node_id").notNull().references(() => configurationNodes.id),
  installationLocation: text("installation_location"),
  facilityOrEnclave: text("facility_or_enclave"),
  equipmentRack: text("equipment_rack"),
  hardwareBlade: text("hardware_blade"),
  virtualizationPlatform: text("virtualization_platform"),
  sourceReference: text("source_reference"),
  notes: text("notes"),
  createdByUserId: text("created_by_user_id").references(() => appUsers.id),
  ...timestamps,
}, (t) => [
  uniqueIndex("managed_host_profile_release_node_uq").on(t.releaseId, t.configurationNodeId),
  index("managed_host_profile_release_ix").on(t.programId, t.releaseId),
]);

// A deployment profile is specific to one retained source occurrence. It adds
// Government-managed identifying/version detail without masquerading as source
// spreadsheet data or forcing an assumed relationship on sibling deployments.
export const managedDeploymentProfiles = sqliteTable("managed_deployment_profile", {
  id: text("id").primaryKey(),
  programId: text("program_id").notNull().references(() => programs.id),
  baselineOccurrenceId: text("baseline_occurrence_id").notNull().references(() => baselineOccurrences.id),
  releaseId: text("release_id").notNull().references(() => releases.id),
  configurationNodeId: text("configuration_node_id").references(() => configurationNodes.id),
  productId: text("product_id").references(() => products.id),
  virtualMachine: text("virtual_machine"),
  containerInstance: text("container_instance"),
  applicationVersion: text("application_version"),
  installationIdentifier: text("installation_identifier"),
  deploymentRole: text("deployment_role"),
  sourceReference: text("source_reference"),
  notes: text("notes"),
  createdByUserId: text("created_by_user_id").references(() => appUsers.id),
  ...timestamps,
}, (t) => [
  uniqueIndex("managed_deployment_profile_occurrence_uq").on(t.baselineOccurrenceId),
  index("managed_deployment_profile_release_product_ix").on(t.programId, t.releaseId, t.productId),
]);

// Platform is the Government's stable installation/fielding hierarchy. ALOU,
// OCK, OBK, and PMA are governed types, while configuration_node remains the
// lower-level physical/logical placement spine used by source materialization.
export const platforms = sqliteTable("platform", {
  id: text("id").primaryKey(),
  programId: text("program_id").notNull().references(() => programs.id),
  parentId: text("parent_id"),
  configurationNodeId: text("configuration_node_id").references(() => configurationNodes.id),
  platformType: text("platform_type").notNull(),
  code: text("code").notNull(),
  normalizedCode: text("normalized_code").notNull(),
  name: text("name").notNull(),
  normalizedName: text("normalized_name").notNull(),
  status: text("status").notNull().default("active"),
  description: text("description"),
  installationLocation: text("installation_location"),
  countryCode: text("country_code"),
  createdByUserId: text("created_by_user_id").references(() => appUsers.id),
  ...timestamps,
}, (t) => [
  check("platform_type", sql`${t.platformType} IN ('alou','ock','obk','pma','other')`),
  check("platform_status", sql`${t.status} IN ('active','planned','retired')`),
  check("platform_not_self", sql`${t.parentId} IS NULL OR ${t.parentId} <> ${t.id}`),
  uniqueIndex("platform_code_uq").on(t.programId, t.normalizedCode),
  uniqueIndex("platform_configuration_node_uq").on(t.configurationNodeId),
  index("platform_parent_ix").on(t.programId, t.parentId, t.platformType),
]);

export const platformOrganizations = sqliteTable("platform_organization", {
  id: text("id").primaryKey(),
  platformId: text("platform_id").notNull().references(() => platforms.id),
  organizationId: text("organization_id").notNull().references(() => organizations.id),
  relationshipType: text("relationship_type").notNull(),
  sourceReference: text("source_reference"),
  ...timestamps,
}, (t) => [
  check("platform_organization_relationship", sql`${t.relationshipType} IN ('owner','operator','integrator','support','supplier')`),
  uniqueIndex("platform_organization_uq").on(t.platformId, t.organizationId, t.relationshipType),
  index("platform_organization_org_ix").on(t.organizationId, t.relationshipType),
]);

// A Platform is stable.  Its baseline assignments are release-specific facts.
// Keeping this relationship explicit avoids treating a mutable source host as
// the identity of an ALOU/OCK/OBK/PMA installation.
export const platformBaselineAssignments = sqliteTable("platform_baseline_assignment", {
  id: text("id").primaryKey(),
  programId: text("program_id").notNull().references(() => programs.id),
  platformId: text("platform_id").notNull().references(() => platforms.id),
  baselineOccurrenceId: text("baseline_occurrence_id").notNull().references(() => baselineOccurrences.id),
  releaseId: text("release_id").notNull().references(() => releases.id),
  assignmentRole: text("assignment_role").notNull().default("primary"),
  confidence: text("confidence").notNull().default("assessed"),
  reviewStatus: text("review_status").notNull().default("not_reviewed"),
  sourceReference: text("source_reference"),
  sourceAsOf: text("source_as_of"),
  reviewedByUserId: text("reviewed_by_user_id").references(() => appUsers.id),
  reviewedAt: text("reviewed_at"),
  createdByUserId: text("created_by_user_id").references(() => appUsers.id),
  ...timestamps,
}, (t) => [
  check("platform_assignment_role", sql`${t.assignmentRole} IN ('primary','supporting')`),
  check("platform_assignment_confidence", sql`${t.confidence} IN ('reported','assessed','confirmed')`),
  check("platform_assignment_review", sql`${t.reviewStatus} IN ('not_reviewed','reviewed','follow_up')`),
  uniqueIndex("platform_assignment_occurrence_role_uq").on(t.baselineOccurrenceId, t.assignmentRole),
  index("platform_assignment_platform_release_ix").on(t.platformId, t.releaseId, t.reviewStatus),
]);

// A release profile describes how a release is being used analytically. It is
// not an approval of the technical stack: funding/priority decisions belong to
// Change Requests. This merely distinguishes current evidence from a target.
export const releaseProfiles = sqliteTable("release_profile", {
  id: text("id").primaryKey(),
  programId: text("program_id").notNull().references(() => programs.id),
  releaseId: text("release_id").notNull().references(() => releases.id),
  stateRole: text("state_role").notNull().default("reported"),
  effectiveDate: text("effective_date"),
  description: text("description"),
  createdByUserId: text("created_by_user_id").references(() => appUsers.id),
  ...timestamps,
}, (t) => [
  check("release_profile_state_role", sql`${t.stateRole} IN ('historical','as_is','to_be','reported')`),
  uniqueIndex("release_profile_release_uq").on(t.releaseId),
  index("release_profile_role_ix").on(t.programId, t.stateRole, t.effectiveDate),
]);

// Change Requests are references to the external system of record. This app
// owns the Government decision analysis and technical impact links, not the
// incumbent workflow that creates and manages the request.
export const changeRequestTypes = sqliteTable("change_request_type", {
  id: text("id").primaryKey(),
  programId: text("program_id").notNull().references(() => programs.id),
  code: text("code").notNull(),
  normalizedCode: text("normalized_code").notNull(),
  label: text("label").notNull(),
  description: text("description"),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  ...timestamps,
}, (t) => [uniqueIndex("change_request_type_code_uq").on(t.programId, t.normalizedCode)]);

export const changeRequests = sqliteTable("change_request", {
  id: text("id").primaryKey(),
  programId: text("program_id").notNull().references(() => programs.id),
  typeId: text("type_id").notNull().references(() => changeRequestTypes.id),
  externalSystem: text("external_system"),
  externalIdentifier: text("external_identifier").notNull(),
  title: text("title").notNull(),
  externalStatus: text("external_status"),
  externalOwner: text("external_owner"),
  sourceLocator: text("source_locator"),
  sourceAsOf: text("source_as_of"),
  requestedReleaseId: text("requested_release_id").references(() => releases.id),
  governmentPriority: text("government_priority").notNull().default("unranked"),
  decisionStatus: text("decision_status").notNull().default("pending"),
  decisionAuthority: text("decision_authority"),
  decisionAt: text("decision_at"),
  decisionByUserId: text("decision_by_user_id").references(() => appUsers.id),
  decisionRationale: text("decision_rationale"),
  referenceStatus: text("reference_status").notNull().default("active"),
  lifecycleRationale: text("lifecycle_rationale"),
  summary: text("summary"),
  consequenceIfFunded: text("consequence_if_funded"),
  consequenceIfDeferred: text("consequence_if_deferred"),
  impactSummary: text("impact_summary"),
  knockOnEffects: text("knock_on_effects"),
  createdByUserId: text("created_by_user_id").references(() => appUsers.id),
  ...timestamps,
}, (t) => [
  check("change_request_priority", sql`${t.governmentPriority} IN ('unranked','low','medium','high','critical')`),
  check("change_request_decision", sql`${t.decisionStatus} IN ('pending','fund','defer','decline')`),
  check("change_request_reference_status", sql`${t.referenceStatus} IN ('active','closed','superseded')`),
  uniqueIndex("change_request_external_uq").on(t.programId, t.externalSystem, t.externalIdentifier),
  index("change_request_decision_ix").on(t.programId, t.decisionStatus, t.governmentPriority),
  index("change_request_release_ix").on(t.programId, t.requestedReleaseId),
]);

export const changeEffects = sqliteTable("change_effect", {
  id: text("id").primaryKey(),
  changeRequestId: text("change_request_id").notNull().references(() => changeRequests.id),
  subjectKind: text("subject_kind").notNull(),
  subjectId: text("subject_id").notNull(),
  action: text("action").notNull().default("modify"),
  aspect: text("aspect").notNull().default("configuration"),
  fromReleaseId: text("from_release_id").references(() => releases.id),
  toReleaseId: text("to_release_id").references(() => releases.id),
  currentValue: text("current_value"),
  targetValue: text("target_value"),
  consequence: text("consequence"),
  rationale: text("rationale"),
  confidence: text("confidence").notNull().default("reported"),
  sourceOccurrenceId: text("source_occurrence_id").references(() => baselineOccurrences.id),
  createdByUserId: text("created_by_user_id").references(() => appUsers.id),
  ...timestamps,
}, (t) => [
  check("change_effect_subject", sql`${t.subjectKind} IN ('product','platform','configuration_node','occurrence','release','organization')`),
  check("change_effect_action", sql`${t.action} IN ('add','remove','move','modify','assess')`),
  check("change_effect_confidence", sql`${t.confidence} IN ('reported','assessed','confirmed')`),
  index("change_effect_request_ix").on(t.changeRequestId, t.subjectKind),
  index("change_effect_subject_ix").on(t.subjectKind, t.subjectId),
]);

export const changeDependencies = sqliteTable("change_dependency", {
  id: text("id").primaryKey(),
  predecessorRequestId: text("predecessor_request_id").notNull().references(() => changeRequests.id),
  successorRequestId: text("successor_request_id").notNull().references(() => changeRequests.id),
  dependencyType: text("dependency_type").notNull(),
  rationale: text("rationale"),
  consequenceIfUnmet: text("consequence_if_unmet"),
  owner: text("owner"),
  confidence: text("confidence").notNull().default("reported"),
  sourceReference: text("source_reference"),
  sourceAsOf: text("source_as_of"),
  createdByUserId: text("created_by_user_id").references(() => appUsers.id),
  ...timestamps,
}, (t) => [
  check("change_dependency_not_self", sql`${t.predecessorRequestId} <> ${t.successorRequestId}`),
  check("change_dependency_type", sql`${t.dependencyType} IN ('requires','enables','blocks','conflicts','overlaps')`),
  check("change_dependency_confidence", sql`${t.confidence} IN ('reported','assessed','confirmed')`),
  uniqueIndex("change_dependency_uq").on(t.predecessorRequestId, t.successorRequestId, t.dependencyType),
  index("change_dependency_successor_ix").on(t.successorRequestId, t.dependencyType),
]);

export const initiatives = sqliteTable("initiative", {
  id: text("id").primaryKey(),
  programId: text("program_id").notNull().references(() => programs.id),
  primaryReleaseId: text("primary_release_id").references(() => releases.id),
  title: text("title").notNull(),
  normalizedTitle: text("normalized_title").notNull(),
  status: text("status").notNull().default("draft"),
  priority: text("priority").notNull().default("medium"),
  owner: text("owner"),
  targetDate: text("target_date"),
  consequence: text("consequence"),
  desiredOutcome: text("desired_outcome"),
  decisionAsk: text("decision_ask"),
  asIsStatement: text("as_is_statement"),
  toBeStatement: text("to_be_statement"),
  successMeasures: text("success_measures"),
  briefingAudience: text("briefing_audience"),
  decisionNeededBy: text("decision_needed_by"),
  createdByUserId: text("created_by_user_id").references(() => appUsers.id),
  ...timestamps,
}, (t) => [
  check("initiative_status", sql`${t.status} IN ('draft','active','decision_required','closed')`),
  check("initiative_priority", sql`${t.priority} IN ('low','medium','high','critical')`),
  uniqueIndex("initiative_program_title_uq").on(t.programId, t.normalizedTitle),
  index("initiative_program_status_ix").on(t.programId, t.status, t.targetDate),
  index("initiative_release_ix").on(t.programId, t.primaryReleaseId),
]);

export const initiativeScopes = sqliteTable("initiative_scope", {
  id: text("id").primaryKey(),
  initiativeId: text("initiative_id").notNull().references(() => initiatives.id),
  scopeKind: text("scope_kind").notNull(),
  scopeId: text("scope_id").notNull(),
  displayLabel: text("display_label"),
  ...timestamps,
}, (t) => [
  check("initiative_scope_kind", sql`${t.scopeKind} IN ('product','release','capability','occurrence','configuration_node')`),
  uniqueIndex("initiative_scope_uq").on(t.initiativeId, t.scopeKind, t.scopeId),
  index("initiative_scope_lookup_ix").on(t.scopeKind, t.scopeId),
]);

// An Initiative is the leadership decision frame. Change Requests remain the
// Government funding/prioritization units and may contribute to more than one
// Initiative without becoming owned by this application.
export const initiativeChangeRequests = sqliteTable("initiative_change_request", {
  id: text("id").primaryKey(),
  initiativeId: text("initiative_id").notNull().references(() => initiatives.id),
  changeRequestId: text("change_request_id").notNull().references(() => changeRequests.id),
  relationship: text("relationship").notNull().default("delivers"),
  contributionSummary: text("contribution_summary"),
  sortOrder: integer("sort_order").notNull().default(0),
  ...timestamps,
}, (t) => [
  check("initiative_change_relationship", sql`${t.relationship} IN ('delivers','enables','constrains','supports')`),
  uniqueIndex("initiative_change_request_uq").on(t.initiativeId, t.changeRequestId),
  index("initiative_change_request_request_ix").on(t.changeRequestId, t.initiativeId),
]);

// Incumbent Objectives are externally governed technical work units beneath a
// Change Request. Their dates and status support analysis here but never
// replace the incumbent system of record.
export const incumbentObjectives = sqliteTable("incumbent_objective", {
  id: text("id").primaryKey(),
  programId: text("program_id").notNull().references(() => programs.id),
  changeRequestId: text("change_request_id").notNull().references(() => changeRequests.id),
  externalSystem: text("external_system").notNull(),
  externalIdentifier: text("external_identifier").notNull(),
  externalItemType: text("external_item_type").notNull().default("Objective"),
  title: text("title").notNull(),
  summary: text("summary"),
  technicalOwner: text("technical_owner"),
  status: text("status").notNull().default("proposed"),
  plannedStart: text("planned_start"),
  plannedFinish: text("planned_finish"),
  actualStart: text("actual_start"),
  actualFinish: text("actual_finish"),
  sourceLocator: text("source_locator"),
  sourceAsOf: text("source_as_of"),
  createdByUserId: text("created_by_user_id").references(() => appUsers.id),
  ...timestamps,
}, (t) => [
  check("incumbent_objective_status", sql`${t.status} IN ('proposed','planned','in_progress','blocked','verification','complete','cancelled')`),
  uniqueIndex("incumbent_objective_external_uq").on(t.programId, t.externalSystem, t.externalIdentifier),
  index("incumbent_objective_request_ix").on(t.changeRequestId, t.status, t.plannedFinish),
]);

// A feed may report one Objective against several MCP/JPO identifiers. The
// legacy change_request_id remains an analyst-designated compatibility field;
// this table holds every reported association without implying ownership.
// A Change Request may depend on a specific Objective owned by another
// Change Request. This is deliberately separate from change_dependency so the
// dependency remains precise without implying that the entire owning request
// is required.
export const changeRequestObjectiveDependencies = sqliteTable("change_request_objective_dependency", {
  id: text("id").primaryKey(),
  dependentChangeRequestId: text("dependent_change_request_id").notNull().references(() => changeRequests.id),
  prerequisiteObjectiveId: text("prerequisite_objective_id").notNull().references(() => incumbentObjectives.id),
  relationship: text("relationship").notNull().default("requires"),
  status: text("status").notNull().default("proposed"),
  rationale: text("rationale").notNull(),
  sourceReference: text("source_reference"),
  sourceAsOf: text("source_as_of"),
  evidenceReference: text("evidence_reference"),
  createdByUserId: text("created_by_user_id").references(() => appUsers.id),
  ...timestamps,
}, (t) => [
  check("change_request_objective_dependency_relationship", sql`${t.relationship} IN ('requires','enables','blocks','consumes')`),
  check("change_request_objective_dependency_status", sql`${t.status} IN ('proposed','accepted','rejected','retired')`),
  uniqueIndex("change_request_objective_dependency_uq").on(t.dependentChangeRequestId, t.prerequisiteObjectiveId, t.relationship),
  index("change_request_objective_dependency_objective_ix").on(t.prerequisiteObjectiveId, t.status),
  index("change_request_objective_dependency_request_ix").on(t.dependentChangeRequestId, t.status),
]);

// Attribution identifies which technical effects an Objective is expected to
// deliver. The effect remains owned by its Change Request; this table records
// the evidence-backed contribution without duplicating the effect.
export const objectiveEffectAttributions = sqliteTable("objective_effect_attribution", {
  id: text("id").primaryKey(),
  objectiveId: text("objective_id").notNull().references(() => incumbentObjectives.id),
  changeEffectId: text("change_effect_id").notNull().references(() => changeEffects.id),
  attribution: text("attribution").notNull().default("contributing"),
  rationale: text("rationale").notNull(),
  sourceReference: text("source_reference"),
  sourceAsOf: text("source_as_of"),
  evidenceReference: text("evidence_reference"),
  confidence: text("confidence").notNull().default("unassessed"),
  createdByUserId: text("created_by_user_id").references(() => appUsers.id),
  ...timestamps,
}, (t) => [
  check("objective_effect_attribution_kind", sql`${t.attribution} IN ('primary','contributing','uncertain')`),
  check("objective_effect_attribution_confidence", sql`${t.confidence} IN ('unassessed','low','medium','high')`),
  uniqueIndex("objective_effect_attribution_uq").on(t.objectiveId, t.changeEffectId),
  index("objective_effect_attribution_effect_ix").on(t.changeEffectId, t.attribution),
  index("objective_effect_attribution_objective_ix").on(t.objectiveId, t.attribution),
]);

// Objective imports are a separate governed intake stream from the A2O Tech
// Stack. Source snapshots remain immutable; applying a package updates only
// supplier-owned Objective fields and never Government analysis records.
export const objectiveSourcePackages = sqliteTable("objective_source_package", {
  id: text("id").primaryKey(),
  programId: text("program_id").notNull().references(() => programs.id),
  externalSystem: text("external_system").notNull(),
  fileName: text("file_name").notNull(),
  sheetName: text("sheet_name"),
  contentHash: text("content_hash").notNull(),
  receivedAt: text("received_at").notNull(),
  status: text("status").notNull().default("staged"),
  rowCount: integer("row_count").notNull().default(0),
  addedCount: integer("added_count").notNull().default(0),
  changedCount: integer("changed_count").notNull().default(0),
  unchangedCount: integer("unchanged_count").notNull().default(0),
  blockedCount: integer("blocked_count").notNull().default(0),
  createdByUserId: text("created_by_user_id").references(() => appUsers.id),
  ...timestamps,
}, (t) => [
  check("objective_source_package_status", sql`${t.status} IN ('staged','applied','rejected')`),
  uniqueIndex("objective_source_package_hash_uq").on(t.programId, t.externalSystem, t.contentHash),
  index("objective_source_package_received_ix").on(t.programId, t.receivedAt),
]);

export const objectiveSourceRows = sqliteTable("objective_source_row", {
  id: text("id").primaryKey(),
  sourcePackageId: text("source_package_id").notNull().references(() => objectiveSourcePackages.id),
  rowNumber: integer("row_number").notNull(),
  externalSystem: text("external_system").notNull(),
  externalIdentifier: text("external_identifier").notNull(),
  rawPayload: text("raw_payload").notNull(),
  disposition: text("disposition").notNull(),
  objectiveId: text("objective_id").references(() => incumbentObjectives.id),
  createdAt: text("created_at").notNull(),
}, (t) => [
  check("objective_source_row_disposition", sql`${t.disposition} IN ('add','change','unchanged','blocked')`),
  uniqueIndex("objective_source_row_number_uq").on(t.sourcePackageId, t.rowNumber),
  index("objective_source_row_key_ix").on(t.externalSystem, t.externalIdentifier),
]);

// Daily GitLab Pages objective-feed imports retain the supplied document as an
// immutable observation. They are separate from generic spreadsheet imports
// because the feed includes directed dependencies and evolving delivery data.
export const lmObjectiveFeedSnapshots = sqliteTable("lm_objective_feed_snapshot", {
  id: text("id").primaryKey(),
  programId: text("program_id").notNull().references(() => programs.id),
  externalSystem: text("external_system").notNull(),
  fileName: text("file_name").notNull(),
  sourceLocator: text("source_locator"),
  sourceAsOf: text("source_as_of"),
  observedAt: text("observed_at").notNull(),
  contentHash: text("content_hash").notNull(),
  snapshotPayload: text("snapshot_payload").notNull(),
  recordCount: integer("record_count").notNull().default(0),
  addedCount: integer("added_count").notNull().default(0),
  changedCount: integer("changed_count").notNull().default(0),
  unchangedCount: integer("unchanged_count").notNull().default(0),
  removedCount: integer("removed_count").notNull().default(0),
  blockedCount: integer("blocked_count").notNull().default(0),
  status: text("status").notNull().default("applied"),
  createdByUserId: text("created_by_user_id").references(() => appUsers.id),
  ...timestamps,
}, (t) => [
  check("lm_objective_feed_snapshot_status", sql`${t.status} IN ('staged','applied','rejected')`),
  index("lm_objective_feed_snapshot_hash_ix").on(t.programId, t.externalSystem, t.contentHash),
  index("lm_objective_feed_snapshot_observed_ix").on(t.programId, t.externalSystem, t.observedAt),
]);

// Stable identity for an externally reported objective. It exists even when
// the feed supplies no JPO/MCP or no analyst has reconciled it to a legacy LM
// Objective record.
export const lmObjectiveFeedSubjects = sqliteTable("lm_objective_feed_subject", {
  id: text("id").primaryKey(), programId: text("program_id").notNull().references(() => programs.id),
  externalSystem: text("external_system").notNull(), feedKey: text("feed_key").notNull(), jiraIdentifier: text("jira_identifier"), url: text("url"),
  canonicalObjectiveId: text("canonical_objective_id").references(() => incumbentObjectives.id), createdAt: text("created_at").notNull(), updatedAt: text("updated_at").notNull(),
}, (t) => [uniqueIndex("lm_objective_feed_subject_key_uq").on(t.programId, t.externalSystem, t.feedKey), index("lm_objective_feed_subject_objective_ix").on(t.canonicalObjectiveId)]);

export const lmObjectiveFeedItems = sqliteTable("lm_objective_feed_item", {
  id: text("id").primaryKey(),
  snapshotId: text("snapshot_id").notNull().references(() => lmObjectiveFeedSnapshots.id),
  feedKey: text("feed_key").notNull(),
  jiraIdentifier: text("jira_identifier"),
  jpoRaw: text("jpo_raw"),
  subjectId: text("subject_id").notNull().references(() => lmObjectiveFeedSubjects.id),
  disposition: text("disposition").notNull(),
  normalizedPayload: text("normalized_payload").notNull(),
  rawPayload: text("raw_payload").notNull(),
  contentHash: text("content_hash").notNull(),
  createdAt: text("created_at").notNull(),
}, (t) => [
  check("lm_objective_feed_item_disposition", sql`${t.disposition} IN ('add','change','unchanged','blocked')`),
  uniqueIndex("lm_objective_feed_item_snapshot_key_uq").on(t.snapshotId, t.feedKey),
  index("lm_objective_feed_item_subject_ix").on(t.subjectId, t.snapshotId),
]);

// Current supplier-owned projection. Government assessments, estimates,
// decisions, requirements, and technical effects are deliberately excluded.
export const lmObjectiveFeedStates = sqliteTable("lm_objective_feed_state", {
  subjectId: text("subject_id").primaryKey().references(() => lmObjectiveFeedSubjects.id),
  latestSnapshotId: text("latest_snapshot_id").notNull().references(() => lmObjectiveFeedSnapshots.id),
  feedKey: text("feed_key").notNull(),
  url: text("url"), relTo: text("rel_to"), roadmapParent: text("roadmap_parent"), scope: text("scope"),
  domainsJson: text("domains_json").notNull().default("[]"), itemNumber: integer("item_number"),
  targetStart: text("target_start"), targetFinish: text("target_finish"), rom: text("rom"), percentComplete: real("percent_complete"),
  funding: text("funding"), release: text("release"), overview: text("overview"), background: text("background"),
  updatedAt: text("updated_at").notNull(),
}, (t) => [index("lm_objective_feed_state_snapshot_ix").on(t.latestSnapshotId)]);

// Targets may be numeric feed keys or external planning references such as
// arch_plan_44. Unresolved values remain useful external evidence.
export const lmObjectiveFeedDependencies = sqliteTable("lm_objective_feed_dependency", {
  id: text("id").primaryKey(), snapshotId: text("snapshot_id").notNull().references(() => lmObjectiveFeedSnapshots.id),
  sourceFeedKey: text("source_feed_key").notNull(), sourceSubjectId: text("source_subject_id").notNull().references(() => lmObjectiveFeedSubjects.id),
  direction: text("direction").notNull(), targetReference: text("target_reference").notNull(), targetSubjectId: text("target_subject_id").references(() => lmObjectiveFeedSubjects.id), createdAt: text("created_at").notNull(),
}, (t) => [
  check("lm_objective_feed_dependency_direction", sql`${t.direction} IN ('blocks','blocked_by')`),
  uniqueIndex("lm_objective_feed_dependency_uq").on(t.snapshotId, t.sourceFeedKey, t.direction, t.targetReference),
  index("lm_objective_feed_dependency_source_ix").on(t.sourceSubjectId, t.snapshotId), index("lm_objective_feed_dependency_target_ix").on(t.targetSubjectId, t.snapshotId),
]);

// Field-level deltas compare only successive supplied snapshots; they do not
// infer Government analysis or reinterpret the vendor's ROM/percent algorithm.
export const lmObjectiveFeedDeltas = sqliteTable("lm_objective_feed_delta", {
  id: text("id").primaryKey(), snapshotId: text("snapshot_id").notNull().references(() => lmObjectiveFeedSnapshots.id),
  subjectId: text("subject_id").notNull().references(() => lmObjectiveFeedSubjects.id), feedKey: text("feed_key").notNull(),
  changeKind: text("change_kind").notNull(), fieldName: text("field_name"), beforeValue: text("before_value"), afterValue: text("after_value"), createdAt: text("created_at").notNull(),
}, (t) => [
  check("lm_objective_feed_delta_kind", sql`${t.changeKind} IN ('added','changed','unchanged','removed','blocked')`),
  index("lm_objective_feed_delta_snapshot_ix").on(t.snapshotId, t.changeKind), index("lm_objective_feed_delta_subject_ix").on(t.subjectId, t.snapshotId),
]);

// Current JPO/MCP references reported by the feed. A missing Change Request
// resolution is valid; the raw external identifier remains visible.
export const lmObjectiveFeedJpoLinks = sqliteTable("lm_objective_feed_jpo_link", {
  id: text("id").primaryKey(), subjectId: text("subject_id").notNull().references(() => lmObjectiveFeedSubjects.id),
  latestSnapshotId: text("latest_snapshot_id").notNull().references(() => lmObjectiveFeedSnapshots.id), externalIdentifier: text("external_identifier").notNull(), changeRequestId: text("change_request_id").references(() => changeRequests.id),
  createdAt: text("created_at").notNull(), updatedAt: text("updated_at").notNull(),
}, (t) => [uniqueIndex("lm_objective_feed_jpo_link_uq").on(t.subjectId, t.externalIdentifier), index("lm_objective_feed_jpo_link_request_ix").on(t.changeRequestId)]);

// Estimates are append-only assessments with explicit provenance. This keeps
// an incumbent claim separate from a Government or independent assessment.
export const objectiveEstimates = sqliteTable("objective_estimate", {
  id: text("id").primaryKey(),
  objectiveId: text("objective_id").notNull().references(() => incumbentObjectives.id),
  estimateSource: text("estimate_source").notNull(),
  hoursLow: real("hours_low"),
  hoursLikely: real("hours_likely"),
  hoursHigh: real("hours_high"),
  costLow: real("cost_low"),
  costLikely: real("cost_likely"),
  costHigh: real("cost_high"),
  basis: text("basis").notNull(),
  assumptions: text("assumptions"),
  sourceReference: text("source_reference"),
  asOf: text("as_of").notNull(),
  confidence: text("confidence").notNull().default("unassessed"),
  createdByUserId: text("created_by_user_id").references(() => appUsers.id),
  ...timestamps,
}, (t) => [
  check("objective_estimate_source", sql`${t.estimateSource} IN ('incumbent','government','independent')`),
  check("objective_estimate_confidence", sql`${t.confidence} IN ('unassessed','low','medium','high')`),
  check("objective_estimate_nonnegative", sql`COALESCE(${t.hoursLow},0) >= 0 AND COALESCE(${t.hoursLikely},0) >= 0 AND COALESCE(${t.hoursHigh},0) >= 0 AND COALESCE(${t.costLow},0) >= 0 AND COALESCE(${t.costLikely},0) >= 0 AND COALESCE(${t.costHigh},0) >= 0`),
  index("objective_estimate_objective_ix").on(t.objectiveId, t.estimateSource, t.asOf),
]);

// Requirement traces reference the authoritative requirements source. The app
// records the proposed change and verification state; it does not silently
// become the requirements system of record.
export const requirementTraces = sqliteTable("requirement_trace", {
  id: text("id").primaryKey(),
  objectiveId: text("objective_id").notNull().references(() => incumbentObjectives.id),
  externalIdentifier: text("external_identifier").notNull(),
  title: text("title").notNull(),
  sourceSystem: text("source_system").notNull(),
  sourceLocator: text("source_locator"),
  sourceAsOf: text("source_as_of"),
  changeAction: text("change_action").notNull().default("verify"),
  beforeText: text("before_text"),
  afterText: text("after_text"),
  rationale: text("rationale"),
  traceStatus: text("trace_status").notNull().default("identified"),
  createdByUserId: text("created_by_user_id").references(() => appUsers.id),
  ...timestamps,
}, (t) => [
  check("requirement_trace_action", sql`${t.changeAction} IN ('add','modify','retire','verify','none')`),
  check("requirement_trace_status", sql`${t.traceStatus} IN ('identified','analysis_needed','traced','verified','not_applicable')`),
  uniqueIndex("requirement_trace_objective_external_uq").on(t.objectiveId, t.externalIdentifier),
  index("requirement_trace_status_ix").on(t.objectiveId, t.traceStatus),
]);

// Requirements are reusable references to an external requirements authority.
// An Objective links to a requirement through objective_requirement so the
// proposed change, version, disposition, and evidence remain Objective-specific.
export const requirements = sqliteTable("requirement", {
  id: text("id").primaryKey(),
  programId: text("program_id").notNull().references(() => programs.id),
  externalIdentifier: text("external_identifier").notNull(),
  title: text("title").notNull(),
  sourceSystem: text("source_system").notNull(),
  sourceLocator: text("source_locator"),
  sourceAsOf: text("source_as_of"),
  currentText: text("current_text"),
  lifecycleStatus: text("lifecycle_status").notNull().default("active"),
  createdByUserId: text("created_by_user_id").references(() => appUsers.id),
  ...timestamps,
}, (t) => [
  check("requirement_lifecycle_status", sql`${t.lifecycleStatus} IN ('active','retired','superseded')`),
  uniqueIndex("requirement_external_uq").on(t.programId, t.sourceSystem, t.externalIdentifier),
  index("requirement_program_ix").on(t.programId, t.lifecycleStatus, t.updatedAt),
]);

export const objectiveRequirements = sqliteTable("objective_requirement", {
  id: text("id").primaryKey(),
  objectiveId: text("objective_id").notNull().references(() => incumbentObjectives.id),
  requirementId: text("requirement_id").notNull().references(() => requirements.id),
  versionLabel: text("version_label").notNull().default("1"),
  changeAction: text("change_action").notNull().default("verify"),
  beforeText: text("before_text"),
  afterText: text("after_text"),
  rationale: text("rationale"),
  disposition: text("disposition").notNull().default("identified"),
  sourceReference: text("source_reference"),
  sourceAsOf: text("source_as_of"),
  createdByUserId: text("created_by_user_id").references(() => appUsers.id),
  ...timestamps,
}, (t) => [
  check("objective_requirement_action", sql`${t.changeAction} IN ('add','modify','retire','verify','none')`),
  check("objective_requirement_disposition", sql`${t.disposition} IN ('identified','analysis_needed','traced','verified','not_applicable')`),
  uniqueIndex("objective_requirement_version_uq").on(t.objectiveId, t.requirementId, t.versionLabel),
  index("objective_requirement_requirement_ix").on(t.requirementId, t.disposition),
]);

export const acceptanceCriteria = sqliteTable("acceptance_criterion", {
  id: text("id").primaryKey(),
  objectiveId: text("objective_id").notNull().references(() => incumbentObjectives.id),
  requirementTraceId: text("requirement_trace_id").references(() => requirementTraces.id),
  objectiveRequirementId: text("objective_requirement_id").references(() => objectiveRequirements.id),
  tier: text("tier").notNull(),
  code: text("code").notNull(),
  statement: text("statement").notNull(),
  verificationMethod: text("verification_method").notNull(),
  status: text("status").notNull().default("draft"),
  plannedDate: text("planned_date"),
  actualDate: text("actual_date"),
  evidenceReference: text("evidence_reference"),
  createdByUserId: text("created_by_user_id").references(() => appUsers.id),
  ...timestamps,
}, (t) => [
  check("acceptance_criterion_tier", sql`${t.tier} IN ('tier_3','tier_4','other')`),
  check("acceptance_criterion_method", sql`${t.verificationMethod} IN ('analysis','demonstration','inspection','test','review')`),
  check("acceptance_criterion_status", sql`${t.status} IN ('draft','ready','in_verification','passed','failed','waived')`),
  uniqueIndex("acceptance_criterion_objective_code_uq").on(t.objectiveId, t.code),
  index("acceptance_criterion_status_ix").on(t.objectiveId, t.status, t.plannedDate),
  index("acceptance_criterion_objective_requirement_ix").on(t.objectiveRequirementId),
]);

export const acceptanceSignoffs = sqliteTable("acceptance_signoff", {
  id: text("id").primaryKey(),
  criterionId: text("criterion_id").notNull().references(() => acceptanceCriteria.id),
  signoffRole: text("signoff_role").notNull(),
  signer: text("signer"),
  decision: text("decision").notNull().default("pending"),
  decidedAt: text("decided_at"),
  rationale: text("rationale"),
  // Kept as a durable identifier instead of a declaration-time FK because
  // evidence_document is declared later in this schema module.
  evidenceDocumentId: text("evidence_document_id"),
  createdByUserId: text("created_by_user_id").references(() => appUsers.id),
  ...timestamps,
}, (t) => [
  check("acceptance_signoff_decision", sql`${t.decision} IN ('pending','accepted','rejected','waived')`),
  uniqueIndex("acceptance_signoff_role_uq").on(t.criterionId, t.signoffRole),
  index("acceptance_signoff_decision_ix").on(t.criterionId, t.decision),
]);

export const initiativeMilestones = sqliteTable("initiative_milestone", {
  id: text("id").primaryKey(),
  initiativeId: text("initiative_id").notNull().references(() => initiatives.id),
  changeRequestId: text("change_request_id").references(() => changeRequests.id),
  objectiveId: text("objective_id").references(() => incumbentObjectives.id),
  title: text("title").notNull(),
  milestoneType: text("milestone_type").notNull(),
  plannedDate: text("planned_date").notNull(),
  actualDate: text("actual_date"),
  status: text("status").notNull().default("planned"),
  consequenceIfMissed: text("consequence_if_missed"),
  owner: text("owner"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdByUserId: text("created_by_user_id").references(() => appUsers.id),
  ...timestamps,
}, (t) => [
  check("initiative_milestone_type", sql`${t.milestoneType} IN ('decision','delivery','verification','fielding','dependency')`),
  check("initiative_milestone_status", sql`${t.status} IN ('planned','at_risk','complete','missed')`),
  index("initiative_milestone_timeline_ix").on(t.initiativeId, t.plannedDate, t.status),
  index("initiative_milestone_request_ix").on(t.changeRequestId, t.plannedDate),
]);

// WBS packages are an intentionally lightweight hierarchy beneath a single
// initiative. The code is stewardship-owned instead of being inferred from UI
// ordering, so it can be used in reports and external correspondence.
export const workPackages = sqliteTable("work_package", {
  id: text("id").primaryKey(),
  initiativeId: text("initiative_id").references(() => initiatives.id),
  changeRequestId: text("change_request_id").references(() => changeRequests.id),
  objectiveId: text("objective_id").references(() => incumbentObjectives.id),
  parentId: text("parent_id"),
  wbsCode: text("wbs_code").notNull(),
  title: text("title").notNull(),
  owner: text("owner"),
  plannedStart: text("planned_start"),
  dueDate: text("due_date"),
  actualStart: text("actual_start"),
  actualFinish: text("actual_finish"),
  status: text("status").notNull().default("planned"),
  workType: text("work_type").notNull().default("analysis"),
  definitionOfDone: text("definition_of_done"),
  progressBasis: text("progress_basis"),
  notes: text("notes"),
  sortOrder: integer("sort_order").notNull().default(0),
  ...timestamps,
}, (t) => [
  check("work_package_status", sql`${t.status} IN ('planned','in_progress','on_hold','complete')`),
  check("work_package_type", sql`${t.workType} IN ('analysis','coordination','verification','decision_support','other')`),
  check("work_package_context", sql`${t.initiativeId} IS NOT NULL`),
  uniqueIndex("work_package_objective_code_uq").on(t.objectiveId, t.wbsCode),
  index("work_package_initiative_status_ix").on(t.initiativeId, t.status, t.dueDate),
  index("work_package_objective_status_ix").on(t.objectiveId, t.status, t.dueDate),
  index("work_package_request_ix").on(t.changeRequestId, t.status),
]);

// Government work packages support or assess incumbent Objectives; they are
// not children owned by the Objective.  The association is many-to-many so a
// verification or coordination package may cover several Objectives.
export const workPackageObjectives = sqliteTable("work_package_objective", {
  id: text("id").primaryKey(),
  workPackageId: text("work_package_id").notNull().references(() => workPackages.id),
  objectiveId: text("objective_id").notNull().references(() => incumbentObjectives.id),
  relationship: text("relationship").notNull().default("supports"),
  rationale: text("rationale"),
  createdByUserId: text("created_by_user_id").references(() => appUsers.id),
  ...timestamps,
}, (t) => [
  check("work_package_objective_relationship", sql`${t.relationship} IN ('supports','assesses','verifies','coordinates')`),
  uniqueIndex("work_package_objective_uq").on(t.workPackageId, t.objectiveId, t.relationship),
  index("work_package_objective_objective_ix").on(t.objectiveId, t.relationship),
]);

export const workPackageDependencies = sqliteTable("work_package_dependency", {
  id: text("id").primaryKey(),
  predecessorWorkPackageId: text("predecessor_work_package_id").notNull().references(() => workPackages.id),
  successorWorkPackageId: text("successor_work_package_id").notNull().references(() => workPackages.id),
  relationship: text("relationship").notNull().default("FS"),
  lagDays: integer("lag_days").notNull().default(0),
  status: text("status").notNull().default("proposed"),
  rationale: text("rationale").notNull(),
  sourceReference: text("source_reference"),
  createdByUserId: text("created_by_user_id").references(() => appUsers.id),
  ...timestamps,
}, (t) => [
  check("work_package_dependency_relationship", sql`${t.relationship} IN ('FS','SS','FF','SF')`),
  check("work_package_dependency_status", sql`${t.status} IN ('proposed','accepted','rejected','retired')`),
  check("work_package_dependency_not_self", sql`${t.predecessorWorkPackageId} <> ${t.successorWorkPackageId}`),
  uniqueIndex("work_package_dependency_uq").on(t.predecessorWorkPackageId, t.successorWorkPackageId, t.relationship),
  index("work_package_dependency_successor_ix").on(t.successorWorkPackageId, t.status),
]);

export const governanceRecords = sqliteTable("governance_record", {
  id: text("id").primaryKey(),
  programId: text("program_id").notNull().references(() => programs.id),
  recordType: text("record_type").notNull(),
  externalReference: text("external_reference"),
  title: text("title").notNull(),
  status: text("status").notNull().default("open"),
  owner: text("owner"),
  occurredAt: text("occurred_at"),
  participants: text("participants"),
  dueDate: text("due_date"),
  summary: text("summary"),
  decisionAsk: text("decision_ask"),
  actionItems: text("action_items"),
  impact: text("impact"),
  createdByUserId: text("created_by_user_id").references(() => appUsers.id),
  ...timestamps,
}, (t) => [
  check("governance_record_type", sql`${t.recordType} IN ('mcp','technical_call','decision','risk','question','technical_note')`),
  check("governance_record_status", sql`${t.status} IN ('open','in_review','approved','closed','superseded')`),
  index("governance_record_program_type_ix").on(t.programId, t.recordType, t.status, t.occurredAt),
  index("governance_record_external_reference_ix").on(t.programId, t.externalReference),
]);

export const governanceRecordLinks = sqliteTable("governance_record_link", {
  id: text("id").primaryKey(),
  governanceRecordId: text("governance_record_id").notNull().references(() => governanceRecords.id),
  entityKind: text("entity_kind").notNull(),
  entityId: text("entity_id").notNull(),
  relationship: text("relationship").notNull().default("affects"),
  ...timestamps,
}, (t) => [
  check("governance_record_link_kind", sql`${t.entityKind} IN ('initiative','work_package','release','product','capability','occurrence','configuration_node','platform','organization','change_request','objective')`),
  uniqueIndex("governance_record_link_uq").on(t.governanceRecordId, t.entityKind, t.entityId, t.relationship),
  index("governance_record_link_target_ix").on(t.entityKind, t.entityId),
]);

export const evidenceDocuments = sqliteTable("evidence_document", {
  id: text("id").primaryKey(),
  programId: text("program_id").notNull().references(() => programs.id),
  governanceRecordId: text("governance_record_id").references(() => governanceRecords.id),
  initiativeId: text("initiative_id").references(() => initiatives.id),
  fileName: text("file_name").notNull(),
  contentType: text("content_type"),
  byteSize: integer("byte_size").notNull().default(0),
  r2Key: text("r2_key").notNull(),
  description: text("description"),
  uploadedByUserId: text("uploaded_by_user_id").references(() => appUsers.id),
  createdAt: text("created_at").notNull(),
}, (t) => [
  uniqueIndex("evidence_document_r2_key_uq").on(t.r2Key),
  index("evidence_document_record_ix").on(t.governanceRecordId, t.createdAt),
  index("evidence_document_initiative_ix").on(t.initiativeId, t.createdAt),
]);

export const executiveBriefs = sqliteTable("executive_brief", {
  id: text("id").primaryKey(),
  programId: text("program_id").notNull().references(() => programs.id),
  initiativeId: text("initiative_id").references(() => initiatives.id),
  title: text("title").notNull(),
  status: text("status").notNull().default("draft"),
  notes: text("notes"),
  snapshotPayload: text("snapshot_payload").notNull(),
  bodyMarkdown: text("body_markdown").notNull(),
  createdByUserId: text("created_by_user_id").references(() => appUsers.id),
  publishedAt: text("published_at"),
  ...timestamps,
}, (t) => [
  check("executive_brief_status", sql`${t.status} IN ('draft','reviewed','published','superseded')`),
  index("executive_brief_program_status_ix").on(t.programId, t.status, t.updatedAt),
  index("executive_brief_initiative_ix").on(t.initiativeId, t.updatedAt),
]);

export const briefPublications = sqliteTable("brief_publication", {
  id: text("id").primaryKey(),
  briefId: text("brief_id").notNull().references(() => executiveBriefs.id),
  format: text("format").notNull(),
  contentHash: text("content_hash").notNull(),
  snapshotPayload: text("snapshot_payload").notNull(),
  createdByUserId: text("created_by_user_id").references(() => appUsers.id),
  createdAt: text("created_at").notNull(),
}, (t) => [
  check("brief_publication_format", sql`${t.format} IN ('markdown','pdf','docx')`),
  index("brief_publication_brief_ix").on(t.briefId, t.createdAt),
]);

// Every file import follows one governed lifecycle even when a source-specific
// adapter owns the final materialization.  Runs and items retain the analyst's
// review decision, mapping override, source payload, and proposed field delta.
export const ingestionRuns = sqliteTable("ingestion_run", {
  id: text("id").primaryKey(),
  programId: text("program_id").notNull().references(() => programs.id),
  adapterKey: text("adapter_key").notNull(),
  sourceSystem: text("source_system").notNull(),
  fileName: text("file_name").notNull(),
  sheetName: text("sheet_name"),
  sourceLocator: text("source_locator"),
  sourceAsOf: text("source_as_of"),
  contentHash: text("content_hash").notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  status: text("status").notNull().default("staged"),
  recordCount: integer("record_count").notNull().default(0),
  addedCount: integer("added_count").notNull().default(0),
  changedCount: integer("changed_count").notNull().default(0),
  unchangedCount: integer("unchanged_count").notNull().default(0),
  skippedCount: integer("skipped_count").notNull().default(0),
  blockedCount: integer("blocked_count").notNull().default(0),
  targetSnapshotKind: text("target_snapshot_kind"),
  targetSnapshotId: text("target_snapshot_id"),
  reviewedByUserId: text("reviewed_by_user_id").references(() => appUsers.id),
  reviewedAt: text("reviewed_at"),
  appliedByUserId: text("applied_by_user_id").references(() => appUsers.id),
  appliedAt: text("applied_at"),
  ...timestamps,
}, (t) => [
  check("ingestion_run_status", sql`${t.status} IN ('staged','reviewed','applied','rejected','failed')`),
  uniqueIndex("ingestion_run_idempotency_uq").on(t.programId, t.idempotencyKey),
  index("ingestion_run_adapter_ix").on(t.programId, t.adapterKey, t.createdAt),
]);

export const ingestionItems = sqliteTable("ingestion_item", {
  id: text("id").primaryKey(),
  runId: text("run_id").notNull().references(() => ingestionRuns.id),
  rowNumber: integer("row_number").notNull(),
  sourceKey: text("source_key").notNull(),
  targetKind: text("target_kind"),
  targetId: text("target_id"),
  matchMethod: text("match_method").notNull(),
  decision: text("decision").notNull(),
  disposition: text("disposition").notNull(),
  rawPayload: text("raw_payload").notNull(),
  normalizedPayload: text("normalized_payload").notNull(),
  changesPayload: text("changes_payload").notNull().default("[]"),
  issuesPayload: text("issues_payload").notNull().default("[]"),
  createdAt: text("created_at").notNull(),
}, (t) => [
  check("ingestion_item_decision", sql`${t.decision} IN ('approve','skip')`),
  check("ingestion_item_disposition", sql`${t.disposition} IN ('add','change','unchanged','blocked')`),
  uniqueIndex("ingestion_item_run_row_uq").on(t.runId, t.rowNumber),
  index("ingestion_item_target_ix").on(t.targetKind, t.targetId),
]);

// Current supplier-controlled Change Request attributes stay separate from
// Government priority, decisions, effects, and narrative analysis.
export const externalChangeSourceStates = sqliteTable("external_change_source_state", {
  changeRequestId: text("change_request_id").primaryKey().references(() => changeRequests.id),
  latestRunId: text("latest_run_id").notNull().references(() => ingestionRuns.id),
  externalSystem: text("external_system").notNull(),
  rawPayload: text("raw_payload").notNull(),
  normalizedPayload: text("normalized_payload").notNull(),
  sourceAsOf: text("source_as_of"),
  updatedAt: text("updated_at").notNull(),
}, (t) => [index("external_change_source_state_system_ix").on(t.externalSystem, t.sourceAsOf)]);

export const auditEvents = sqliteTable("audit_event", {
  id: text("id").primaryKey(), programId: text("program_id").notNull().references(() => programs.id), actorId: text("actor_id"), action: text("action").notNull(), entityKind: text("entity_kind").notNull(), entityId: text("entity_id").notNull(), beforePayload: text("before_payload"), afterPayload: text("after_payload"), createdAt: text("created_at").notNull(),
}, (t) => [index("audit_entity_ix").on(t.programId, t.entityKind, t.entityId, t.createdAt), index("audit_actor_ix").on(t.programId, t.actorId, t.createdAt)]);

export const schema = {
  programs,
  releaseMilestones,
  canonicalAliases,
  canonicalMergeEvents,
  sourcePackages,
  sourceRows24,
  sourceOccurrenceReviews,
  sourceOccurrenceReviewsV2,
  baselineWorkspaces,
  baselineOccurrences,
  baselineRecordExtensions,
  baselineRecordSources,
  baselineRecordReviews,
  releases,
  releaseProfiles,
  configurationBaselines,
  configurationNodes,
  products,
  deployments,
  baselineNodeStates,
  baselineDeploymentStates,
  managedHostProfiles,
  managedDeploymentProfiles,
  platforms,
  platformOrganizations,
  platformBaselineAssignments,
  organizations,
  productSuppliers,
  capabilities,
  productCapabilities,
  appUsers,
  programRoleAssignments,
  changeRequestTypes,
  changeRequests,
  changeEffects,
  changeDependencies,
  initiatives,
  initiativeChangeRequests,
  incumbentObjectives,
  changeRequestObjectiveDependencies,
  objectiveEffectAttributions,
  objectiveSourcePackages,
  objectiveSourceRows,
  lmObjectiveFeedSnapshots,
  lmObjectiveFeedSubjects,
  lmObjectiveFeedItems,
  lmObjectiveFeedStates,
  lmObjectiveFeedJpoLinks,
  lmObjectiveFeedDependencies,
  lmObjectiveFeedDeltas,
  objectiveEstimates,
  requirementTraces,
  requirements,
  objectiveRequirements,
  acceptanceCriteria,
  acceptanceSignoffs,
  initiativeMilestones,
  initiativeScopes,
  workPackages,
  workPackageObjectives,
  workPackageDependencies,
  governanceRecords,
  governanceRecordLinks,
  evidenceDocuments,
  executiveBriefs,
  briefPublications,
  ingestionRuns,
  ingestionItems,
  externalChangeSourceStates,
  auditEvents,
};
