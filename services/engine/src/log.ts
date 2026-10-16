type LogFields = Record<string, string | number | boolean | null | undefined>;

/** Structured JSON log lines. Never pass env values, credentials or raw request headers. */
function emit(level: "info" | "warn" | "error", event: string, fields: LogFields): void {
  const line = JSON.stringify({ level, event, at: new Date().toISOString(), ...fields });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const log = {
  info: (event: string, fields: LogFields = {}) => emit("info", event, fields),
  warn: (event: string, fields: LogFields = {}) => emit("warn", event, fields),
  error: (event: string, fields: LogFields = {}) => emit("error", event, fields),
};
export type Logger = typeof log;

/** Silent logger for tests. */
export const nullLogger: Logger = { info: () => {}, warn: () => {}, error: () => {} };
