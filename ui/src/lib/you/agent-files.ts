// You → read and save, one agent at a time (F2-07). "Global" is not a store: the
// owner picks agents and the same section is written into each one's own file
// (USER.md has no shared copy; plan, Registro de la fase 0).
import { err, ok, type Result } from "@openclaw/normalization-core/result";
import { rpcCall, type AgentFileName, type RpcClient, type RpcError } from "../../api/rpc.ts";
import {
  applyAboutYou,
  applyMemoryNotes,
  applyResponseStyle,
  applySkillRules,
  parseAboutYou,
  parseMemoryNotes,
  parseResponseStyle,
  parseSkillRules,
  type AboutYou,
  type MemoryNotes,
  type ResponseStyle,
  type SkillRules,
} from "./files.ts";

/** One agent's You sections, as its files hold them now. */
export type YouSnapshot = {
  agentId: string;
  aboutYou: AboutYou;
  responseStyle: ResponseStyle;
  skillRules: SkillRules;
  memory: MemoryNotes;
};

/** A section and the value to save into it. */
export type YouChange =
  | { section: "about-you"; value: AboutYou }
  | { section: "response-style"; value: ResponseStyle }
  | { section: "skill-rules"; value: SkillRules }
  | { section: "memory"; value: MemoryNotes };

const CHANGE_TARGET = {
  "about-you": { file: "USER.md", apply: (c: string, v: never) => applyAboutYou(c, v) },
  "response-style": { file: "USER.md", apply: (c: string, v: never) => applyResponseStyle(c, v) },
  "skill-rules": { file: "AGENTS.md", apply: (c: string, v: never) => applySkillRules(c, v) },
  memory: { file: "MEMORY.md", apply: (c: string, v: never) => applyMemoryNotes(c, v) },
} satisfies Record<
  YouChange["section"],
  { file: AgentFileName; apply: (content: string, value: never) => Result<string, string> }
>;

/** Why a save for one agent did not happen. `changed`: the file moved since it was read. */
export type YouSaveFailure =
  | { kind: "invalid"; reason: string }
  | { kind: "changed" }
  | { kind: "rpc"; error: RpcError };

export type YouSaveOutcome = { agentId: string; result: Result<void, YouSaveFailure> };

const CHANGED_DETAIL = "changed since it was read";

async function readFile(
  client: RpcClient,
  agentId: string,
  name: AgentFileName,
): Promise<Result<{ content: string; hash: string | undefined }, RpcError>> {
  const read = await rpcCall(client, "agents.files.get", { agentId, name });
  if (!read.ok) {
    return err(read.error);
  }
  const { file } = read.value;
  return ok({ content: file.missing ? "" : (file.content ?? ""), hash: file.hash });
}

/** The three files, a missing one reading as empty, which parses to the defaults. */
export async function readYou(
  client: RpcClient,
  agentId: string,
): Promise<Result<YouSnapshot, RpcError>> {
  const user = await readFile(client, agentId, "USER.md");
  if (!user.ok) {
    return err(user.error);
  }
  const agents = await readFile(client, agentId, "AGENTS.md");
  if (!agents.ok) {
    return err(agents.error);
  }
  const memory = await readFile(client, agentId, "MEMORY.md");
  if (!memory.ok) {
    return err(memory.error);
  }
  return ok({
    agentId,
    aboutYou: parseAboutYou(user.value.content),
    responseStyle: parseResponseStyle(user.value.content),
    skillRules: { rules: parseSkillRules(agents.value.content) },
    memory: parseMemoryNotes(memory.value.content),
  });
}

async function saveOne(
  client: RpcClient,
  agentId: string,
  change: YouChange,
): Promise<Result<void, YouSaveFailure>> {
  const target = CHANGE_TARGET[change.section];
  const current = await readFile(client, agentId, target.file);
  if (!current.ok) {
    return err({ kind: "rpc", error: current.error });
  }
  const next = target.apply(current.value.content, change.value as never);
  if (!next.ok) {
    return err({ kind: "invalid", reason: next.error });
  }
  // A write is never retried: a retry after a lost reply would meet its own hash and fail.
  const written = await rpcCall(
    client,
    "agents.files.set",
    {
      agentId,
      name: target.file,
      content: next.value,
      ...(current.value.hash ? { expectedHash: current.value.hash } : {}),
    },
    { retry: { maxRetries: 0 } },
  );
  if (written.ok) {
    return ok(undefined);
  }
  return err(
    written.error.detail?.includes(CHANGED_DETAIL)
      ? { kind: "changed" }
      : { kind: "rpc", error: written.error },
  );
}

/**
 * Saves one section into each agent, one after another. A failure for one agent
 * does not stop the rest; the outcomes say which agents hold the new value.
 */
export async function saveYouSection(
  client: RpcClient,
  agentIds: readonly string[],
  change: YouChange,
): Promise<YouSaveOutcome[]> {
  const outcomes: YouSaveOutcome[] = [];
  for (const agentId of agentIds) {
    outcomes.push({ agentId, result: await saveOne(client, agentId, change) });
  }
  return outcomes;
}
