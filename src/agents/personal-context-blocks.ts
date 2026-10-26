// Marked blocks of personal context inside the files an agent already reads
// (USER.md, AGENTS.md, MEMORY.md). The You page writes them; the gateway removes
// the ones an agent has switched off. Pure and import-free: the Control UI shares it.
export type BlockId = "about-you" | "response-style" | "skill-rules" | "memory";

/** The switchable pieces, each owning one block in one file. */
export const PERSONAL_CONTEXT_PIECES = [
  "aboutYou",
  "responseStyle",
  "skillRules",
  "memory",
] as const;
export type PersonalContextPiece = (typeof PERSONAL_CONTEXT_PIECES)[number];

export const PERSONAL_CONTEXT_BLOCKS: Record<
  PersonalContextPiece,
  { block: BlockId; file: "USER.md" | "AGENTS.md" | "MEMORY.md" }
> = {
  aboutYou: { block: "about-you", file: "USER.md" },
  responseStyle: { block: "response-style", file: "USER.md" },
  skillRules: { block: "skill-rules", file: "AGENTS.md" },
  memory: { block: "memory", file: "MEMORY.md" },
};

const open = (id: BlockId) => `<!-- sharklet:${id} -->`;
const close = (id: BlockId) => `<!-- /sharklet:${id} -->`;

/** Text between the markers, or null when the block is absent. */
export function readBlock(content: string, id: BlockId): string | null {
  const start = content.indexOf(open(id));
  if (start < 0) {
    return null;
  }
  const bodyStart = start + open(id).length;
  const end = content.indexOf(close(id), bodyStart);
  return end < 0
    ? null
    : content
        .slice(bodyStart, end)
        .replace(/^\r?\n/, "")
        .replace(/\r?\n$/, "");
}

/** Replaces the block in place, or appends it after the existing text. Empty body removes it. */
export function writeBlock(content: string, id: BlockId, body: string | null): string {
  const start = content.indexOf(open(id));
  const end = start < 0 ? -1 : content.indexOf(close(id), start);
  const block = body === null ? "" : `${open(id)}\n${body}\n${close(id)}`;
  if (start >= 0 && end >= 0) {
    const after = content.slice(end + close(id).length);
    if (block) {
      return `${content.slice(0, start)}${block}${after}`;
    }
    const before = content.slice(0, start).replace(/\s+$/, "");
    const rest = after.replace(/^\s+/, "");
    const joined = before && rest ? `${before}\n\n${rest}` : before || rest;
    return joined ? `${joined.replace(/\s+$/, "")}\n` : "";
  }
  if (!block) {
    return content;
  }
  const trimmed = content.replace(/\s+$/, "");
  return trimmed ? `${trimmed}\n\n${block}\n` : `${block}\n`;
}
