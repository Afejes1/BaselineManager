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
  id: text("id").primaryKey(), programId: text("program_id").notNull().references(() => programs.id), code: text("code"), normalizedCode: text("normalized_code"), name: text("name").notNull(), normalizedName: text("normalized_name").notNull(), status: text("status").notNull().default("planned"), targetDate: text("target_date"), actualDate: text("actual_date"), ...timestamps,
}, (t) => [uniqueIndex("release_code_uq").on(t.programId, t.normalizedCode), uniqueIndex("release_name_uq").on(t.programId, t.normalizedName), index("release_status_ix").on(t.programId, t.status)]);

export const configurationBaselines = sqliteTable("configuration_baseline", {
  id: text("id").primaryKey(), programId: text("program_id").notNull().references(() => programs.id), releaseId: text("release_id").notNull().references(() => releases.id), name: text("name").notNull(), normalizedName: text("normalized_name").notNull(), maturity: text("maturity").notNull().default("reported"), asOf: text("as_of").notNull(), status: text("status").notNull().default("working"), description: text("description"), parentBaselineId: text("parent_baseline_id"), ...timestamps,
}, (t) => [uniqueIndex("baseline_release_name_asof_uq").on(t.releaseId, t.normalizedName, t.asOf), index("baseline_release_ix").on(t.programId, t.releaseId, t.status)]);

export const organizations = sqliteTable("organization", {
  id: text("id").primaryKey(), programId: text("program_id").notNull().references(() => programs.id), name: text("name").notNull(), normalizedName: text("normalized_name").notNull(), organizationType: text("organization_type"), ...timestamps,
}, (t) => [uniqueIndex("organization_name_uq").on(t.programId, t.normalizedName)]);

export const configurationNodes = sqliteTable("configuration_node", {
  id: text("id").primaryKey(), programId: text("program_id").notNull().references(() => programs.id), parentId: text("parent_id"), nodeType: text("node_type").notNull(), code: text("code"), normalizedCode: text("normalized_code"), name: text("name").notNull(), normalizedName: text("normalized_name").notNull(), description: text("description"), ownerOrganizationId: text("owner_organization_id").references(() => organizations.id), ...timestamps,
}, (t) => [check("configuration_node_not_self", sql`${t.parentId} IS NULL OR ${t.parentId} <> ${t.id}`), uniqueIndex("configuration_node_code_uq").on(t.programId, t.normalizedCode), uniqueIndex("configuration_node_position_uq").on(t.programId, t.parentId, t.nodeType, t.normalizedName), index("configuration_node_parent_ix").on(t.programId, t.parentId, t.nodeType)]);

export const products = sqliteTable("product", {
  id: text("id").primaryKey(), programId: text("program_id").notNull().references(() => programs.id), canonicalName: text("canonical_name").notNull(), normalizedName: text("normalized_name").notNull(), shortName: text("short_name"), productType: text("product_type"), softwareClassification: text("software_classification"), ownerOrganizationId: text("owner_organization_id").references(() => organizations.id), ...timestamps,
}, (t) => [uniqueIndex("product_name_uq").on(t.programId, t.normalizedName), index("product_search_ix").on(t.programId, t.shortName)]);

export const productSuppliers = sqliteTable("product_supplier", {
  productId: text("product_id").notNull().references(() => products.id), organizationId: text("organization_id").notNull().references(() => organizations.id), supplierRole: text("supplier_role").notNull(), ...timestamps,
}, (t) => [uniqueIndex("product_supplier_uq").on(t.productId, t.organizationId, t.supplierRole)]);

