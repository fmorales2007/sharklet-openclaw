// You → Defaults (F2-01 contract). The composer reads them through
// selectComposerDefaults; saveYouDefaults (F2-07) writes them with agents.update.
import { err, ok, type Result } from "@openclaw/normalization-core/result";
import { rpcCall, type RpcClient, type RpcError } from "../../api/rpc.ts";
import type { AgentsListResult } from "../../api/types.ts";

/** You → Defaults, as the composer reads them for one agent. */
export type ComposerDefaults = {
  agentId: string;
  /** provider/model id, or null when neither the agent nor the gateway names one. */
  model: string | null;
  /** Thinking level id, or null to use the model's own policy. */
  effort: string | null;
};

/** What You → Defaults saves for one agent. Omitted = unchanged; null = clear the override. */
export type YouDefaultsPatch = {
  agentId: string;
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
  const { agentId, model, effort } = patch;
  // A write is never retried: it is idempotent, but a lost reply would hide a real conflict.
  const saved = await rpcCall(
    client,
    "agents.update",
    {
      agentId,
      ...(model !== undefined ? { model } : {}),
      ...(effort !== undefined ? { thinkingDefault: effort } : {}),
    },
    { retry: { maxRetries: 0 } },
  );
  return saved.ok ? ok(undefined) : err(saved.error);
}
