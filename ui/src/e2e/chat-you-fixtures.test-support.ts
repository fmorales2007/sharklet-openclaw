// Mocked gateway responses for the chat and You contract (F2-01), in the
// control-ui-e2e format: pass to `installMockGateway(page, { methodResponses })`.
// Frozen with the contract; each track adds its own fixtures in its own file.
// Synthetic data only: no keys, no personal values.
import type { AgentsListResult, SessionsListResult } from "../api/types.ts";

const NOW = Date.UTC(2026, 9, 15, 12);
const MINUTE = 60_000;
const LEVELS = ["off", "minimal", "low", "medium", "high"].map((id) => ({ id, label: id }));

export const CHAT_YOU_AGENTS_LIST = {
  defaultId: "main",
  mainKey: "main",
  scope: "per-sender",
  agents: [
    {
      id: "main",
      name: "Example assistant",
      model: { primary: "openai/gpt-5.5" },
      thinkingLevels: LEVELS,
      thinkingDefault: "medium",
    },
    { id: "writer", name: "Example writer", thinkingLevels: LEVELS, thinkingDefault: "low" },
  ],
} satisfies AgentsListResult;

export const CHAT_YOU_SESSION_DEFAULT_MODEL = "anthropic/claude-sonnet-4-6";

export function chatYouSessionRow(overrides: Record<string, unknown> = {}) {
  return {
    key: "agent:main:dashboard:fixture-normal",
    kind: "direct",
    label: "Fixture chat",
    updatedAt: NOW - MINUTE,
    status: "done",
    ...overrides,
  };
}

export const CHAT_YOU_SESSIONS_LIST = {
  ts: NOW,
  path: "",
  count: 2,
  defaults: {
    modelProvider: "anthropic",
    model: CHAT_YOU_SESSION_DEFAULT_MODEL,
    contextTokens: null,
  },
  sessions: [
    chatYouSessionRow(),
    chatYouSessionRow({
      key: "agent:main:dashboard:fixture-memoryless",
      label: "Fixture Memory-less chat",
      memoryless: true,
    }),
  ],
} as SessionsListResult;

export const CHAT_YOU_CREATE_NORMAL = {
  ok: true,
  key: "agent:main:dashboard:fixture-normal",
  sessionId: "fixture-session-normal",
  entry: {},
};

export const CHAT_YOU_CREATE_MEMORYLESS = {
  ok: true,
  key: "agent:main:dashboard:fixture-memoryless",
  sessionId: "fixture-session-memoryless",
  entry: { memoryless: true },
};

/** What the gateway answers to a Memory-less create until F2-09. */
export const CHAT_YOU_CREATE_MEMORYLESS_NOT_READY = {
  __mockError: {
    code: "INVALID_REQUEST",
    message: "memoryless sessions: not implemented (F2-09)",
  },
};

export type ChatYouScenarioKind = "normal" | "memoryless" | "defaults" | "error";

export function chatYouScenario(kind: ChatYouScenarioKind): Record<string, unknown> {
  const base = {
    "agents.list": CHAT_YOU_AGENTS_LIST,
    "sessions.list": CHAT_YOU_SESSIONS_LIST,
  };
  switch (kind) {
    case "normal":
      return { ...base, "sessions.create": CHAT_YOU_CREATE_NORMAL };
    case "memoryless":
      return { ...base, "sessions.create": CHAT_YOU_CREATE_MEMORYLESS };
    case "defaults":
      return base;
    case "error":
      return { ...base, "sessions.create": CHAT_YOU_CREATE_MEMORYLESS_NOT_READY };
  }
}
