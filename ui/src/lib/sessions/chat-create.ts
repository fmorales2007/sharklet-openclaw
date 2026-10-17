// Creation of a chat from the composer (F2-01 contract; F2-02 implements it).
import type { Result } from "@openclaw/normalization-core/result";
import type { RpcClient, RpcError } from "../../api/rpc.ts";

/** What the composer chooses before the first turn. The first message and its
 *  attachments go through chat.send afterwards, never in sessions.create
 *  (rpc-schemas PARAMS_LIMITS, and a retried create must not carry a turn). */
export type ChatCreateInput = {
  agentId: string;
  model?: string;
  /** Effort; the gateway's thinking level id (agents.list thinkingLevels). */
  thinkingLevel?: string;
  memoryless: boolean;
};

export type ChatCreated = { key: string; sessionId?: string; memoryless: boolean };

/** Always sends an idempotencyKey (randomUUID) so rpcCall's retries cannot fork a chat. */
export async function createChat(
  client: RpcClient,
  input: ChatCreateInput,
  options?: { signal?: AbortSignal },
): Promise<Result<ChatCreated, RpcError>> {
  void client;
  void input;
  void options;
  throw new Error("createChat: not implemented (F2-02)");
}
