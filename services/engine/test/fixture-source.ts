// Harmless example source, wired end to end in tests only: a local HTTP server serving synthetic EOD CSVs
// (invented symbols TEST1/TEST2). Shows the fetch → raw → parse (Zod) → DB pattern E2 sources will follow.
import { createHash } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { sql } from "drizzle-orm";
import { z } from "zod";
import * as t from "../db/schema";
import type { EngineServices } from "../src/engine";
import { defineSource, intradayRetentionJob, type Registry } from "../src/registry";
import { deleteIntradayOlderThan } from "../src/db/repos";
import { backfillJob } from "../src/schedule/backfill";
import type { JobContext } from "../src/schedule/scheduler";

export const FIXTURE_CSV = "symbol,open,high,low,close,volume\nTEST1,100,110,95,105,12000\nTEST2,50,52,49,51,3400\n";
const CHALLENGE = "<html><head><title>Just a moment...</title></head><body><script>window._cf_chl_opt={}</script></body></html>";

export type FixtureServer = { server: Server; origin: string; host: string; hits: Array<{ path: string; userAgent: string | undefined; ifNoneMatch: string | undefined }>; close(): Promise<void> };

export async function startFixtureServer(): Promise<FixtureServer> {
  const hits: FixtureServer["hits"] = [];
  const etag = `"${createHash("sha256").update(FIXTURE_CSV).digest("hex").slice(0, 16)}"`;
  const server = createServer((req, res) => {
    const path = req.url ?? "/";
    hits.push({ path, userAgent: req.headers["user-agent"], ifNoneMatch: req.headers["if-none-match"] as string | undefined });
    if (path.startsWith("/daily/")) {
      if (req.headers["if-none-match"] === etag) { res.writeHead(304, { etag }); res.end(); return; }
      res.writeHead(200, { "content-type": "text/csv", etag });
      res.end(FIXTURE_CSV);
      return;
    }
    if (path === "/challenge") {
      res.writeHead(403, { "content-type": "text/html", "cf-ray": "fixture-SIN", server: "cloudflare" });
      res.end(CHALLENGE);
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return { server, hits, host: `127.0.0.1:${port}`, origin: `http://127.0.0.1:${port}`, close: () => new Promise((resolve) => server.close(() => resolve())) };
}

const rowSchema = z.object({
  symbol: z.string().regex(/^[A-Z0-9]{1,12}$/),
  open: z.coerce.number(), high: z.coerce.number(), low: z.coerce.number(), close: z.coerce.number().nonnegative(),
  volume: z.coerce.number().int().nonnegative(),
});

export function parseFixtureCsv(text: string) {
  const [header, ...lines] = text.trim().split("\n");
  const keys = header.split(",");
  return lines.map((line) => rowSchema.parse(Object.fromEntries(line.split(",").map((value, index) => [keys[index], value]))));
}

/** Fetches one day and upserts it; returns rows written (0 when unchanged). */
async function ingestDay(services: EngineServices, source: { id: string; policy: { minIntervalMs: number; concurrency: number } }, origin: string, date: string, ctx?: JobContext) {
  const result = await services.fetcher.fetch(source, `${origin}/daily/${date}.csv`, { fetchRunId: ctx?.runId ?? null });
  ctx?.report.document(result.kind === "new");
  if (result.kind !== "new") return 0;
  const rows = parseFixtureCsv(await result.text());
  const asOf = new Date(`${date}T16:15:00+07:00`);
  await services.db.insert(t.dailyPrices).values(rows.map((row) => ({ ...row, date, source: source.id, asOf, rawRef: result.document.id })))
    .onConflictDoUpdate({
      target: [t.dailyPrices.symbol, t.dailyPrices.date],
      set: { open: sql`excluded.open`, high: sql`excluded.high`, low: sql`excluded.low`, close: sql`excluded.close`, volume: sql`excluded.volume`, source: sql`excluded.source`, asOf: sql`excluded.as_of`, rawRef: sql`excluded.raw_ref` },
    });
  await services.documents.setParseStatus(result.document.id, "PARSED");
  ctx?.report.rows(rows.length);
  return rows.length;
}

export function fixtureRegistry(origin: string, host: string, tradingDate: string) {
  return (services: EngineServices): Registry => {
    const eod = defineSource({ id: "fixture-eod", host, kind: "eod", policy: { minIntervalMs: 20, concurrency: 2 } });
    const blocked = defineSource({ id: "fixture-blocked", host, kind: "reference", policy: { minIntervalMs: 20, concurrency: 1 } });
    return {
      sources: [eod, blocked],
      jobs: [
        { id: "fixture-eod-daily", sourceId: eod.id, trigger: { kind: "cron", spec: "30 16 * * *", tradingDaysOnly: true }, run: async (ctx) => { await ingestDay(services, eod, origin, tradingDate, ctx); } },
        { id: "fixture-blocked", sourceId: blocked.id, trigger: { kind: "cron", spec: "0 6 * * *" }, run: async () => { await services.fetcher.fetch(blocked, `${origin}/challenge`); } },
        backfillJob({ id: "fixture-eod-backfill", sourceId: eod.id, from: "2026-10-05", until: () => "2026-10-09", batchDays: 2, processDay: async (date) => ({ rows: await ingestDay(services, eod, origin, date) }) }),
        intradayRetentionJob({ retentionDays: services.config.intraday.retentionDays, deleteOlderThan: (cutoff, limit) => deleteIntradayOlderThan(services.db, cutoff, limit) }),
      ],
    };
  };
}
