// You → Defaults (F2-01 contract). The composer reads them through
// selectComposerDefaults; F2-07 implements saveYouDefaults.
import type { Result } from "@openclaw/normalization-core/result";
import type { RpcClient, RpcError } from "../../api/rpc.ts";
import type { AgentsListResult } from "../../api/types.ts";

/** You → Defaults, as the composer reads them for one agent. */
export type ComposerDefaults = {
  agentId: string;
  /** provider/model id, or null when neither the agent nor the gateway names one. */
  model: string | null;
  /** Thinking level id, or null to use the model's own policy. */
  effort: string | null;
};

/** What You → Defaults saves. Omitted = unchanged; null = clear the override. */
export type YouDefaultsPatch = {
  agentId?: string;
  model?: string | null;
  effort?: string | null;
};

/**
 * Pure projection, no call. Agent: `agentId` if listed, else `defaultId`.
 * Model: that agent's model.primary, else `sessionDefaultModel` (sessions.list defaults.model).
 * Effort: that agent's thinkingDefault (the gateway already resolves agent ?? agents.defaults).
 */
export function selectComposerDefaults(
  agents: AgentsListResult,
  sessionDefaultModel: string | null,
  agentId?: string,
): ComposerDefaults {
  const agent =
    agents.agents.find((a) => a.id === agentId) ??
    agents.agents.find((a) => a.id === agents.defaultId);
  return {
    agentId: agent?.id ?? agents.defaultId,
    model: agent?.model?.primary ?? sessionDefaultModel,
    effort: agent?.thinkingDefault ?? null,
  };
}

export async function saveYouDefaults(
  client: RpcClient,
  patch: YouDefaultsPatch,
): Promise<Result<void, RpcError>> {
  void client;
  void patch;
  throw new Error("saveYouDefaults: not implemented (F2-07)");
}
