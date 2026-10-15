"use server";

import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { savedScreeners } from "@/db/schema";
import { screenConditionSchema, type ScreenCondition } from "@/lib/api/market";
import type { SavedScreen } from "@/lib/user-data";
import { requireUser } from "@/server/auth";

const idSchema = z.uuid();
const conditionsSchema = z.array(screenConditionSchema).max(20);
const screenSchema = z.object({ name: z.string().trim().min(1).max(80), conditions: conditionsSchema });

export async function listSavedScreens(): Promise<SavedScreen[]> {
  const user = await requireUser();
  const { db } = await import("@/server/db");
  const rows = await db.select({ id: savedScreeners.id, name: savedScreeners.name, conditions: savedScreeners.conditions })
    .from(savedScreeners).where(eq(savedScreeners.userId, user.id)).orderBy(desc(savedScreeners.updatedAt), desc(savedScreeners.id));
  return rows.flatMap((row) => {
    const parsed = conditionsSchema.safeParse(row.conditions);
    return parsed.success ? [{ id: row.id, name: row.name, conditions: parsed.data }] : [];
  });
}

export async function createSavedScreen(input: { name: string; conditions: ScreenCondition[] }): Promise<string> {
  const user = await requireUser();
  const screen = screenSchema.parse(input);
  const { db } = await import("@/server/db");
  const [created] = await db.insert(savedScreeners).values({ userId: user.id, ...screen, sortConfig: {} })
    .returning({ id: savedScreeners.id });
  return created.id;
}

export async function updateSavedScreen(input: { id: string; name: string; conditions: ScreenCondition[] }): Promise<void> {
  const user = await requireUser();
  const id = idSchema.parse(input.id);
  const screen = screenSchema.parse(input);
  const { db } = await import("@/server/db");
  const changed = await db.update(savedScreeners).set(screen)
    .where(and(eq(savedScreeners.id, id), eq(savedScreeners.userId, user.id))).returning({ id: savedScreeners.id });
  if (!changed.length) throw new Error("NOT_FOUND");
}

export async function deleteSavedScreen(screenId: string): Promise<void> {
  const user = await requireUser();
  const id = idSchema.parse(screenId);
  const { db } = await import("@/server/db");
  const deleted = await db.delete(savedScreeners).where(and(eq(savedScreeners.id, id), eq(savedScreeners.userId, user.id)))
    .returning({ id: savedScreeners.id });
  if (!deleted.length) throw new Error("NOT_FOUND");
}
