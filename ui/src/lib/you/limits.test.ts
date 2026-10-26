import { describe, expect, it } from "vitest";
import { bootstrapContentChars } from "../../../../src/agents/bootstrap-chars.ts";
import { applyAboutYou, applyMemoryNotes, applySkillRules } from "./files.ts";
import { fileUsage, type YouLimits } from "./limits.ts";

const LIMITS: YouLimits = {
  fileMaxChars: 400,
  totalMaxChars: 1_000,
  userMaxChars: 120,
  memoryAdvisoryChars: 60,
};

describe("fileUsage", () => {
  it("counts with the gateway's function and reports how full the file is", () => {
    const content = "abc 😀 \n\n";
    const usage = fileUsage(content, 10);
    expect(usage.chars).toBe(bootstrapContentChars(content));
    expect(usage).toMatchObject({ limit: 10, over: false });
    expect(usage.ratio).toBeCloseTo(usage.chars / 10);
  });

  it("warns near the limit and flags text past it", () => {
    expect(fileUsage("x".repeat(84), 100)).toMatchObject({ near: false, over: false });
    expect(fileUsage("x".repeat(85), 100)).toMatchObject({ near: true, over: false });
    expect(fileUsage("x".repeat(101), 100)).toMatchObject({ near: true, over: true });
  });
});

describe("saving against the limits the gateway reported", () => {
  it("refuses USER.md text past the user limit it was given", () => {
    const ok = applyAboutYou("", { text: "short" }, LIMITS);
    expect(ok.ok).toBe(true);
    const bad = applyAboutYou("", { text: "y".repeat(200) }, LIMITS);
    expect(bad.ok).toBe(false);
  });

  it("uses the per-file limit for AGENTS.md and MEMORY.md", () => {
    const rules = {
      rules: Array.from({ length: 5 }, (_, i) => ({
        when: `case number ${i}`,
        skill: `skill-${i}`,
      })),
    };
    expect(applySkillRules("", rules, { ...LIMITS, fileMaxChars: 50 }).ok).toBe(false);
    expect(applySkillRules("", rules, LIMITS).ok).toBe(true);
    expect(applyMemoryNotes("", { notes: "n".repeat(300) }, LIMITS).ok).toBe(true);
    expect(applyMemoryNotes("", { notes: "n".repeat(500) }, LIMITS).ok).toBe(false);
  });
});
