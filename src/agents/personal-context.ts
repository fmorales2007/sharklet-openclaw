// F2-08: per-agent switches for the personal context the You page writes, and the
// limits that page shows. The marked blocks stay in the files; a switched-off piece
// is only left out of what this agent reads, so the owner's text is never deleted.
import type { OpenClawConfig } from "../config/types.openclaw.js";
import { resolveAgentConfig } from "./agent-scope-config.js";
import {
  resolveBootstrapMaxChars,
  resolveBootstrapTotalMaxChars,
  USER_BOOTSTRAP_MAX_CHARS,
} from "./embedded-agent-helpers/bootstrap.js";
import {
  PERSONAL_CONTEXT_BLOCKS,
  PERSONAL_CONTEXT_PIECES,
  writeBlock,
  type PersonalContextPiece,
} from "./personal-context-blocks.js";
import type { WorkspaceBootstrapFile } from "./workspace.js";

export type PersonalContextToggles = Record<PersonalContextPiece, boolean>;

/** MEMORY.md is advised to stay compact; this is a recommendation, not a truncation point. */
export const MEMORY_ADVISORY_CHARS = 3072;

/** Every piece is on unless this agent's config switches it off. */
export function resolvePersonalContextToggles(
  cfg: OpenClawConfig | undefined,
  agentId: string | null | undefined,
): PersonalContextToggles {
  const configured = cfg && agentId ? resolveAgentConfig(cfg, agentId)?.personalContext : undefined;
  return Object.fromEntries(
    PERSONAL_CONTEXT_PIECES.map((piece) => [piece, configured?.[piece] !== false]),
  ) as PersonalContextToggles;
}

/** Leaves each switched-off piece's marked block out of its file's content. */
export function withoutDisabledPersonalContext(
  files: WorkspaceBootstrapFile[],
  toggles: PersonalContextToggles,
): WorkspaceBootstrapFile[] {
  const off = PERSONAL_CONTEXT_PIECES.filter((piece) => !toggles[piece]);
  if (off.length === 0) {
    return files;
  }
  return files.map((file) => {
    if (file.missing || typeof file.content !== "string") {
      return file;
    }
    let content = file.content;
    for (const piece of off) {
      const target = PERSONAL_CONTEXT_BLOCKS[piece];
      if (target.file.toLowerCase() === file.name.toLowerCase()) {
        content = writeBlock(content, target.block, null);
      }
    }
    return content === file.content ? file : { ...file, content };
  });
}

/** The numbers the runtime truncates by for one agent, for the You page to read. */
export function resolveBootstrapLimits(cfg: OpenClawConfig | undefined, agentId: string) {
  return {
    fileMaxChars: resolveBootstrapMaxChars(cfg, agentId),
    totalMaxChars: resolveBootstrapTotalMaxChars(cfg, agentId),
    userMaxChars: USER_BOOTSTRAP_MAX_CHARS,
    memoryAdvisoryChars: MEMORY_ADVISORY_CHARS,
  };
}
