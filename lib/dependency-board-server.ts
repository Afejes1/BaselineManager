import { env } from "cloudflare:workers";
import { buildDependencyBoard } from "./dependency-board-model.js";
import { portfolio } from "./governance-server.js";
import type { Actor } from "./governance-server.js";
import { initiativeDecisionWorkspace } from "./initiative-decision-server.js";
import { masterDataPortfolio } from "./master-data-server.js";

type Database = typeof env.DB;

export async function dependencyBoardPortfolio(db: Database, actor: Actor) {
  const [decisions, governance, master] = await Promise.all([initiativeDecisionWorkspace(db, actor), portfolio(db, actor), masterDataPortfolio(db)]);
  return buildDependencyBoard(decisions, governance, master);
}
