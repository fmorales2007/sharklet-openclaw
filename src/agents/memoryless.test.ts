// F2-09: a Memory-less chat neither reads nor writes memory (ADR-006 section 7). This module
// owns the list of memory tools and the rule for which files count as memory.
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  isMemorylessEntry,
  MEMORYLESS_DENIED_TOOL_NAMES,
  memorylessToolBlockReason,
} from "./memoryless.js";

const workspaceDir = path.join(os.tmpdir(), "openclaw-memoryless-ws");
const block = (toolName: string, toolParams: unknown) =>
  memorylessToolBlockReason({ toolName, toolParams, workspaceDir });

describe("memorylessToolBlockReason", () => {
  it.each(MEMORYLESS_DENIED_TOOL_NAMES)("blocks the memory tool %s by name", (toolName) => {
    expect(block(toolName, {})).toMatch(/Memory-less/);
  });

  it("names the plugins' memory tools in one list", () => {
    expect(MEMORYLESS_DENIED_TOOL_NAMES).toEqual(
      expect.arrayContaining(["memory_search", "memory_get", "memory_store", "wiki_apply"]),
    );
  });

  it.each([
    ["write", { path: "MEMORY.md", content: "x" }],
    ["write", { path: "memory\\x.md", content: "x" }],
    ["edit", { path: "memory/2026-10-20.md", oldText: "a", newText: "b" }],
    ["write", { file_path: "DREAMS.md", content: "x" }],
    ["write", { path: path.join(workspaceDir, "MEMORY.md"), content: "x" }],
    [
      "apply_patch",
      { input: "*** Begin Patch\n*** Update File: MEMORY.md\n@@\n-a\n+b\n*** End Patch" },
    ],
  ])("blocks %s into memory files (%j)", (toolName, toolParams) => {
    expect(block(toolName, toolParams)).toMatch(/Memory-less/);
  });

  it.each([
    ["write", { path: "notes.md", content: "x" }],
    ["edit", { path: "USER.md", oldText: "a", newText: "b" }],
    ["read", { path: "MEMORY.md" }],
    ["write", { path: path.join(os.tmpdir(), "elsewhere", "MEMORY.md"), content: "x" }],
    ["exec", { command: "ls" }],
  ])("lets %s through when it is not a memory write (%j)", (toolName, toolParams) => {
    expect(block(toolName, toolParams)).toBeUndefined();
  });
});

describe("isMemorylessEntry", () => {
  it("is true only for an entry marked at creation", () => {
    expect(isMemorylessEntry({ memoryless: true })).toBe(true);
    expect(isMemorylessEntry({})).toBe(false);
    expect(isMemorylessEntry(undefined)).toBe(false);
  });
});

// ADR-006 §7 / F2-09 decision 3: memory-core's "sessions" source indexes transcripts without
// reading session entries (incognito is not excluded there either), so excluding Memory-less
// transcripts needs a new SDK surface. Deferred to F2-16, which already skips Memory-less for dreaming.
describe("memory-core sessions source", () => {
  it.skip("does not index transcripts of Memory-less sessions (F2-16)", () => {});
});
