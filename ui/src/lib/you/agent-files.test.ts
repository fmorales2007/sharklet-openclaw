import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { readYou, saveYouSection } from "./agent-files.ts";

const sha = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

type Files = Record<string, Record<string, string>>;
type Request = (method: string, params: Record<string, unknown>) => Promise<unknown>;

/** A gateway that keeps each agent's files and enforces expectedHash like the real one. */
function fakeGateway(initial: Files) {
  const files: Files = structuredClone(initial);
  const calls: { method: string; params: Record<string, unknown> }[] = [];
  const request: Request = async (method, params) => {
    calls.push({ method, params });
    const agentId = params.agentId as string;
    const name = params.name as string;
    const content = files[agentId]?.[name];
    if (method === "agents.files.get") {
      return {
        agentId,
        workspace: "/ws",
        file:
          content === undefined
            ? { name, path: `/ws/${name}`, missing: true }
            : { name, path: `/ws/${name}`, missing: false, content, hash: sha(content) },
      };
    }
    if (params.expectedHash && params.expectedHash !== (content ? sha(content) : undefined)) {
      throw Object.assign(new Error(`agent file "${name}" changed since it was read`), {
        code: "INVALID_REQUEST",
      });
    }
    (files[agentId] ??= {})[name] = params.content as string;
    return {
      ok: true,
      agentId,
      workspace: "/ws",
      file: { name, path: `/ws/${name}`, missing: false, content: params.content },
    };
  };
  return { client: { request } as never, request, files, calls };
}

describe("readYou", () => {
  it("reads the sections from the three files; missing files give the defaults", async () => {
    const { client } = fakeGateway({
      main: {
        "AGENTS.md":
          "<!-- sharklet:skill-rules -->\n- When I plan → use grilling\n<!-- /sharklet:skill-rules -->",
      },
    });
    const result = await readYou(client, "main");
    expect(result.ok && result.value.skillRules.rules).toEqual([
      { when: "plan", skill: "grilling" },
    ]);
    expect(result.ok && result.value.responseStyle.tone).toBe("direct");
  });
});

describe("saveYouSection", () => {
  it("writes Response style to USER.md and Skill rules to AGENTS.md, nothing else", async () => {
    const gw = fakeGateway({ main: { "USER.md": "# USER\n", "AGENTS.md": "# AGENTS\n" } });
    await saveYouSection(gw.client, ["main"], {
      section: "response-style",
      value: { tone: "formal", length: "detailed", notes: "" },
    });
    await saveYouSection(gw.client, ["main"], {
      section: "skill-rules",
      value: { rules: [{ when: "propose a project", skill: "grilling" }] },
    });
    expect(gw.files.main["USER.md"]).toContain("- Tone: formal");
    expect(gw.files.main["AGENTS.md"]).toContain("- When I propose a project → use grilling");
    expect(gw.files.main["MEMORY.md"]).toBeUndefined();
    const written = gw.calls
      .filter((c) => c.method === "agents.files.set")
      .map((c) => c.params.name);
    expect(written).toEqual(["USER.md", "AGENTS.md"]);
  });

  it("global writes the same section into each chosen agent and only those", async () => {
    const gw = fakeGateway({ a: { "USER.md": "# A\n" }, b: {}, c: { "USER.md": "# C\n" } });
    const outcomes = await saveYouSection(gw.client, ["a", "b"], {
      section: "about-you",
      value: { text: "Works nights." },
    });
    expect(outcomes.map((o) => [o.agentId, o.result.ok])).toEqual([
      ["a", true],
      ["b", true],
    ]);
    expect(gw.files.a["USER.md"]).toContain("Works nights.");
    expect(gw.files.b["USER.md"]).toContain("Works nights.");
    expect(gw.files.c["USER.md"]).toBe("# C\n");
  });

  it("sends the hash it read, and reports a file that changed under it", async () => {
    const gw = fakeGateway({ main: { "MEMORY.md": "# M\n" } });
    const raceClient = {
      request: async (method: string, params: Record<string, unknown>) => {
        const result = await gw.request(method, params);
        if (method === "agents.files.get") {
          gw.files.main["MEMORY.md"] += "agent wrote this\n";
        }
        return result;
      },
    } as never;
    const [outcome] = await saveYouSection(raceClient, ["main"], {
      section: "memory",
      value: { notes: "mine" },
    });
    expect(!outcome.result.ok && outcome.result.error.kind).toBe("changed");
    expect(gw.files.main["MEMORY.md"]).toBe("# M\nagent wrote this\n");
  });

  it("a bad value stops before any write", async () => {
    const gw = fakeGateway({ a: {} });
    const [bad] = await saveYouSection(gw.client, ["a"], {
      section: "about-you",
      value: { text: 1 } as never,
    });
    expect(!bad.result.ok && bad.result.error.kind).toBe("invalid");
    expect(gw.calls.some((c) => c.method === "agents.files.set")).toBe(false);
  });

  it("refuses over-long content before it leaves the browser", async () => {
    const gw = fakeGateway({ main: { "AGENTS.md": "x".repeat(19_990) } });
    const [outcome] = await saveYouSection(gw.client, ["main"], {
      section: "skill-rules",
      value: { rules: [{ when: "plan something big", skill: "grilling" }] },
    });
    expect(outcome.result.ok).toBe(false);
    expect(gw.calls.some((c) => c.method === "agents.files.set")).toBe(false);
  });
});
