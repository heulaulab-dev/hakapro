import { describe, expect, test } from "vitest";
import { looksLikeIdentifier, stripIdentifiers } from "./strip-identifiers";

describe("stripIdentifiers", () => {
  test("drops identifier keys at any depth, keeps disclosed fields", () => {
    expect(stripIdentifiers({ Nama: "PT A", NPWP: "x", npkp: "y", id: 1, DataID: 2, nested: [{ NIK: "z", Jabatan: "DIREKTUR", nomor_identitas: "q" }] }))
      .toEqual({ Nama: "PT A", nested: [{ Jabatan: "DIREKTUR" }] });
  });

  test.each(["01.234.567.8-901.000", "012345678901000", "0123456789012345", "0123.4567.8901.2345"])("treats %s as an identifier value", (value) => {
    expect(looksLikeIdentifier(value)).toBe(true);
  });

  test.each(["2.774.000.000", "61,13", "PT Contoh Holdco", "2026-02-27", "1021067367"])("keeps %s", (value) => {
    expect(looksLikeIdentifier(value)).toBe(false);
  });
});
