import { describe, expect, test } from "vitest";
import { authErrorKey } from "./errors";
import { safeNextPath } from "./redirect";

const L = ["id", "en"] as const;

describe("safeNextPath", () => {
  test.each([
    ["/id/stock/BBCA", "/id/stock/BBCA"],
    ["/en/discover/strategies/akumulasi-senyap?why=SOCI", "/en/discover/strategies/akumulasi-senyap?why=SOCI"],
    ["/id/reset-password", "/id/reset-password"],
  ])("keeps %s", (input, expected) => expect(safeNextPath(input, "id", L)).toBe(expected));

  test.each([null, "", "https://evil.example/id", "//evil.example/id", "/\\evil.example", "/fr/stock/BBCA", "stock/BBCA", "/id/login", "/en/signup?x=1", "/id/\u0000"])("rejects %j", (input) => {
    expect(safeNextPath(input, "id", L)).toBe("/id");
  });
});

test("auth error mapping never passes provider text through", () => {
  expect(authErrorKey({ code: "invalid_credentials", message: "Invalid login credentials" })).toBe("invalid_credentials");
  expect(authErrorKey({ code: "email_exists" })).toBe("user_already_exists");
  expect(authErrorKey({ code: "something_new", message: "raw provider text" })).toBe("default");
  expect(authErrorKey(new Error("x"))).toBe("default");
});
