import { describe, expect, it, vi } from "vitest";
import type { EngineDb } from "./client";
import { upsertIdxBrokerMembers } from "./idx-broker";

describe("IDX broker directory replacement", () => {
  it("atomically upserts current members and deactivates absent members", async () => {
    const doUpsert = vi.fn(async () => undefined);
    const doDeactivate = vi.fn(async (_values: unknown, _condition: unknown) => undefined);
    const tx = {
      insert: () => ({ values: () => ({ onConflictDoUpdate: doUpsert }) }),
      update: () => ({ set: (values: unknown) => ({ where: (condition: unknown) => { doDeactivate(values, condition); return undefined; } }) }),
    };
    const transaction = vi.fn(async (work: (value: typeof tx) => Promise<void>) => work(tx));
    const db = { transaction } as unknown as EngineDb;

    await expect(upsertIdxBrokerMembers(db, { rows: [{ code: "XC", name: "Ajaib", license: null }], complete: true }, {
      source: "idx-primary", asOf: new Date("2026-10-28T10:00:00Z"), rawRef: null,
    })).resolves.toBe(1);

    expect(transaction).toHaveBeenCalledOnce();
    expect(doUpsert).toHaveBeenCalledOnce();
    expect(doDeactivate).toHaveBeenCalledOnce();
    expect(doDeactivate.mock.calls[0][0]).toMatchObject({ active: false });
  });

  it("never reconciles an incomplete or empty snapshot", async () => {
    const transaction = vi.fn();
    const db = { transaction } as unknown as EngineDb;
    await expect(upsertIdxBrokerMembers(db, { rows: [{ code: "XC", name: "Ajaib", license: null }], complete: false }, {
      source: "idx-primary", asOf: new Date(), rawRef: null,
    })).rejects.toThrow(/incomplete snapshot/);
    await expect(upsertIdxBrokerMembers(db, { rows: [], complete: true }, {
      source: "idx-primary", asOf: new Date(), rawRef: null,
    })).rejects.toThrow(/incomplete snapshot/);
    expect(transaction).not.toHaveBeenCalled();
  });
});
