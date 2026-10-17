// You page draft (F2-07): the form's values, what changed against what the files
// held, and what stops a save. Pure, so the page stays a thin shell.
import type { YouChange, YouSnapshot } from "./agent-files.ts";
import {
  validateAboutYou,
  validateMemoryNotes,
  validateResponseStyle,
  validateSkillRules,
  type ResponseStyle,
  type SkillRule,
} from "./files.ts";

export type YouDraft = {
  aboutYou: string;
  responseStyle: ResponseStyle;
  rules: SkillRule[];
  memory: string;
  /** provider/model, empty for "use the gateway default". */
  model: string;
  /** Thinking level id, empty for "use the model's own policy". */
  effort: string;
};

export function draftFromSnapshot(
  snapshot: YouSnapshot,
  defaults: { model: string | null; effort: string | null },
): YouDraft {
  return {
    aboutYou: snapshot.aboutYou.text,
    responseStyle: { ...snapshot.responseStyle },
    rules: snapshot.skillRules.rules.map((rule) => ({ ...rule })),
    memory: snapshot.memory.notes,
    model: defaults.model ?? "",
    effort: defaults.effort ?? "",
  };
}

/** What a save sends: only the sections whose values moved. `defaults` null = none moved. */
export type YouPlan = {
  changes: YouChange[];
  defaults: { model?: string | null; effort?: string | null } | null;
};

const sameRules = (a: SkillRule[], b: SkillRule[]) =>
  a.length === b.length && a.every((r, i) => r.when === b[i]?.when && r.skill === b[i]?.skill);

export function planSave(base: YouDraft, draft: YouDraft): YouPlan {
  const changes: YouChange[] = [];
  if (draft.aboutYou.trim() !== base.aboutYou.trim()) {
    changes.push({ section: "about-you", value: { text: draft.aboutYou } });
  }
  const a = base.responseStyle;
  const b = draft.responseStyle;
  if (a.tone !== b.tone || a.length !== b.length || a.notes.trim() !== b.notes.trim()) {
    changes.push({ section: "response-style", value: { ...b } });
  }
  if (!sameRules(base.rules, draft.rules)) {
    changes.push({ section: "skill-rules", value: { rules: draft.rules } });
  }
  if (draft.memory.trim() !== base.memory.trim()) {
    changes.push({ section: "memory", value: { notes: draft.memory } });
  }
  const model = draft.model.trim();
  const defaults: NonNullable<YouPlan["defaults"]> = {};
  if (model !== base.model.trim()) {
    defaults.model = model || null;
  }
  if (draft.effort !== base.effort) {
    defaults.effort = draft.effort || null;
  }
  return { changes, defaults: Object.keys(defaults).length ? defaults : null };
}

export const planIsEmpty = (plan: YouPlan) => plan.changes.length === 0 && plan.defaults === null;

/** Section ids (as the view names them) mapped to why the draft cannot be saved. */
export function draftProblems(draft: YouDraft, t: (key: string) => string) {
  const problems: Record<string, string> = {};
  if (validateAboutYou({ text: draft.aboutYou })) {
    problems.about = t("youPage.problems.about");
  }
  if (validateResponseStyle(draft.responseStyle)) {
    problems.style = t("youPage.problems.style");
  }
  if (validateSkillRules({ rules: draft.rules })) {
    problems.rules = t("youPage.problems.rules");
  }
  if (validateMemoryNotes({ notes: draft.memory })) {
    problems.memory = t("youPage.problems.memory");
  }
  if (draft.model.trim().length > 256) {
    problems.model = t("youPage.problems.model");
  }
  return problems;
}
