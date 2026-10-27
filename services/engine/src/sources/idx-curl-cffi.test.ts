import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { CurlCffiIdxTransport } from "./idx-curl-cffi";

describe("CurlCffiIdxTransport worker bridge", () => {
  it("keeps one worker session for multiple dates and closes it cleanly", async () => {
    const spawnWorker = vi.fn((python: string, script: string) => spawn(python, [script], { stdio: ["pipe", "pipe", "pipe"] }));
    const transport = new CurlCffiIdxTransport({
      baseUrl: "https://idx-test.example/primary",
      workerScript: fileURLToPath(new URL("../../python/tests/fixtures/idx-echo-worker.py", import.meta.url)),
      spawnWorker,
    });

    await expect(transport.fetchIndexSummary("2026-01-05")).resolves.toEqual({ ok: true, body: { data: [{ IndexCode: "IHSG" }] } });
    await expect(transport.fetchIndexSummary("2026-01-06")).resolves.toEqual({ ok: true, body: { data: [{ IndexCode: "IHSG" }] } });
    expect(spawnWorker).toHaveBeenCalledTimes(1);
    await transport.close();
  });

  it("sends typed IDX endpoint requests over the existing persistent worker", async () => {
    const spawnWorker = vi.fn((python: string, script: string) => spawn(python, [script], { stdio: ["pipe", "pipe", "pipe"] }));
    const transport = new CurlCffiIdxTransport({
      baseUrl: "https://idx-test.example/primary",
      workerScript: fileURLToPath(new URL("../../python/tests/fixtures/idx-echo-worker.py", import.meta.url)),
      spawnWorker,
    });

    await expect(transport.fetchJson("/TradingSummary/GetStockSummary", { date: "20260807", start: 0, length: 9999 })).resolves.toEqual({
      ok: true, body: { path: "/TradingSummary/GetStockSummary", params: { date: "20260807", start: 0, length: 9999 } },
    });
    expect(spawnWorker).toHaveBeenCalledTimes(1);
    await transport.close();
  });

  it("reports an aborted request without contacting the worker", async () => {
    const spawnWorker = vi.fn();
    const transport = new CurlCffiIdxTransport({ baseUrl: "https://idx-test.example/primary", spawnWorker });
    const controller = new AbortController();
    controller.abort();
    await expect(transport.fetchIndexSummary("2026-01-05", controller.signal)).resolves.toEqual({ ok: false, reason: "request-aborted" });
    expect(spawnWorker).not.toHaveBeenCalled();
  });
});