export const capabilities = sqliteTable("capability", {
  id: text("id").primaryKey(), programId: text("program_id").notNull().references(() => programs.id), parentId: text("parent_id"), code: text("code"), name: text("name").notNull(), normalizedName: text("normalized_name").notNull(), description: text("description"), ...timestamps,
}, (t) => [uniqueIndex("capability_name_uq").on(t.programId, t.normalizedName), index("capability_parent_ix").on(t.programId, t.parentId)]);

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
  id: text("id").primaryKey(), programId: text("program_id").notNull().references(() => programs.id), baselineId: text("baseline_id").notNull().references(() => configurationBaselines.id), deploymentId: text("deployment_id").notNull().references(() => deployments.id), sourceRowId: text("source_row_id"), reportedVersion: text("reported_version"), presence: text("presence").notNull().default("unknown"), status: text("status").notNull().default("reported"), installationType: text("installation_type"), containerized: text("containerized"), containerTechnology: text("container_technology"), containerType: text("container_type"), language: text("language"), notes: text("notes"), ...timestamps,
}, (t) => [check("baseline_deployment_presence", sql`${t.presence} IN ('present','absent','unknown')`), uniqueIndex("baseline_deployment_state_uq").on(t.baselineId, t.deploymentId), index("baseline_deployment_state_baseline_ix").on(t.baselineId, t.status, t.presence)]);

// Every original cell is kept as text (including the five notes fields) and the
// JSON payload preserves types/empty-cell distinctions from the reader.
export const sourceRows24 = sqliteTable("source_row_24", {
  id: text("id").primaryKey(), sourcePackageId: text("source_package_id").notNull().references(() => sourcePackages.id), sourceKey: text("source_key"), rowNumber: integer("row_number").notNull(), rowHash: text("row_hash").notNull(), rawPayload: text("raw_payload").notNull(),
  colReleaseName: text("release_name"), colTier: text("tier"), colResource: text("resource"), colTechStackType: text("tech_stack_type"), colShortName: text("short_name"), colHwHost: text("hw_host"), colHwStorageType: text("hw_storage_type"), colHwStorageGb: text("hw_storage_gb"), colHwCpuCores: text("hw_cpu_cores"), colHwRamGb: text("hw_ram_gb"), colSwLanguage: text("sw_language"), colSoftwareType: text("software_type"), colOem: text("oem"), colContainerized: text("containerized"), colContainerTechnology: text("container_technology"), colContainerType: text("container_type"), colLongName: text("long_name"), colNotes: text("notes"), colCapabilityNotes: text("capability_notes"), colNotes1: text("notes_1"), colNotes2: text("notes_2"), colNotes3: text("notes_3"), colNotes4: text("notes_4"),
  releaseId: text("release_id").references(() => releases.id), baselineId: text("baseline_id").references(() => configurationBaselines.id), configurationNodeId: text("configuration_node_id").references(() => configurationNodes.id), productId: text("product_id").references(() => products.id), deploymentId: text("deployment_id").references(() => deployments.id), materializationStatus: text("materialization_status").notNull().default("unreviewed"), ...timestamps,
}, (t) => [uniqueIndex("source_row_package_key_uq").on(t.sourcePackageId, t.sourceKey), uniqueIndex("source_row_package_number_uq").on(t.sourcePackageId, t.rowNumber), index("source_row_review_ix").on(t.sourcePackageId, t.materializationStatus, t.rowNumber), index("source_row_release_ix").on(t.releaseId, t.baselineId)]);

export const auditEvents = sqliteTable("audit_event", {
  id: text("id").primaryKey(), programId: text("program_id").notNull().references(() => programs.id), actorId: text("actor_id"), action: text("action").notNull(), entityKind: text("entity_kind").notNull(), entityId: text("entity_id").notNull(), beforePayload: text("before_payload"), afterPayload: text("after_payload"), createdAt: text("created_at").notNull(),
}, (t) => [index("audit_entity_ix").on(t.programId, t.entityKind, t.entityId, t.createdAt), index("audit_actor_ix").on(t.programId, t.actorId, t.createdAt)]);

export const schema = { programs, sourcePackages, sourceRows24, releases, configurationBaselines, configurationNodes, products, deployments, baselineNodeStates, baselineDeploymentStates, organizations, productSuppliers, capabilities, productCapabilities, auditEvents };
