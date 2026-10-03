import { expect, test } from "vitest";
import { pruneEmptyRows } from "./financials";

const row = (key: string, values: Array<number | null>, expandable = false) => ({ key, label: key, depth: key.split(".").length - 1, expandable, values });

test("keeps rows with data and their ancestors; drops all-empty branches", () => {
  const rows = [row("a", [null, null], true), row("a.x", [1, 0]), row("a.y", [0, null]), row("b", [null], true), row("b.z", [0])];
  expect(pruneEmptyRows(rows).map((item) => item.key)).toEqual(["a", "a.x"]);
});
