import { describe, expect, it, vi } from "vitest";

const parent = vi.hoisted(() => ({ entry: undefined as Record<string, unknown> | undefined }));
const upsert = vi.hoisted(() => vi.fn(async (_target: unknown, patch: unknown) => patch));

vi.mock("./subagent-spawn.runtime.js", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  loadSessionEntry: () => parent.entry,
  resolveGatewaySessionStoreTarget: ({ key }: { key: string }) => ({
    agentId: "main",
    canonicalKey: key,
    storeKeys: [key],
    storePath: "store.sqlite",
  }),
  upsertSessionEntryCore: upsert,
}));

import { createInitialSubagentSession } from "./subagent-spawn-session-patch.js";

async function spawnChild() {
  const result = await createInitialSubagentSession({
    cfg: {},
    targetAgentId: "main",
    childSessionKey: "agent:main:subagent:abc",
    incognito: false,
    requesterInternalKey: "agent:main:chat-1",
    creationPolicy: { actor: "agent" } as never,
    completionOwnerSessionKey: "agent:main:chat-1",
    modelPatch: {},
    collect: false,
  });
  expect(result.status).toBe("ok");
  return (result as { entry: Record<string, unknown> }).entry;
}

describe("subagent spawn from a Memory-less chat", () => {
  it("makes the child Memory-less", async () => {
    parent.entry = { sessionId: "p1", memoryless: true };
    expect((await spawnChild()).memoryless).toBe(true);
  });

  it("leaves the child of a normal chat unmarked", async () => {
    parent.entry = { sessionId: "p2" };
    expect((await spawnChild()).memoryless).toBeUndefined();
  });
});
