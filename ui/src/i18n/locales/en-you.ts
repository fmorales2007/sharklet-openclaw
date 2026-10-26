import type { TranslationMap } from "../lib/types.ts";
import { en } from "./en.ts";

const enYou = {
  youPage: {
    save: "Save changes",
    saving: "Saving",
    retry: "Try again",
    count: "{used} of {max} characters",
    loadFailed: "Couldn't load {agent}'s settings. Check the connection, then try again.",
    saved: {
      one: "Saved to {agent}",
      many: "Saved to {count} agents",
    },
    failed: {
      changed:
        "{agent}: the file changed while you were editing. Reload the page, then save again.",
      invalid: "{agent}: this doesn't fit in the file. Shorten the text, then save again.",
      rpc: "{agent}: {reason}",
    },
    problems: {
      about: "Keep this under 1,200 characters and don't paste keys or tokens.",
      style: "Keep the notes under 400 characters and don't paste keys or tokens.",
      rules: "Finish or remove each rule. Use one line each, with no arrows.",
      memory: "Keep this under 6,000 characters and don't paste keys or tokens.",
      model: "Use a model name under 256 characters.",
    },
    scope: {
      title: "Whose settings",
      description: "Each agent keeps its own copy. Pick the agents this save should reach.",
      agent: "Agent",
      agentHint: "The settings shown below.",
      also: "Also save to",
      alsoHint: "Writes the same changes to these agents' files.",
    },
    context: {
      title: "What this agent reads",
      description:
        "Switch a piece off to leave it out of this agent's chats. The text stays in its file.",
      pieces: {
        aboutYou: { title: "About you", description: "From USER.md" },
        responseStyle: { title: "Response style", description: "From USER.md" },
        skillRules: { title: "Skill rules", description: "From AGENTS.md" },
        memory: { title: "Memory", description: "From MEMORY.md" },
      },
      switchedOn: "{agent} reads {piece} again",
      switchedOff: "{agent} no longer reads {piece}",
      switchFailed: "Couldn't change this for {agent}. Check the connection, then try again.",
      size: {
        title: "How full the files are",
        description: "Agents read only what fits. These sizes come from the gateway.",
        used: "{used} of {max} characters",
        files: {
          user: "USER.md",
          agents: "AGENTS.md",
          memory: "MEMORY.md",
          total: "All three together",
        },
        near: "{file} is nearly full. Trim it before it passes the limit.",
        over: "{file} is over its limit. The end of it won't reach the agent.",
        memoryOver: "MEMORY.md is past the size we advise. Shorter notes keep chats focused.",
        totalOver:
          "Together these files pass what an agent reads at the start. Trim the longest one.",
      },
    },
    about: {
      title: "About you",
      description: "Who you are and what you do. Agents read this at the start of every chat.",
      label: "About you",
      placeholder: "I run a small bakery in Santiago and write in Spanish and English.",
    },
    style: {
      title: "Response style",
      description: "How agents should write back to you.",
      tone: "Tone",
      length: "Length",
      notes: "Other preferences",
      notesPlaceholder: "Sign off with my first name.",
      tones: { direct: "Direct", warm: "Warm", formal: "Formal" },
      lengths: { brief: "Brief", balanced: "Balanced", detailed: "Detailed" },
    },
    rules: {
      title: "Skill rules",
      description: "Tell agents which skill to reach for, and when.",
      when: "When I",
      whenPlaceholder: "propose a project",
      whenLabel: "Rule {n}: when I",
      use: "use",
      skillPlaceholder: "grilling",
      skillLabel: "Rule {n}: skill",
      add: "Add rule",
      remove: "Remove rule {n}",
      removeShort: "Remove",
      empty: "No rules yet. Add one so an agent picks a skill without being asked.",
    },
    memory: {
      title: "Memory",
      description: "Notes every chat starts with. Agents can add their own beside yours.",
      label: "Memory notes",
      placeholder: "My birthday is May 3.",
    },
    defaults: {
      title: "Defaults",
      description: "The model and effort new chats start with.",
      model: "Model",
      modelHint: "Leave empty to use the gateway default.",
      modelPlaceholder: "openai/gpt-5.5",
      effort: "Effort",
      effortHint: "How much the model thinks before it answers.",
      effortInherit: "Model default",
      levels: { off: "Off", minimal: "Minimal", low: "Low", medium: "Medium", high: "High" },
    },
  },
} satisfies TranslationMap;

export const registerYouEnglish = Object.assign(
  () => {
    // The You page loads its copy lazily; its tab title and subtitle stay in en.ts.
    en.youPage = enYou.youPage;
  },
  { catalog: enYou },
);
