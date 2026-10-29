import { sql } from "drizzle-orm";
import * as t from "../../db/schema";
import type { EngineDb } from "./client";
import type { KseiDividendNotice } from "../sources/ksei-cash-dividend";

/** Append-only import: repeated fetches of identical PDFs are no-ops; changed bytes remain separately auditable. */
export async function storeKseiCashDividendNotice(
  db: EngineDb,
  notice: KseiDividendNotice,
  documentSha256: string,
  rawRef: string | null,
  importedAt = new Date(),
): Promise<boolean> {
  const inserted = await db.insert(t.kseiCashDividendNotices).values({
    noticeId: notice.noticeId, supersedesNoticeId: notice.supersedesNoticeId, symbol: notice.symbol, issuer: notice.issuer,
    amountPerShare: notice.amountPerShare, cumDate: notice.cumDate, exDate: notice.exDate, recordDate: notice.recordDate,
    paymentDate: notice.paymentDate, status: notice.status, noticeDate: notice.noticeDate, documentUrl: notice.documentUrl,
    documentSha256, importedAt, rawRef,
  }).onConflictDoNothing().returning({ noticeId: t.kseiCashDividendNotices.noticeId });
  return inserted.length > 0;
}

/** Current notice per chain; original notices superseded by a later KSEI circular are excluded. */
export async function latestKseiCashDividendNotices(db: EngineDb, from: string, to: string) {
  return db.execute(sql`
    with recursive latest as (
      select distinct on (notice_id) * from ksei_cash_dividend_notices order by notice_id, imported_at desc
    ), chain as (
      select notice_id, supersedes_notice_id, symbol, issuer, amount_per_share, cum_date, ex_date, record_date, payment_date,
        status, notice_date, document_url, imported_at
      from latest where supersedes_notice_id is null
      union all
      select n.notice_id, n.supersedes_notice_id, coalesce(n.symbol, c.symbol), coalesce(n.issuer, c.issuer),
        coalesce(n.amount_per_share, c.amount_per_share), coalesce(n.cum_date, c.cum_date), coalesce(n.ex_date, c.ex_date),
        coalesce(n.record_date, c.record_date), coalesce(n.payment_date, c.payment_date), n.status, n.notice_date,
        n.document_url, n.imported_at
      from latest n join chain c on n.supersedes_notice_id = c.notice_id
    )
    select c.notice_id as "noticeId", c.symbol, c.issuer, c.amount_per_share as "amountPerShare",
      c.cum_date as "cumDate", c.ex_date as "exDate", c.record_date as "recordDate",
      c.payment_date as "paymentDate", c.status, c.notice_date as "noticeDate", c.document_url as "documentUrl",
      c.imported_at as "importedAt"
    from chain c
    where c.ex_date between ${from} and ${to}
      and not exists (select 1 from latest newer where newer.supersedes_notice_id = c.notice_id)
    order by c.ex_date, c.symbol, c.notice_date`);
}
