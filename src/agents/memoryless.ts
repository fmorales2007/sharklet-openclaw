// Sharklet Memory-less (ADR-006 section 7). The session flag is fixed at creation, and this
// module is the single owner of what it turns off: memory tools, memory files in the context,
// memory plugin hooks and the memory flush. It keeps About you and Response style (USER.md),
// Defaults, skills, every other tool and the saved transcript.
//
// The style-learning module (ADR-006 section 4) does not exist yet; when it does, it must ask
// `isMemorylessEntry` before it learns from a chat.
import path from "node:path";
import { loadSessionEntryReadOnly } from "../config/sessions/session-accessor.js";
import { resolveSessionStorePathForScope } from "../config/sessions/session-store-path.js";
import type { OpenClawConfig } from "../config/types.openclaw.js";
import { extractApplyPatchTargetPaths } from "./apply-patch-paths.js";

/** Tools that read or write memory. One list: tool removal and the veto both use it. */
export const MEMORYLESS_DENIED_TOOL_NAMES = [
  // memory-core
  "memory_search",
  "memory_get",
  "intent",
  // memory-lancedb
  "memory_recall",
  "memory_store",
  "memory_forget",
  // memory-wiki
  "wiki_status",
  "wiki_search",
  "wiki_lint",
  "wiki_apply",
  "wiki_get",
] as const;

const DENIED_TOOLS: ReadonlySet<string> = new Set(MEMORYLESS_DENIED_TOOL_NAMES);

/** Workspace-relative memory targets that generic file tools must not write. */
const MEMORY_FILES = ["MEMORY.md", "DREAMS.md"];
const MEMORY_DIR_PREFIX = "memory/";

const BLOCK_REASON =
  "This chat is Memory-less: memory tools and memory files are off. Answer from the conversation; nothing is saved to memory.";

export function isMemorylessEntry(entry: { memoryless?: unknown } | undefined): boolean {
  return entry?.memoryless === true;
}

/** Reads the flag once for a run; the mark never changes after the session is created. */
export function resolveMemorylessForRun(params: {
  config?: OpenClawConfig;
  agentId?: string;
  sessionKey?: string;
  storePath?: string;
}): boolean {
  if (!params.sessionKey || !params.config || !params.agentId) {
    return false;
  }
  try {
    const storePath = resolveSessionStorePathForScope(
      { agentId: params.agentId, sessionKey: params.sessionKey, storePath: params.storePath },
      params.config,
    );
    return isMemorylessEntry(
      loadSessionEntryReadOnly({
        agentId: params.agentId,
        storePath,
        sessionKey: params.sessionKey,
        clone: false,
      }),
    );
  } catch {
    // An unreadable store cannot prove the mark; the run is treated as ordinary, never as blocked.
    return false;
  }
}

function isMemoryPath(rawPath: string, root: string): boolean {
  const resolved = path.isAbsolute(rawPath)
    ? path.resolve(rawPath)
    : path.resolve(root, rawPath.replaceAll("\\", "/"));
  const relative = path.relative(root, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return false;
  }
  const normalized = relative.split(path.sep).join("/");
  const comparable = process.platform === "win32" ? normalized.toLowerCase() : normalized;
  const files =
    process.platform === "win32" ? MEMORY_FILES.map((f) => f.toLowerCase()) : MEMORY_FILES;
  return files.includes(comparable) || comparable.startsWith(MEMORY_DIR_PREFIX);
}

function targetPaths(toolName: string, toolParams: unknown, cwd: string): string[] {
  if (toolName === "apply_patch") {
    // Resolved against the tool's cwd, as execution resolves them.
    return extractApplyPatchTargetPaths(toolParams, { cwd });
  }
  if (toolName !== "write" && toolName !== "edit") {
    return [];
  }
  const params = (toolParams ?? {}) as Record<string, unknown>;
  return [params.path, params.file_path].filter(
    (value): value is string => typeof value === "string",
  );
}

/** The reason to give the model when this call must be vetoed in a Memory-less run. */
export function memorylessToolBlockReason(params: {
  toolName: string;
  toolParams: unknown;
  workspaceDir?: string;
  cwd?: string;
}): string | undefined {
  if (DENIED_TOOLS.has(params.toolName)) {
    return BLOCK_REASON;
  }
  const root = path.resolve(params.cwd ?? params.workspaceDir ?? "");
  if (!params.cwd && !params.workspaceDir) {
    return undefined;
  }
  const workspaceRoot = path.resolve(params.workspaceDir ?? root);
  return targetPaths(params.toolName, params.toolParams, root).some((target) =>
    isMemoryPath(target, workspaceRoot),
  )
    ? BLOCK_REASON
    : undefined;
}
