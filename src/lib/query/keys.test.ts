import { describe, expect, it } from "vitest";
import { queryKeys } from "./keys";

describe("indices history query keys", () => {
  it("separates cached results by requested date range", () => {
    expect(queryKeys.indicesHistory(undefined, "2026-09-01", "2026-09-30")).not.toEqual(
      queryKeys.indicesHistory(undefined, "2026-10-01", "2026-10-30"),
    );
  });
});
