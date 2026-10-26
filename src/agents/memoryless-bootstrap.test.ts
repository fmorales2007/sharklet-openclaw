// F2-09: MEMORY.md is not part of a Memory-less chat's context; About you and Response
// style (USER.md), Skill rules (AGENTS.md) and the rest stay.
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { filterBootstrapFilesForSession, type WorkspaceBootstrapFile } from "./workspace.js";

const workspaceDir = path.join(os.tmpdir(), "openclaw-memoryless-bootstrap");
const file = (name: string): WorkspaceBootstrapFile =>
  ({ name, path: path.join(workspaceDir, name), content: `${name} text`, missing: false }) as never;
const FILES = ["AGENTS.md", "SOUL.md", "USER.md", "MEMORY.md"].map(file);
const names = (files: WorkspaceBootstrapFile[]) => files.map((entry) => entry.name);

describe("filterBootstrapFilesForSession and Memory-less", () => {
  const direct = { sessionKey: "agent:main:main", chatType: "direct" as const, workspaceDir };

  it("keeps MEMORY.md in an ordinary private chat", () => {
    expect(names(filterBootstrapFilesForSession(FILES, direct))).toContain("MEMORY.md");
  });

  it("drops MEMORY.md and keeps the personal context files in a Memory-less chat", () => {
    const kept = names(filterBootstrapFilesForSession(FILES, { ...direct, memoryless: true }));
    expect(kept).not.toContain("MEMORY.md");
    expect(kept).toEqual(expect.arrayContaining(["AGENTS.md", "SOUL.md", "USER.md"]));
  });
});
