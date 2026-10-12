"use server";

import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { users, watchlists, watchlistItems } from "@/db/schema";
import type { Watchlist } from "@/lib/user-data";
import { requireUser } from "@/server/auth";

const idSchema = z.uuid();
const nameSchema = z.string().trim().min(1).max(80);
const symbolSchema = z.string().trim().toUpperCase().regex(/^[A-Z0-9]{1,12}$/);

export async function listWatchlist(): Promise<Watchlist> {
  const user = await requireUser();
  const { db } = await import("@/server/db");
  const [list] = await db.select({ id: watchlists.id }).from(watchlists)
    .where(and(eq(watchlists.userId, user.id), eq(watchlists.isDefault, true))).limit(1);
  if (!list) return { id: null, items: [] };
  const items = await db.select({ id: watchlistItems.id, symbol: watchlistItems.symbol, position: watchlistItems.position })
    .from(watchlistItems).innerJoin(watchlists, eq(watchlists.id, watchlistItems.watchlistId))
    .where(and(eq(watchlists.userId, user.id), eq(watchlists.id, list.id)))
    .orderBy(asc(watchlistItems.position), asc(watchlistItems.createdAt), asc(watchlistItems.id));
  return { id: list.id, items };
}

export async function addWatchlistItem(symbol: string, defaultName: string): Promise<void> {
  const user = await requireUser();
  const code = symbolSchema.parse(symbol);
  const name = nameSchema.parse(defaultName);
  const { db } = await import("@/server/db");
  await db.transaction(async (tx) => {
    // Lock this user's row even when no default list exists yet. Concurrent adds
    // then share one default list and get positions from current database state.
    await tx.select({ id: users.id }).from(users).where(eq(users.id, user.id)).for("update");
    let [list] = await tx.select({ id: watchlists.id }).from(watchlists)
      .where(and(eq(watchlists.userId, user.id), eq(watchlists.isDefault, true))).limit(1);
    if (!list) {
      [list] = await tx.insert(watchlists).values({ userId: user.id, name, isDefault: true }).returning({ id: watchlists.id });
    }
    const [next] = await tx.select({ position: sql<number>`coalesce(max(${watchlistItems.position}), -1) + 1` })
      .from(watchlistItems).innerJoin(watchlists, eq(watchlists.id, watchlistItems.watchlistId))
      .where(and(eq(watchlists.userId, user.id), eq(watchlists.id, list.id)));
    await tx.insert(watchlistItems).values({ watchlistId: list.id, symbol: code, position: next.position })
      .onConflictDoNothing({ target: [watchlistItems.watchlistId, watchlistItems.symbol] });
  });
}

export async function removeWatchlistItem(itemId: string): Promise<void> {
  const user = await requireUser();
  const id = idSchema.parse(itemId);
  const { db } = await import("@/server/db");
  const deleted = await db.delete(watchlistItems).where(and(eq(watchlistItems.id, id),
    inArray(watchlistItems.watchlistId, db.select({ id: watchlists.id }).from(watchlists).where(eq(watchlists.userId, user.id)))))
    .returning({ id: watchlistItems.id });
  if (!deleted.length) throw new Error("NOT_FOUND");
}
