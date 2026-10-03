import "server-only";

type LogFields = Record<string, string | number | boolean | null | undefined>;

/** Structured server log. Never pass env values, credentials or raw request headers. */
export function logWarn(event: string, fields: LogFields = {}): void {
  console.warn(JSON.stringify({ level: "warn", event, ...fields }));
}

export function logError(event: string, fields: LogFields = {}): void {
  console.error(JSON.stringify({ level: "error", event, ...fields }));
}
