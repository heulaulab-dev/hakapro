import { describe, expect, test } from "vitest";
import { CARD_PAGE, cardLayout, visibleCards } from "./table-cards";

describe("cardLayout", () => {
  test("first column titles the card, the next text column is the subtitle, the rest are fields", () => {
    const layout = cardLayout([{ id: "symbol" }, { id: "name" }, { id: "price", numeric: true }, { id: "pe", numeric: true }]);
    expect(layout).toEqual({ title: "symbol", subtitle: "name", fields: ["price", "pe"] });
  });

  test("a table without a text column after the title has no subtitle", () => {
    expect(cardLayout([{ id: "date" }, { id: "open", numeric: true }, { id: "close", numeric: true }])).toEqual({ title: "date", subtitle: null, fields: ["open", "close"] });
  });

  test("a numeric first column never has a subtitle", () => {
    expect(cardLayout([{ id: "rank", numeric: true }, { id: "name" }, { id: "value", numeric: true }])).toEqual({ title: "rank", subtitle: null, fields: ["name", "value"] });
  });

  test("maxFields caps the label/value pairs", () => {
    expect(cardLayout([{ id: "a" }, { id: "b", numeric: true }, { id: "c", numeric: true }, { id: "d", numeric: true }], { maxFields: 2 }).fields).toEqual(["b", "c"]);
  });

  test("no columns gives an empty layout", () => {
    expect(cardLayout([])).toEqual({ title: null, subtitle: null, fields: [] });
  });
});

describe("visibleCards", () => {
  test("grows by a page and never exceeds the total", () => {
    expect(visibleCards(100, 1)).toBe(CARD_PAGE);
    expect(visibleCards(100, 2)).toBe(CARD_PAGE * 2);
    expect(visibleCards(10, 5)).toBe(10);
    expect(visibleCards(100, 0)).toBe(CARD_PAGE);
  });
});
