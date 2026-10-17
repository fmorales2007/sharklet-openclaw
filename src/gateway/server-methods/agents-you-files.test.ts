// F2-07: what the You page writes through agents.files.set lands in the files the
// runtime reads, per agent, and reaches the next prompt. Real handler, real
// temp workspaces; the section text comes from the page's own serializers.
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useAutoCleanupTempDirTracker } from "../../../test/helpers/temp-dir.js";
import {
  applyAboutYou,
  applyResponseStyle,
  applySkillRules,
  USER_FILE_MAX_CHARS,
} from "../../../ui/src/lib/you/files.ts";
import { buildBootstrapContextFiles } from "../../agents/embedded-agent-helpers/bootstrap.js";
import { buildAgentSystemPrompt } from "../../agents/system-prompt.js";
import { loadWorkspaceBootstrapFiles } from "../../agents/workspace.js";
import { agentsHandlers } from "./agents.js";

type HandlerCall = { ok: boolean; payload?: unknown; error?: unknown };

describe("You page → agent files", () => {
  const tempDirs = useAutoCleanupTempDirTracker(afterEach);
  let workspaces: Record<string, string>;

  beforeEach(() => {
    workspaces = {
      main: fs.realpathSync(tempDirs.make("openclaw-you-main-")),
      writer: fs.realpathSync(tempDirs.make("openclaw-you-writer-")),
      other: fs.realpathSync(tempDirs.make("openclaw-you-other-")),
    };
  });

  async function call(
    method: "agents.files.get" | "agents.files.set",
    params: Record<string, unknown>,
  ): Promise<HandlerCall> {
    const calls: HandlerCall[] = [];
    await agentsHandlers[method]?.({
      req: { type: "req", id: method, method, params: {} },
      params,
      client: null,
      isWebchatConnect: () => false,
      respond: (ok, payload, error) => {
        calls.push({ ok, payload, error });
      },
      context: {
        getRuntimeConfig: () => ({
          agents: {
            defaults: { workspace: workspaces.main },
            list: [
              { id: "main", default: true, workspace: workspaces.main },
              { id: "writer", workspace: workspaces.writer },
              { id: "other", workspace: workspaces.other },
            ],
          },
        }),
      } as never,
    });
    expect(calls).toHaveLength(1);
    return calls[0] as HandlerCall;
  }

  async function read(agentId: string, name: string): Promise<string> {
    const got = await call("agents.files.get", { agentId, name });
    return (got.payload as { file: { content?: string } }).file.content ?? "";
  }

  /** What the page does for one section: read, apply, write with the hash it read. */
  async function saveSection(
    agentId: string,
    name: "USER.md" | "AGENTS.md",
    apply: (content: string) => { ok: boolean; value?: string },
  ) {
    const got = await call("agents.files.get", { agentId, name });
    const file = (got.payload as { file: { content?: string; hash?: string } }).file;
    const next = apply(file.content ?? "");
    expect(next.ok).toBe(true);
    const set = await call("agents.files.set", {
      agentId,
      name,
      content: next.value,
      ...(file.hash ? { expectedHash: file.hash } : {}),
    });
    expect(set.ok).toBe(true);
  }

  it("global writes USER.md into each chosen agent's own workspace and no other", async () => {
    for (const agentId of ["main", "writer"]) {
      await saveSection(agentId, "USER.md", (c) => applyAboutYou(c, { text: "I run a bakery." }));
    }
    expect(fs.readFileSync(path.join(workspaces.main, "USER.md"), "utf8")).toContain(
      "I run a bakery.",
    );
    expect(fs.readFileSync(path.join(workspaces.writer, "USER.md"), "utf8")).toContain(
      "I run a bakery.",
    );
    expect(fs.existsSync(path.join(workspaces.other, "USER.md"))).toBe(false);
  });

  it("refuses a USER.md write past the bootstrap cap and writes nothing", async () => {
    const tooLong = await call("agents.files.set", {
      agentId: "main",
      name: "USER.md",
      content: "x".repeat(USER_FILE_MAX_CHARS + 1),
    });
    expect(tooLong.ok).toBe(false);
    expect(fs.existsSync(path.join(workspaces.main, "USER.md"))).toBe(false);

    const exact = await call("agents.files.set", {
      agentId: "main",
      name: "USER.md",
      content: "x".repeat(USER_FILE_MAX_CHARS),
    });
    expect(exact.ok).toBe(true);
  });

  it("refuses names outside the workspace allowlist and unexpected fields", async () => {
    const traversal = await call("agents.files.set", {
      agentId: "main",
      name: "../escape.md",
      content: "x",
    });
    expect(traversal.ok).toBe(false);
    expect(fs.existsSync(path.join(workspaces.main, "..", "escape.md"))).toBe(false);
    const extra = await call("agents.files.set", {
      agentId: "main",
      name: "USER.md",
      content: "x",
      mode: "append",
    });
    expect(extra.ok).toBe(false);
  });

  it("a saved Response style and a Skill rule reach the next system prompt", async () => {
    await saveSection("main", "USER.md", (c) =>
      applyResponseStyle(c, { tone: "formal", length: "brief", notes: "Sign off with Regards." }),
    );
    await saveSection("main", "AGENTS.md", (c) =>
      applySkillRules(c, { rules: [{ when: "propose a project", skill: "grilling" }] }),
    );

    // The turn after the save: load the workspace as the runner does, build the prompt.
    const bootstrap = await loadWorkspaceBootstrapFiles(workspaces.main);
    const contextFiles = buildBootstrapContextFiles(bootstrap);
    const prompt = buildAgentSystemPrompt({ workspaceDir: workspaces.main, contextFiles });

    expect(prompt).toContain("- Tone: formal");
    expect(prompt).toContain("- Length: brief");
    expect(prompt).toContain("Sign off with Regards.");
    expect(prompt).toContain("- When I propose a project → use grilling");
    expect(await read("main", "USER.md")).toContain("- Tone: formal");
  });

  it("changing the tone changes the next prompt and the old tone is gone", async () => {
    const promptFor = async () => {
      const bootstrap = await loadWorkspaceBootstrapFiles(workspaces.main);
      return buildAgentSystemPrompt({
        workspaceDir: workspaces.main,
        contextFiles: buildBootstrapContextFiles(bootstrap),
      });
    };
    await saveSection("main", "USER.md", (c) =>
      applyResponseStyle(c, { tone: "formal", length: "brief", notes: "" }),
    );
    expect(await promptFor()).toContain("- Tone: formal");
    await saveSection("main", "USER.md", (c) =>
      applyResponseStyle(c, { tone: "warm", length: "brief", notes: "" }),
    );
    const after = await promptFor();
    expect(after).toContain("- Tone: warm");
    expect(after).not.toContain("- Tone: formal");
  });
});
