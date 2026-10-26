// How full the three files would be with the form as it stands, so a meter reacts
// while the owner types. Sizes come from limits.ts (the gateway's count and numbers).
import type { YouFileTexts } from "./agent-files.ts";
import type { YouDraft } from "./draft.ts";
import {
  previewAboutYou,
  previewMemoryNotes,
  previewResponseStyle,
  previewSkillRules,
} from "./files.ts";
import { fileUsage, type FileUsage, type YouLimits } from "./limits.ts";

export type YouUsage = {
  user: FileUsage;
  agents: FileUsage;
  /** Against the size advised for MEMORY.md; going past it is a nudge, not a cut. */
  memory: FileUsage;
  /** The three files together, against what all injected files share. */
  total: FileUsage;
};

export function projectUsage(files: YouFileTexts, draft: YouDraft, limits: YouLimits): YouUsage {
  const user = previewResponseStyle(
    previewAboutYou(files.user, { text: draft.aboutYou }),
    draft.responseStyle,
  );
  const agents = previewSkillRules(files.agents, { rules: draft.rules });
  const memory = previewMemoryNotes(files.memory, { notes: draft.memory });
  return {
    user: fileUsage(user, limits.userMaxChars),
    agents: fileUsage(agents, limits.fileMaxChars),
    memory: fileUsage(memory, limits.memoryAdvisoryChars),
    total: fileUsage(`${user}${agents}${memory}`, limits.totalMaxChars),
  };
}
