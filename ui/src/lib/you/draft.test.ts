import { describe, expect, it } from "vitest";
import { draftFromSnapshot, draftProblems, planIsEmpty, planSave } from "./draft.ts";

const snapshot = {
  agentId: "main",
  aboutYou: { text: "I run a bakery." },
  responseStyle: { tone: "direct", length: "balanced", notes: "" },
  skillRules: { rules: [{ when: "plan", skill: "grilling" }] },
  memory: { notes: "" },
} as const;

const base = draftFromSnapshot(structuredClone(snapshot) as never, {
  model: "openai/gpt-5.5",
  effort: "medium",
});
const say = (key: string) => key;

describe("planSave", () => {
  it("an untouched draft plans nothing", () => {
    expect(planIsEmpty(planSave(base, structuredClone(base)))).toBe(true);
  });

  it("plans only the sections that moved", () => {
    const draft = structuredClone(base);
    draft.responseStyle.tone = "formal";
    const plan = planSave(base, draft);
    expect(plan.changes.map((c) => c.section)).toEqual(["response-style"]);
    expect(plan.defaults).toBeNull();
  });

  it("whitespace-only edits are not changes", () => {
    const draft = { ...structuredClone(base), aboutYou: "  I run a bakery.  " };
    expect(planIsEmpty(planSave(base, draft))).toBe(true);
  });

  it("clearing a Default sends null so the override is removed", () => {
    const draft = { ...structuredClone(base), model: " ", effort: "" };
    expect(planSave(base, draft).defaults).toEqual({ model: null, effort: null });
  });

  it("editing a rule plans Skill rules only", () => {
    const draft = structuredClone(base);
    draft.rules[0]!.skill = "tdd";
    expect(planSave(base, draft).changes.map((c) => c.section)).toEqual(["skill-rules"]);
  });
});

describe("draftProblems", () => {
  it("is clean for a loaded draft", () => {
    expect(draftProblems(base, say)).toEqual({});
  });

  it("flags a half-written rule, over-long text and key-shaped text", () => {
    const draft = structuredClone(base);
    draft.rules.push({ when: "", skill: "" });
    draft.aboutYou = "x".repeat(1201);
    draft.memory = ["note sk-", "b".repeat(24)].join("");
    expect(Object.keys(draftProblems(draft, say)).toSorted()).toEqual(["about", "memory", "rules"]);
  });
});
