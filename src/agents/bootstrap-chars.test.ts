// F2-08: the You page shows how full each file is. It must count the way the gateway
// does, or a meter could read "fits" for text the runtime then truncates.
import { describe, expect, it } from "vitest";
import { buildBootstrapInjectionStats } from "./bootstrap-budget.js";
import { bootstrapContentChars } from "./bootstrap-chars.js";

const SAMPLES = [
  "",
  "plain ascii",
  "trailing spaces and newlines  \n\n",
  "  leading whitespace is kept",
  "emoji 😀 counts as two UTF-16 units",
  "accents: ñandú, café, año",
  "line one\r\nline two\r\n",
  "x".repeat(4_321),
];

describe("bootstrapContentChars", () => {
  it.each(SAMPLES)("matches the gateway's own count for %j", (content) => {
    const [stat] = buildBootstrapInjectionStats({
      bootstrapFiles: [{ name: "USER.md", path: "/w/USER.md", content, missing: false }],
      injectedFiles: [],
    } as never);
    expect(bootstrapContentChars(content)).toBe(stat?.rawChars);
  });
});
