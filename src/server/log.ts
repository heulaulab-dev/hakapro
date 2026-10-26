import "server-only";

type LogFields = Record<string, string | number | boolean | null | undefined>;

/** Structured server log. Never pass env values, credentials or raw request headers. */
export function logWarn(event: string, fields: LogFields = {}): void {
  console.warn(JSON.stringify({ level: "warn", event, ...fields }));
}

export function logError(event: string, fields: LogFields = {}): void {
  console.error(JSON.stringify({ level: "error", event, ...fields }));
}

/** Operational events (e.g. AI token usage). Same rules: counts and codes only, never prompts or outputs. */
export function logInfo(event: string, fields: LogFields = {}): void {
  console.info(JSON.stringify({ level: "info", event, ...fields }));
}
