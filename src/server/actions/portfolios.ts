"use server";

import { and, asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { portfolios, portfolioTransactions, users } from "@/db/schema";
import { requireUser } from "@/server/auth";
import { summarizePortfolio } from "@/lib/portfolio";

const symbolSchema = z.string().trim().toUpperCase().regex(/^[A-Z0-9]{1,12}$/);
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const positive = z.coerce.number().finite().positive().max(1e15);

export type PortfolioTransaction = { id: string; symbol: string; transactionType: "BUY" | "SELL"; transactionDate: string; quantity: number; price: number; fees: number };
export type Portfolio = { id: string; name: string; transactions: PortfolioTransaction[] };

export async function listPortfolio(): Promise<Portfolio | null> {
  const user = await requireUser();
  const { db } = await import("@/server/db");
  const [portfolio] = await db.select({ id: portfolios.id, name: portfolios.name }).from(portfolios).where(eq(portfolios.userId, user.id)).orderBy(asc(portfolios.createdAt)).limit(1);
  if (!portfolio) return null;
  const rows = await db.select({ id: portfolioTransactions.id, symbol: portfolioTransactions.symbol, transactionType: portfolioTransactions.transactionType, transactionDate: portfolioTransactions.transactionDate, quantity: portfolioTransactions.quantity, price: portfolioTransactions.price, fees: portfolioTransactions.fees }).from(portfolioTransactions).where(eq(portfolioTransactions.portfolioId, portfolio.id)).orderBy(asc(portfolioTransactions.transactionDate), asc(portfolioTransactions.createdAt));
  return { id: portfolio.id, name: portfolio.name, transactions: rows.flatMap((row) => row.symbol && row.quantity !== null && row.price !== null && (row.transactionType === "BUY" || row.transactionType === "SELL") ? [{ id: row.id, symbol: row.symbol, transactionType: row.transactionType, transactionDate: row.transactionDate, quantity: Number(row.quantity), price: Number(row.price), fees: Number(row.fees) }] : []) };
}

export async function addPortfolioTransaction(input: { symbol: string; transactionType: "BUY" | "SELL"; transactionDate: string; quantity: number; price: number; fees?: number }): Promise<void> {
  const user = await requireUser();
  const parsed = { symbol: symbolSchema.parse(input.symbol), transactionType: z.enum(["BUY", "SELL"]).parse(input.transactionType), transactionDate: dateSchema.parse(input.transactionDate), quantity: positive.parse(input.quantity), price: z.coerce.number().finite().nonnegative().max(1e15).parse(input.price), fees: z.coerce.number().finite().nonnegative().max(1e15).parse(input.fees ?? 0) };
  const { db } = await import("@/server/db");
  await db.transaction(async (tx) => {
    await tx.select({ id: users.id }).from(users).where(eq(users.id, user.id)).for("update");
    const [locked] = await tx.select({ id: portfolios.id }).from(portfolios).where(eq(portfolios.userId, user.id)).orderBy(asc(portfolios.createdAt)).limit(1).for("update");
    let portfolio = locked;
    if (!portfolio) [portfolio] = await tx.insert(portfolios).values({ userId: user.id, name: "My Portfolio" }).returning({ id: portfolios.id });
    if (parsed.transactionType === "SELL") {
      const existing = await tx.select({ symbol: portfolioTransactions.symbol, transactionType: portfolioTransactions.transactionType, quantity: portfolioTransactions.quantity, price: portfolioTransactions.price, fees: portfolioTransactions.fees }).from(portfolioTransactions).where(eq(portfolioTransactions.portfolioId, portfolio.id)).orderBy(asc(portfolioTransactions.transactionDate), asc(portfolioTransactions.createdAt));
      const positions = summarizePortfolio(existing.flatMap((row) => row.symbol && row.quantity !== null && row.price !== null && (row.transactionType === "BUY" || row.transactionType === "SELL") ? [{ symbol: row.symbol, transactionType: row.transactionType, quantity: Number(row.quantity), price: Number(row.price), fees: Number(row.fees) }] : []));
      if ((positions.find((row) => row.symbol === parsed.symbol)?.quantity ?? 0) < parsed.quantity) throw new Error("INSUFFICIENT_SHARES");
    }
    await tx.insert(portfolioTransactions).values({ portfolioId: portfolio.id, ...parsed, quantity: String(parsed.quantity), price: String(parsed.price), fees: String(parsed.fees) });
  });
}

export async function removePortfolioTransaction(id: string): Promise<void> {
  const user = await requireUser();
  const { db } = await import("@/server/db");
  const transactionId = z.uuid().parse(id);
  await db.transaction(async (tx) => {
    await tx.select({ id: users.id }).from(users).where(eq(users.id, user.id)).for("update");
    const [owned] = await tx.select({ id: portfolioTransactions.id, portfolioId: portfolioTransactions.portfolioId }).from(portfolioTransactions).where(and(eq(portfolioTransactions.id, transactionId), inArray(portfolioTransactions.portfolioId, tx.select({ id: portfolios.id }).from(portfolios).where(eq(portfolios.userId, user.id))))).limit(1);
    if (!owned) throw new Error("NOT_FOUND");
    const rows = await tx.select({ id: portfolioTransactions.id, symbol: portfolioTransactions.symbol, transactionType: portfolioTransactions.transactionType, quantity: portfolioTransactions.quantity, price: portfolioTransactions.price, fees: portfolioTransactions.fees }).from(portfolioTransactions).where(eq(portfolioTransactions.portfolioId, owned.portfolioId)).orderBy(asc(portfolioTransactions.transactionDate), asc(portfolioTransactions.createdAt));
    summarizePortfolio(rows.flatMap((row) => row.id !== transactionId && row.symbol && row.quantity !== null && row.price !== null && (row.transactionType === "BUY" || row.transactionType === "SELL") ? [{ symbol: row.symbol, transactionType: row.transactionType, quantity: Number(row.quantity), price: Number(row.price), fees: Number(row.fees) }] : []));
    await tx.delete(portfolioTransactions).where(eq(portfolioTransactions.id, transactionId));
  });
}
