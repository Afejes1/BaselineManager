import type { AssistantProposalKind } from "./assistant-model.js";

export type AssistantActionField = {
  name: string;
  label: string;
  description?: string;
  required?: boolean;
  format?: "date";
};

export type AssistantActionDefinition = {
  kind: AssistantProposalKind;
  toolName: string;
  label: string;
  description: string;
  fields: readonly AssistantActionField[];
};

const field = (name: string, label: string, options: Omit<AssistantActionField, "name" | "label"> = {}): AssistantActionField => ({ name, label, ...options });

/**
 * The proposal registry is the one contract shared by the model adapter, the
 * review UI, and the governed server-side apply path.  It intentionally
 * describes only actions that already have a local, audited workflow.
 */
export const assistantActions: readonly AssistantActionDefinition[] = [
  {
    kind: "create_initiative",
    toolName: "a2o_create_initiative",
    label: "Create Initiative",
    description: "Create a title-only Government problem/outcome decision case with its required protected status-quo option.",
    fields: [field("title", "Initiative title", { required: true })],
  },
  {
    kind: "update_initiative",
    toolName: "a2o_update_initiative",
    label: "Update Initiative",
    description: "Update Government-authored problem/outcome case framing. Option sources, plans, assessments, and adjudication remain separate reviewed actions.",
    fields: [field("initiativeId", "Initiative ID"), field("title", "Initiative title"), field("owner", "Owner"), field("problemStatement", "Problem statement"), field("desiredOutcome", "Shared outcome"), field("successMeasures", "Success measures"), field("driversConstraints", "Drivers and constraints"), field("decisionQuestion", "Decision question"), field("decisionNeededBy", "Decision needed by", { format: "date" }), field("romHoursPerPoint", "ROM hours per point"), field("romConversionRationale", "ROM conversion rationale")],
  },
  {
    kind: "save_objective",
    toolName: "a2o_save_objective",
    label: "Save LM Objective",
    description: "Create or update an LM Objective under a Change Request related to the current record.",
    fields: [field("id", "Objective ID"), field("changeRequestId", "Change Request ID"), field("externalSystem", "External system", { required: true }), field("externalIdentifier", "Objective identifier", { required: true }), field("externalItemType", "Item type"), field("title", "Objective title", { required: true }), field("summary", "Summary"), field("technicalOwner", "Technical owner"), field("status", "Status"), field("plannedStart", "Planned start", { format: "date" }), field("plannedFinish", "Planned finish", { format: "date" }), field("actualStart", "Actual start", { format: "date" }), field("actualFinish", "Actual finish", { format: "date" }), field("sourceLocator", "Source locator"), field("sourceAsOf", "Source as of", { format: "date" }), field("reparentReason", "Reparent reason")],
  },
  {
    kind: "create_call_note",
    toolName: "a2o_create_call_note",
    label: "Create technical call record",
    description: "Create a Government-recorded technical call note hard-linked to the current record. It is not a decision record.",
    fields: [field("title", "Call-record title", { required: true }), field("summary", "Discussion summary", { required: true }), field("occurredAt", "Call date", { format: "date" }), field("externalReference", "Call / meeting reference"), field("owner", "Note owner"), field("participants", "Participants"), field("decisionAsk", "Decision or clarification required"), field("actionItems", "Action items"), field("dueDate", "Follow-up due", { format: "date" }), field("impact", "Baseline / delivery impact"), field("status", "Status")],
  },
] as const;

const actionsByKind = new Map(assistantActions.map((item) => [item.kind, item]));
const actionsByTool = new Map(assistantActions.map((item) => [item.toolName, item]));

export function assistantAction(kind: AssistantProposalKind) {
  return actionsByKind.get(kind);
}

export function assistantActionForTool(toolName: string) {
  return actionsByTool.get(toolName);
}

export function assistantActionFieldNames(kind: AssistantProposalKind) {
  return assistantAction(kind)?.fields.map((item) => item.name) || [];
}

/** JSON Schema-shaped tools for OpenAI-compatible providers that support them. */
export function assistantToolDefinitions() {
  return assistantActions.map((action) => ({
    type: "function",
    function: {
      name: action.toolName,
      description: action.description,
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["title", "rationale", "fields"],
        properties: {
          title: { type: "string", description: "Short review-card label." },
          rationale: { type: "string", description: "Why the action is supported and what remains uncertain." },
          fields: {
            type: "object",
            additionalProperties: false,
            required: action.fields.filter((item) => item.required).map((item) => item.name),
            properties: Object.fromEntries(action.fields.map((item) => [item.name, { type: "string", description: item.description || item.label, ...(item.format ? { format: item.format } : {}) }])),
          },
        },
      },
    },
  }));
}

export function assistantActionCatalogText() {
  return assistantActions.map((action) => `${action.kind}: ${action.description} Fields: ${action.fields.map((item) => `${item.name}${item.required ? " (required)" : ""}`).join(", ")}.`).join("\n");
}
