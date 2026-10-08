import { describe, expect, it } from "vitest";
import { normalizeTypefaceOverride } from "./typography.ts";

describe("typeface preference", () => {
  it("accepts wire typeface ids", () => {
    expect(normalizeTypefaceOverride("lora")).toBe("lora");
  });

  it.each(["theme", "unknown", "Lora", "serif; color: red", null, {}, 42])(
    "ignores invalid override %j",
    (value) => {
      expect(normalizeTypefaceOverride(value)).toBeUndefined();
    },
  );
});
