// F2-08: each piece of personal context has a switch per agent, and the size limits the
// You page draws come from the same functions the runtime truncates with.
import fs from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { useAutoCleanupTempDirTracker } from "../../test/helpers/temp-dir.js";
import { writeBlock } from "../../ui/src/lib/you/files.ts";
import type { OpenClawConfig } from "../config/types.openclaw.js";
import { resolveBootstrapFilesForRun } from "./bootstrap-files.js";
import {
  resolveBootstrapMaxChars,
  resolveBootstrapTotalMaxChars,
  USER_BOOTSTRAP_MAX_CHARS,
} from "./embedded-agent-helpers/bootstrap.js";
import {
  resolveBootstrapLimits,
  resolvePersonalContextToggles,
  withoutDisabledPersonalContext,
} from "./personal-context.js";

describe("personal context switches", () => {
  const tempDirs = useAutoCleanupTempDirTracker(afterEach);

  const userMd = () =>
    writeBlock(
      writeBlock("# USER\nhand-written line\n", "about-you", "## About you\nI run a bakery."),
      "response-style",
      "## Response style\n- Tone: warm\n- Length: brief",
    );
  const agentsMd = () =>
    writeBlock(
      "# AGENTS\nhand-written rule\n",
      "skill-rules",
      "## Skill rules\n- When I propose a project → use grilling",
    );

  function workspace(prefix: string) {
    const dir = fs.realpathSync(tempDirs.make(prefix));
    fs.writeFileSync(`${dir}/USER.md`, userMd());
    fs.writeFileSync(`${dir}/AGENTS.md`, agentsMd());
    return dir;
  }

  const contentOf = (files: { name: string; content?: string }[], name: string) =>
    files.find((file) => file.name === name)?.content ?? "";

  it("defaults every piece to on and reads each agent's own switches", () => {
    const cfg = {
      agents: {
        list: [
          { id: "main", default: true, personalContext: { aboutYou: false, memory: false } },
          { id: "writer" },
        ],
      },
    } as unknown as OpenClawConfig;

    expect(resolvePersonalContextToggles(cfg, "main")).toEqual({
      aboutYou: false,
      responseStyle: true,
      skillRules: true,
      memory: false,
    });
    expect(resolvePersonalContextToggles(cfg, "writer")).toEqual({
      aboutYou: true,
      responseStyle: true,
      skillRules: true,
      memory: true,
    });
  });

  it("removes only the marked block of a switched-off piece and leaves the rest of the file", () => {
    const files = [
      { name: "USER.md", path: "/w/USER.md", content: userMd(), missing: false },
      { name: "AGENTS.md", path: "/w/AGENTS.md", content: agentsMd(), missing: false },
    ] as never;

    const result = withoutDisabledPersonalContext(files, {
      aboutYou: false,
      responseStyle: true,
      skillRules: false,
      memory: true,
    }) as { name: string; content: string }[];

    expect(contentOf(result, "USER.md")).not.toContain("bakery");
    expect(contentOf(result, "USER.md")).toContain("Tone: warm");
    expect(contentOf(result, "USER.md")).toContain("hand-written line");
    expect(contentOf(result, "AGENTS.md")).not.toContain("grilling");
    expect(contentOf(result, "AGENTS.md")).toContain("hand-written rule");
  });

  it("takes a piece out of one agent's prompt context and not another's", async () => {
    const main = workspace("openclaw-ctx-main-");
    const writer = workspace("openclaw-ctx-writer-");
    const config = {
      agents: {
        defaults: { workspace: main },
        list: [
          {
            id: "main",
            default: true,
            workspace: main,
            personalContext: { aboutYou: false, skillRules: false },
          },
          { id: "writer", workspace: writer },
        ],
      },
    } as unknown as OpenClawConfig;

    const forMain = await resolveBootstrapFilesForRun({
      workspaceDir: main,
      config,
      agentId: "main",
      sessionKey: "agent:main:main",
    });
    const forWriter = await resolveBootstrapFilesForRun({
      workspaceDir: writer,
      config,
      agentId: "writer",
      sessionKey: "agent:writer:main",
    });

    expect(contentOf(forMain, "USER.md")).not.toContain("bakery");
    expect(contentOf(forMain, "USER.md")).toContain("Tone: warm");
    expect(contentOf(forMain, "AGENTS.md")).not.toContain("grilling");
    expect(contentOf(forWriter, "USER.md")).toContain("bakery");
    expect(contentOf(forWriter, "AGENTS.md")).toContain("grilling");
  });
});

describe("bootstrap limits for the You page", () => {
  it("are the limits the runtime truncates with, including a per-agent override", () => {
    const cfg = {
      agents: {
        defaults: { bootstrapMaxChars: 12_000, bootstrapTotalMaxChars: 40_000 },
        list: [
          { id: "main", default: true },
          { id: "big", bootstrapMaxChars: 30_000 },
        ],
      },
    } as unknown as OpenClawConfig;

    expect(resolveBootstrapLimits(cfg, "main")).toEqual({
      fileMaxChars: resolveBootstrapMaxChars(cfg, "main"),
      totalMaxChars: resolveBootstrapTotalMaxChars(cfg, "main"),
      userMaxChars: USER_BOOTSTRAP_MAX_CHARS,
      memoryAdvisoryChars: 3072,
    });
    expect(resolveBootstrapLimits(cfg, "big").fileMaxChars).toBe(30_000);
    expect(resolveBootstrapLimits(cfg, "big").totalMaxChars).toBe(40_000);
  });
});
