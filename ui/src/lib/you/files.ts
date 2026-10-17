// You → agent files (F2-07). Each section owns one marked block inside a file the
// agent already reads; everything outside the block is left byte for byte, so
// what the owner or the agent wrote by hand survives a save.
//
//   About you, Response style → USER.md   (4,000-character bootstrap cap)
//   Skill rules               → AGENTS.md
//   Memory                    → MEMORY.md
//
// Pure: no call, no clock. Values are checked against closed schemas on the way
// in (a save) and the way out (a parse never trusts the file).
import { err, ok, type Result } from "@openclaw/normalization-core/result";
import { Type, type Static, type TSchema } from "typebox";
import { Value } from "typebox/value";
import { findKeyShapedField, firstSchemaError } from "../../api/rpc-schemas.ts";

/** Same number as USER_BOOTSTRAP_MAX_CHARS in the gateway, which refuses a longer write. */
export const USER_FILE_MAX_CHARS = 4000;
export const AGENTS_FILE_MAX_CHARS = 20_000;
export const MEMORY_FILE_MAX_CHARS = 20_000;

export const RESPONSE_TONES = ["direct", "warm", "formal"] as const;
export const RESPONSE_LENGTHS = ["brief", "balanced", "detailed"] as const;
export const SKILL_RULES_MAX = 20;

const AboutYouSchema = Type.Object(
  { text: Type.String({ maxLength: 1200 }) },
  { additionalProperties: false },
);
const ResponseStyleSchema = Type.Object(
  {
    tone: Type.Union([Type.Literal("direct"), Type.Literal("warm"), Type.Literal("formal")]),
    length: Type.Union([Type.Literal("brief"), Type.Literal("balanced"), Type.Literal("detailed")]),
    notes: Type.String({ maxLength: 400 }),
  },
  { additionalProperties: false },
);
// One line each: a newline or the arrow would break the "When I … → use …" line.
const SkillRuleSchema = Type.Object(
  {
    when: Type.String({ minLength: 1, maxLength: 120, pattern: "^[^\\n\\r→]+$" }),
    skill: Type.String({ minLength: 1, maxLength: 64, pattern: "^[A-Za-z0-9][A-Za-z0-9._:-]*$" }),
  },
  { additionalProperties: false },
);
const SkillRulesSchema = Type.Object(
  { rules: Type.Array(SkillRuleSchema, { maxItems: SKILL_RULES_MAX }) },
  { additionalProperties: false },
);
const MemorySchema = Type.Object(
  { notes: Type.String({ maxLength: 6000 }) },
  { additionalProperties: false },
);

export type AboutYou = Static<typeof AboutYouSchema>;
export type ResponseStyle = Static<typeof ResponseStyleSchema>;
export type SkillRule = Static<typeof SkillRuleSchema>;
export type SkillRules = Static<typeof SkillRulesSchema>;
export type MemoryNotes = Static<typeof MemorySchema>;

export const DEFAULT_ABOUT_YOU: AboutYou = { text: "" };
export const DEFAULT_RESPONSE_STYLE: ResponseStyle = {
  tone: "direct",
  length: "balanced",
  notes: "",
};

// ---- marked blocks ----------------------------------------------------------

export type BlockId = "about-you" | "response-style" | "skill-rules" | "memory";
const open = (id: BlockId) => `<!-- sharklet:${id} -->`;
const close = (id: BlockId) => `<!-- /sharklet:${id} -->`;
const MARKER_TEXT = /<!--\s*\/?sharklet:/i;

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

// ---- validation -------------------------------------------------------------

/** Why `value` cannot be saved as `schema`, or null. Paths and rules only, never values. */
function reject(schema: TSchema, value: unknown): string | null {
  if (!Value.Check(schema, value)) {
    return firstSchemaError(schema, value);
  }
  if (MARKER_TEXT.test(JSON.stringify(value))) {
    return "/: reserved marker";
  }
  const leak = findKeyShapedField(value);
  return leak ? `${leak}: key-shaped value` : null;
}

export const validateAboutYou = (value: unknown) => reject(AboutYouSchema, value);
export const validateResponseStyle = (value: unknown) => reject(ResponseStyleSchema, value);
export const validateSkillRules = (value: unknown) => reject(SkillRulesSchema, value);
export const validateMemoryNotes = (value: unknown) => reject(MemorySchema, value);

