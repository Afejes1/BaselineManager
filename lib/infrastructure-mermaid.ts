import type {
  InfrastructureConnection,
  InfrastructureNode,
  InfrastructureProductInstallation,
  ReleaseInfrastructureNode,
} from "./topology-model.js";

type PlatformIdentity = { code: string; name: string };

const safeLabel = (value: string) => value
  .replace(/["`]/g, "'")
  .replace(/[\[\]{}<>|]/g, " ")
  .replace(/\s+/g, " ")
  .trim();

const mermaidId = (prefix: string, value: string) => {
  const normalized = value.replace(/[^a-zA-Z0-9]/g, "_");
  return `${prefix}${normalized || "record"}`;
};

const nodeShape = (node: InfrastructureNode, state: ReleaseInfrastructureNode) => {
  const label = safeLabel(`${node.code} · ${node.name}\n${node.nodeType.replaceAll("_", " ")} · ${state.operatingState.replaceAll("_", " ")}`);
  const id = mermaidId("node", state.id);
  return node.nodeType === "virtual_machine" ? `${id}[["${label}"]]` : `${id}["${label}"]`;
};

export function buildInfrastructureMermaid({
  platform,
  releaseName,
  states,
  nodes,
  installations,
  connections,
}: {
  platform: PlatformIdentity;
  releaseName: string;
  states: ReleaseInfrastructureNode[];
  nodes: InfrastructureNode[];
  installations: InfrastructureProductInstallation[];
  connections: InfrastructureConnection[];
}) {
  const activeStates = states.filter((item) => item.lifecycleStatus !== "absent");
  const activeStateIds = new Set(activeStates.map((item) => item.id));
  const nodeById = new Map(nodes.map((item) => [item.id, item]));
  const lines = [
    "flowchart BT",
    `  platformRoot["${safeLabel(`${platform.code} · ${platform.name}\nRelease: ${releaseName}`)}"]`,
  ];

  for (const state of activeStates) {
    const node = nodeById.get(state.infrastructureNodeId);
    if (!node) continue;
    lines.push(`  ${nodeShape(node, state)}`);
  }

  for (const state of activeStates) {
    const stateId = mermaidId("node", state.id);
    const parentId = state.parentStateId && activeStateIds.has(state.parentStateId)
      ? mermaidId("node", state.parentStateId)
      : "platformRoot";
    lines.push(`  ${parentId} --> ${stateId}`);
  }

  for (const installation of installations.filter((item) => item.deploymentStatus !== "absent")) {
    if (!activeStateIds.has(installation.nodeStateId)) continue;
    const id = mermaidId("product", installation.id);
    const label = safeLabel(`${installation.productName}${installation.version ? ` v${installation.version}` : ""}\n${installation.installationRole.replaceAll("_", " ")}${installation.instanceName ? ` · ${installation.instanceName}` : ""}`);
    lines.push(`  ${id}("${label}")`);
    lines.push(`  ${mermaidId("node", installation.nodeStateId)} --> ${id}`);
  }

  for (const connection of connections.filter((item) => item.status !== "retired")) {
    if (!activeStateIds.has(connection.sourceNodeStateId) || !activeStateIds.has(connection.targetNodeStateId)) continue;
    const label = safeLabel(connection.label || connection.connectionType.replaceAll("_", " "));
    lines.push(`  ${mermaidId("node", connection.sourceNodeStateId)} -.->|${label}| ${mermaidId("node", connection.targetNodeStateId)}`);
  }

  lines.push(
    "  classDef platform fill:#173f2d,color:#ffffff,stroke:#173f2d,stroke-width:2px",
    "  classDef physical fill:#f1f8f3,color:#244638,stroke:#3f7d5b,stroke-width:2px",
    "  classDef virtual fill:#f2f7fb,color:#244638,stroke:#3e7d9d,stroke-width:2px",
    "  classDef product fill:#f7f4fb,color:#244638,stroke:#68528f,stroke-width:1px",
    "  class platformRoot platform",
  );

  const physicalIds = activeStates
    .filter((state) => nodeById.get(state.infrastructureNodeId)?.nodeType !== "virtual_machine")
    .map((state) => mermaidId("node", state.id));
  const virtualIds = activeStates
    .filter((state) => nodeById.get(state.infrastructureNodeId)?.nodeType === "virtual_machine")
    .map((state) => mermaidId("node", state.id));
  const productIds = installations
    .filter((item) => item.deploymentStatus !== "absent" && activeStateIds.has(item.nodeStateId))
    .map((item) => mermaidId("product", item.id));
  if (physicalIds.length) lines.push(`  class ${physicalIds.join(",")} physical`);
  if (virtualIds.length) lines.push(`  class ${virtualIds.join(",")} virtual`);
  if (productIds.length) lines.push(`  class ${productIds.join(",")} product`);

  return `${lines.join("\n")}\n`;
}
