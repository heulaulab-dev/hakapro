// Insider feed storage: transactions (deduplicated on their natural key), per-symbol reads (`insider_checks`) that drive
// the job's rotation and the stated coverage, and the read port behind `/v1/insiders/recent`.
import { and, desc, eq, gte, sql } from "drizzle-orm";
import * as t from "../../db/schema";
import type { InsiderActionFilter, InsiderCoverage, InsiderStore, InsiderTransactionRecord } from "../serve/insiders";
import type { ArjumInsider } from "../sources/arjum";
import type { EngineDb } from "./client";
import type { Provenance } from "./ingest";

const ex = (column: string) => sql.raw(`excluded."${column}"`);

/** The natural identity of a transaction (the unique key `insider_transactions_natural`, NULLs equal). */
const naturalKey = (row: ArjumInsider) => [row.date, row.person, row.action, row.sharesChange ?? "∅", row.sharesAfter ?? "∅"].join("|");

/**
 * Upserts one page of a symbol's transactions. A re-fetch updates the same rows (roles, price, provenance) instead of
 * adding new ones; repeats inside one page are written once. Returns the rows written.
 */
export async function upsertInsiderTransactions(db: EngineDb, symbol: string, rows: ArjumInsider[], prov: Provenance): Promise<number> {
  const unique = [...new Map(rows.map((row) => [naturalKey(row), row])).values()];
  if (!unique.length) return 0;
  await db.insert(t.insiderTransactions).values(unique.map((row) => ({
    symbol, person: row.person, roles: row.roles, action: row.action, date: row.date,
    sharesChange: row.sharesChange, sharesBefore: row.sharesBefore, sharesAfter: row.sharesAfter,
    percentBefore: row.percentBefore, percentAfter: row.percentAfter, percentChange: row.percentChange,
    price: row.price, broker: row.broker, nationality: row.nationality,
    source: prov.source, asOf: prov.asOf, rawRef: prov.rawRef,
  }))).onConflictDoUpdate({
    target: [t.insiderTransactions.symbol, t.insiderTransactions.date, t.insiderTransactions.person, t.insiderTransactions.action, t.insiderTransactions.sharesChange, t.insiderTransactions.sharesAfter],
    set: {
      roles: ex("roles"), sharesBefore: ex("shares_before"), percentBefore: ex("percent_before"), percentAfter: ex("percent_after"), percentChange: ex("percent_change"),
      price: ex("price"), broker: ex("broker"), nationality: ex("nationality"), source: ex("source"), asOf: ex("as_of"), rawRef: ex("raw_ref"),
    },
  });
  return unique.length;
}

/** Records a read of a symbol's newest page on WIB date `checkedDate` (also for an unknown code: rows 0, total null). */
export async function recordInsiderCheck(db: EngineDb, symbol: string, check: { checkedDate: string; rows: number; total: number | null }, prov: Provenance): Promise<void> {
  const values = { symbol, checkedDate: check.checkedDate, rows: check.rows, total: check.total, source: prov.source, asOf: prov.asOf, rawRef: prov.rawRef };
  await db.insert(t.insiderChecks).values(values).onConflictDoUpdate({
    target: t.insiderChecks.symbol,
    set: { checkedDate: values.checkedDate, rows: values.rows, total: values.total, source: values.source, asOf: values.asOf, rawRef: values.rawRef },
  });
}

/**
 * The rotation: active symbols not read since `revisitBefore` (inclusive) — never-read first, then the longest ago —
 * and within each, most liquid first by the newest session's value up to `session`. Every symbol is reached in turn,
 * so the whole universe is covered over ceil(universe / budget) days, and none is re-read within the revisit window.
 */
export async function insiderQueue(db: EngineDb, session: string, revisitBefore: string): Promise<string[]> {
  const result = await db.execute<{ symbol: string }>(sql`
    with ref as (select max(date) as d from daily_prices where date <= ${session} and value is not null)
    select s.symbol from securities s
    left join insider_checks c on c.symbol = s.symbol
    left join daily_prices p on p.symbol = s.symbol and p.date = (select d from ref)
    where s.active and (c.checked_date is null or c.checked_date <= ${revisitBefore})
    order by c.checked_date asc nulls first, p.value desc nulls last, s.symbol asc`);
  return [...result].map((row) => row.symbol);
}

/** `/v1/insiders/recent` over the engine DB. */
export class DbInsiderStore implements InsiderStore {
  constructor(private readonly db: EngineDb) {}

  async recent(query: { from: string; action?: InsiderActionFilter; limit: number }): Promise<InsiderTransactionRecord[]> {
    const it = t.insiderTransactions;
    const rows = await this.db.select().from(it)
      .where(and(gte(it.date, query.from), query.action ? eq(it.action, query.action.toUpperCase() as "BUY" | "SELL" | "CROSS") : undefined))
      .orderBy(desc(it.date), sql`abs(${it.sharesChange}) * ${it.price} desc nulls last`, it.symbol, it.person)
      .limit(query.limit);
    return rows.map((row) => ({
      symbol: row.symbol, person: row.person, roles: row.roles, action: row.action, date: row.date,
      sharesChange: row.sharesChange, sharesBefore: row.sharesBefore, sharesAfter: row.sharesAfter,
      percentBefore: row.percentBefore, percentAfter: row.percentAfter, percentChange: row.percentChange,
      price: row.price, broker: row.broker, nationality: row.nationality, source: row.source, asOf: row.asOf,
    }));
  }

  async coverage(since: string): Promise<InsiderCoverage> {
    const [row] = await this.db.execute<{ checked: number; active: number; oldest: string | null; newest: string | Date | null }>(sql`
      select
        (select count(*) from securities s join insider_checks c on c.symbol = s.symbol where s.active and c.checked_date >= ${since})::int as checked,
        (select count(*) from securities where active)::int as active,
        (select min(c.checked_date)::text from securities s join insider_checks c on c.symbol = s.symbol where s.active and c.checked_date >= ${since}) as oldest,
        (select max(as_of) from insider_checks) as newest`);
    return {
      checked: Number(row?.checked ?? 0), active: Number(row?.active ?? 0), oldestCheck: row?.oldest ?? null,
      newestCheckAt: row?.newest ? new Date(row.newest) : null,
    };
  }
}
