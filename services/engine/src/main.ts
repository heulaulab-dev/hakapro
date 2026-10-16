// HAKAPRO Data Engine entry (Bun). `bun services/engine/src/main.ts` locally; `bun main.js` in the image.
import { loadConfig } from "./config";
import { createEngine } from "./engine";
import { log } from "./log";

const config = loadConfig();
const engine = await createEngine(config);

// Ownership uploads (E6) carry files up to ENGINE_OWNERSHIP_MAX_UPLOAD_MB and are parsed within the request, so the body
// cap follows that limit (plus multipart framing) and idle connections get two minutes instead of Bun's 10 s.
const server = Bun.serve({
  port: config.port, hostname: "0.0.0.0", fetch: engine.app,
  maxRequestBodySize: config.ownership.maxUploadBytes + 1024 * 1024, idleTimeout: 120,
});
if (config.schedulerEnabled) engine.scheduler.start();
log.info("engine_started", {
  port: server.port, scheduler: config.schedulerEnabled, rawStore: engine.services.rawStore.kind,
  sources: engine.registry.sources.length, jobs: engine.registry.jobs.length, apiAuth: Boolean(config.apiToken), admin: Boolean(config.adminToken),
});

let stopping = false;
async function stop(signal: string) {
  if (stopping) return;
  stopping = true;
  log.info("engine_stopping", { signal });
  await server.stop();
  await engine.shutdown();
  process.exit(0);
}
process.on("SIGTERM", () => void stop("SIGTERM"));
process.on("SIGINT", () => void stop("SIGINT"));
