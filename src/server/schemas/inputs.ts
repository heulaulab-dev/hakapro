import { z } from "zod";

export const symbolSchema = z.string().trim().toUpperCase().regex(/^[A-Z0-9]{1,12}$/);
export const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const positiveInt = z.coerce.number().int().positive();

export function optionalParam(params: URLSearchParams, key: string): string | undefined {
  return params.get(key) || undefined;
}
