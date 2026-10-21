"use client";

/**
 * Client contracts for the AI routes: GET /api/research/[code]/narrative and POST /api/ai/copilot (NDJSON).
 * Only rendered when the server says AI is on; any failure simply hides the AI text.
 */
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { ApiError } from "./envelope";

export const narrativeSchema = z.object({
  status: z.enum(["ok", "rejected"]),
  reason: z.string().nullable(),
  code: z.string(),
  lang: z.enum(["id", "en"]),
  session: z.string(),
  asOf: z.string(),
  sentences: z.array(z.string()).nullable(),
  model: z.string().nullable(),
  generatedAt: z.string().nullable(),
  cached: z.boolean(),
});
export type ResearchNarrative = z.infer<typeof narrativeSchema>;

export async function fetchNarrative(code: string, lang: "id" | "en", signal?: AbortSignal): Promise<ResearchNarrative> {
  const response = await fetch(`/api/research/${encodeURIComponent(code.toUpperCase())}/narrative?lang=${lang}`, { signal });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = body && typeof body === "object" && typeof (body as Record<string, unknown>).error === "string" ? String((body as Record<string, unknown>).error) : "REQUEST_FAILED";
    throw new ApiError(error, response.status);
  }
  const parsed = narrativeSchema.safeParse(body);
  if (!parsed.success) throw new ApiError("MALFORMED_RESPONSE", 502);
  return parsed.data;
}

/** One generation per ticker, session and language on the server; no automatic retries (each could cost quota). */
export const useResearchNarrative = (code: string, lang: "id" | "en", enabled: boolean) =>
  useQuery({
    queryKey: ["ai", "narrative", code.toUpperCase(), lang] as const,
    queryFn: ({ signal }) => fetchNarrative(code, lang, signal),
    enabled,
    retry: false,
    staleTime: 10 * 60_000,
    refetchOnWindowFocus: false,
  });

export type Citation = { tool: string; code: string | null; asOf: string | null; source: string };
export type CopilotEvent =
  | { type: "tool"; tool: string; code: string | null }
  | { type: "text"; text: string }
  | { type: "retract"; reason: "UNVERIFIED_NUMBERS" | "ADVICE_WORDING" | "REFUSED" | "INCOMPLETE" }
  | { type: "done"; citations: Citation[]; charged: boolean; refusal: boolean }
  | { type: "error"; code: string };

/** Posts the conversation and calls `onEvent` for each NDJSON line as it arrives. Non-2xx answers throw ApiError. */
export async function streamCopilot(body: { lang: "id" | "en"; messages: Array<{ role: "user" | "assistant"; content: string }> }, onEvent: (event: CopilotEvent) => void, signal?: AbortSignal): Promise<void> {
  const response = await fetch("/api/ai/copilot", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal });
  if (!response.ok || !response.body) {
    const error: unknown = await response.json().catch(() => null);
    throw new ApiError(error && typeof error === "object" && typeof (error as Record<string, unknown>).error === "string" ? String((error as Record<string, unknown>).error) : "REQUEST_FAILED", response.status);
  }
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    let newline = buffer.indexOf("\n");
    while (newline >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line) onEvent(JSON.parse(line) as CopilotEvent);
      newline = buffer.indexOf("\n");
    }
  }
}
