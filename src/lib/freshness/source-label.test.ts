import { describe, expect, test } from "vitest";
import { ENGINE_SOURCE_LABEL, sourceLabel } from "./index";

describe("sourceLabel (HAKA-72)", () => {
  test("engine lanes collapse to the one product name, never the upstream", () => {
    expect(sourceLabel("arjum")).toBe(ENGINE_SOURCE_LABEL);
    expect(sourceLabel("idx-bei")).toBe(ENGINE_SOURCE_LABEL);
    expect(sourceLabel("arjum")).not.toContain("arjum");
  });

  test("fixture lanes (dev/test only) pass through so they stay recognizable", () => {
    expect(sourceLabel("fixture:arjum")).toBe("fixture:arjum");
    expect(sourceLabel("fixture")).toBe("fixture");
  });

  test("real dataset names and 'none' pass through unchanged", () => {
    expect(sourceLabel("ksei-2026-02")).toBe("ksei-2026-02");
    expect(sourceLabel("none")).toBe("none");
  });
});