// ---- parse (file → section) -------------------------------------------------

export function parseAboutYou(userMd: string): AboutYou {
  const body = readBlock(userMd, "about-you");
  const text = body?.replace(/^## About you\r?\n?/, "").trim() ?? "";
  return Value.Check(AboutYouSchema, { text }) ? { text } : { ...DEFAULT_ABOUT_YOU };
}

export function parseResponseStyle(userMd: string): ResponseStyle {
  const body = readBlock(userMd, "response-style");
  if (!body) {
    return { ...DEFAULT_RESPONSE_STYLE };
  }
  const pick = (label: string) => new RegExp(`^- ${label}: (\\S+)\\s*$`, "m").exec(body)?.[1];
  const notes = body
    .split(/\r?\n/)
    .filter((line) => !/^(## Response style|- (Tone|Length): .*)$/.test(line))
    .join("\n")
    .trim();
  const parsed = { tone: pick("Tone"), length: pick("Length"), notes };
  return Value.Check(ResponseStyleSchema, parsed) ? parsed : { ...DEFAULT_RESPONSE_STYLE };
}

const RULE_LINE = /^- When I (.+?) → use (\S+)\s*$/;

export function parseSkillRules(agentsMd: string): SkillRule[] {
  const body = readBlock(agentsMd, "skill-rules") ?? "";
  const rules: SkillRule[] = [];
  for (const line of body.split(/\r?\n/)) {
    const [, when = "", skill = ""] = RULE_LINE.exec(line) ?? [];
    if (Value.Check(SkillRuleSchema, { when, skill })) {
      rules.push({ when, skill });
    }
  }
  return rules.slice(0, SKILL_RULES_MAX);
}

export function parseMemoryNotes(memoryMd: string): MemoryNotes {
  const body = readBlock(memoryMd, "memory");
  const notes = body?.replace(/^## Notes from the owner\r?\n?/, "").trim() ?? "";
  return Value.Check(MemorySchema, { notes }) ? { notes } : { notes: "" };
}

// ---- apply (section → file) -------------------------------------------------

function fit(content: string, max: number, file: string): Result<string, string> {
  return content.length > max
    ? err(`${file}: ${content.length} of ${max} characters`)
    : ok(content);
}

export function applyAboutYou(userMd: string, value: AboutYou): Result<string, string> {
  const bad = validateAboutYou(value);
  if (bad) {
    return err(bad);
  }
  const text = value.text.trim();
  return fit(
    writeBlock(userMd, "about-you", text ? `## About you\n${text}` : null),
    USER_FILE_MAX_CHARS,
    "USER.md",
  );
}

export function applyResponseStyle(userMd: string, value: ResponseStyle): Result<string, string> {
  const bad = validateResponseStyle(value);
  if (bad) {
    return err(bad);
  }
  const notes = value.notes.trim();
  const lines = ["## Response style", `- Tone: ${value.tone}`, `- Length: ${value.length}`];
  return fit(
    writeBlock(
      userMd,
      "response-style",
      notes ? `${lines.join("\n")}\n${notes}` : lines.join("\n"),
    ),
    USER_FILE_MAX_CHARS,
    "USER.md",
  );
}

export function applySkillRules(agentsMd: string, value: SkillRules): Result<string, string> {
  const bad = validateSkillRules(value);
  if (bad) {
    return err(bad);
  }
  const lines = value.rules.map((rule) => `- When I ${rule.when.trim()} → use ${rule.skill}`);
  return fit(
    writeBlock(
      agentsMd,
      "skill-rules",
      lines.length ? `## Skill rules\n${lines.join("\n")}` : null,
    ),
    AGENTS_FILE_MAX_CHARS,
    "AGENTS.md",
  );
}

export function applyMemoryNotes(memoryMd: string, value: MemoryNotes): Result<string, string> {
  const bad = validateMemoryNotes(value);
  if (bad) {
    return err(bad);
  }
  const notes = value.notes.trim();
  return fit(
    writeBlock(memoryMd, "memory", notes ? `## Notes from the owner\n${notes}` : null),
    MEMORY_FILE_MAX_CHARS,
    "MEMORY.md",
  );
}
