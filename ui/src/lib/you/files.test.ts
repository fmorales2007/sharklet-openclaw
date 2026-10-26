import { describe, expect, it } from "vitest";
import {
  applyAboutYou,
  applyMemoryNotes,
  applyResponseStyle,
  applySkillRules,
  parseAboutYou,
  parseMemoryNotes,
  parseResponseStyle,
  parseSkillRules,
  readBlock,
  validateAboutYou,
  validateResponseStyle,
  validateSkillRules,
  writeBlock,
} from "./files.ts";
import type { YouLimits } from "./limits.ts";

const style = { tone: "warm", length: "brief", notes: "Use plain words." } as const;

const LIMITS: YouLimits = {
  fileMaxChars: 5_000,
  totalMaxChars: 12_000,
  userMaxChars: 900,
  memoryAdvisoryChars: 700,
};

describe("marked blocks", () => {
  it("appends after existing text and replaces in place without touching the rest", () => {
    const original = "# USER\n\nName: someone-else-wrote-this\n";
    const first = writeBlock(original, "memory", "one");
    expect(first.startsWith(original.trimEnd())).toBe(true);
    const second = writeBlock(`${first}\nTail line\n`, "memory", "two");
    expect(readBlock(second, "memory")).toBe("two");
    expect(second.endsWith("\nTail line\n")).toBe(true);
    expect(second.startsWith("# USER\n\nName: someone-else-wrote-this\n")).toBe(true);
  });

  it("removes a block and leaves the rest readable", () => {
    const withBlock = writeBlock("# USER\n", "memory", "one");
    expect(writeBlock(withBlock, "memory", null)).toBe("# USER\n");
    expect(writeBlock("", "memory", null)).toBe("");
  });
});

describe("About you and Response style share USER.md", () => {
  it("round-trips both and keeps hand-written text", () => {
    const base = "# USER\nPrefers tea.\n";
    const a = applyAboutYou(base, { text: "I run a bakery." }, LIMITS);
    expect(a.ok).toBe(true);
    const b = applyResponseStyle(a.ok ? a.value : "", style, LIMITS);
    expect(b.ok).toBe(true);
    const file = b.ok ? b.value : "";
    expect(file).toContain("Prefers tea.");
    expect(parseAboutYou(file)).toEqual({ text: "I run a bakery." });
    expect(parseResponseStyle(file)).toEqual(style);
  });

  it("writes the tone where the agent reads it", () => {
    const result = applyResponseStyle("", style, LIMITS);
    expect(result.ok && result.value).toContain("- Tone: warm");
  });

  it("defaults when the block is missing or hand-edited into nonsense", () => {
    expect(parseResponseStyle("")).toEqual({ tone: "direct", length: "balanced", notes: "" });
    const broken =
      "<!-- sharklet:response-style -->\n- Tone: loud\n<!-- /sharklet:response-style -->";
    expect(parseResponseStyle(broken).tone).toBe("direct");
  });

  it("refuses a write that would pass the USER.md cap", () => {
    const big = "x".repeat(LIMITS.userMaxChars - 10);
    const result = applyAboutYou(big, { text: "y".repeat(100) }, LIMITS);
    expect(result.ok).toBe(false);
  });
});

describe("Skill rules in AGENTS.md", () => {
  it("writes the 'When I … → use …' line and reads it back", () => {
    const rules = { rules: [{ when: "propose a project", skill: "grilling" }] };
    const result = applySkillRules("# AGENTS\n", rules, LIMITS);
    expect(result.ok && result.value).toContain("- When I propose a project → use grilling");
    expect(parseSkillRules(result.ok ? result.value : "")).toEqual(rules.rules);
  });

  it("an empty list removes the block", () => {
    const first = applySkillRules("# AGENTS\n", { rules: [{ when: "a", skill: "b" }] }, LIMITS);
    const cleared = applySkillRules(first.ok ? first.value : "", { rules: [] }, LIMITS);
    expect(cleared.ok && cleared.value).toBe("# AGENTS\n");
  });
});

describe("Memory in MEMORY.md", () => {
  it("round-trips notes", () => {
    const result = applyMemoryNotes("", { notes: "Birthday is in May." }, LIMITS);
    expect(parseMemoryNotes(result.ok ? result.value : "")).toEqual({
      notes: "Birthday is in May.",
    });
  });
});

describe("validation rejects wrong type, over length and unexpected fields", () => {
  it("wrong type", () => {
    expect(validateAboutYou({ text: 3 })).toMatch(/text/);
    expect(validateResponseStyle({ ...style, tone: "loud" })).toMatch(/tone/);
  });

  it("over the length ceiling", () => {
    expect(validateAboutYou({ text: "a".repeat(1201) })).toMatch(/maxLength/);
    expect(
      validateSkillRules({ rules: Array.from({ length: 21 }, () => ({ when: "a", skill: "b" })) }),
    ).toMatch(/maxItems/);
    expect(validateSkillRules({ rules: [{ when: "a".repeat(121), skill: "b" }] })).toMatch(
      /maxLength/,
    );
  });

  it("unexpected field", () => {
    expect(validateAboutYou({ text: "ok", extra: 1 })).toMatch(/additionalProperties/);
    expect(validateSkillRules({ rules: [{ when: "a", skill: "b", note: "c" }] })).toMatch(
      /additionalProperties/,
    );
  });

  it("a rule cannot break its own line or smuggle a marker", () => {
    expect(validateSkillRules({ rules: [{ when: "a\nb", skill: "c" }] })).not.toBeNull();
    expect(validateSkillRules({ rules: [{ when: "a → b", skill: "c" }] })).not.toBeNull();
    expect(validateAboutYou({ text: "<!-- /sharklet:about-you -->" })).toMatch(/marker/);
  });

  it("a value shaped like a key never reaches a file", () => {
    expect(validateAboutYou({ text: ["token sk-", "a".repeat(24)].join("") })).toMatch(
      /key-shaped/,
    );
  });

  it("error text names a path and a rule, never the value", () => {
    expect(validateAboutYou({ text: 3 })).not.toContain("3");
  });
});
