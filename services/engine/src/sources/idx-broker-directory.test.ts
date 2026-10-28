import { describe, expect, it } from "vitest";
import fixture from "./fixtures/idx-broker-directory.2026-08-07.json";
import { idxBrokerDirectoryParams, parseIdxBrokerDirectory } from "./idx-broker-directory";

describe("IDX exchange member directory", () => {
  it("builds the verified request and normalizes official member records", () => {
    expect(idxBrokerDirectoryParams()).toEqual({ option: 0, license: "", start: 0, length: 9999 });
    const parsed = parseIdxBrokerDirectory(fixture);
    expect(parsed.rows[0]).toMatchObject({ code: "XC", name: "AJAIB SEKURITAS ASIA", license: "Penjamin Emisi Efek, Perantara Pedagang Efek" });
    expect(parsed.rows).toHaveLength(3);
    expect(parsed.complete).toBe(false); // The reduced fixture represents 3 of the 90 reported firms.
  });

  it("only calls a directory complete when every reported member is valid and unique", () => {
    const result = parseIdxBrokerDirectory({ recordsTotal: 2, recordsFiltered: 2, data: [
      { Code: "XC", Name: " Ajaib Sekuritas ", License: "Broker" },
      { Code: "YP", Name: "Yapindo", License: "Broker" },
    ] });
    expect(result.complete).toBe(true);
    expect(parseIdxBrokerDirectory({ recordsTotal: 2, data: [{ Code: "XC", Name: "Ajaib", License: "Broker" }, { Code: "XC", Name: "Duplicate", License: "Broker" }] }).complete).toBe(false);
  });
});
