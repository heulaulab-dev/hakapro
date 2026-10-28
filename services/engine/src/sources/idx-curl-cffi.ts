import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import type { Logger } from "../log";
import { IDX_ENDPOINT_PATHS, type IdxEndpointPath, type IdxFetchResult, type IdxJsonParams, type IdxJsonTransport } from "./idx-primary";

type WorkerReply = { id: number; result?: { ok: boolean; status: number | null; attempts: number; body?: unknown; error?: string; cfRay?: string }; error?: string };
type WorkerFactory = (python: string, script: string, env: NodeJS.ProcessEnv) => ChildProcessWithoutNullStreams;

export type CurlCffiIdxTransportOptions = {
  baseUrl: string;
  python?: string;
  maxRetries?: number;
  timeoutSeconds?: number;
  delaySeconds?: number;
  impersonate?: string;
  log?: Logger;
  workerScript?: string;
  spawnWorker?: WorkerFactory;
};

/**
 * Persistent JSON-lines bridge to curl_cffi. One Python AsyncSession is held for the transport lifetime;
 * the existing engine source registry and checkpointed index backfill remain the only ingestion path.
 */
export class CurlCffiIdxTransport implements IdxJsonTransport {
  readonly id = "idx-primary-curl-cffi";
  private child: ChildProcessWithoutNullStreams | null = null;
  private nextId = 1;
  private readonly pending = new Map<number, { resolve: (reply: WorkerReply) => void; reject: (error: Error) => void }>();
  private readonly python: string;
  private readonly script: string;
  private readonly spawnWorker: WorkerFactory;

  constructor(private readonly options: CurlCffiIdxTransportOptions) {
    this.python = options.python ?? "python3";
    this.script = options.workerScript ?? process.env.ENGINE_IDX_PRIMARY_WORKER_SCRIPT ?? fileURLToPath(new URL("../../python/idx_curl_worker.py", import.meta.url));
    this.spawnWorker = options.spawnWorker ?? ((python, script, env) => spawn(python, [script], { stdio: ["pipe", "pipe", "pipe"], env }));
  }

  async fetchIndexSummary(isoDate: string, signal?: AbortSignal): Promise<IdxFetchResult> {
    return this.execute({ op: "fetch", date: isoDate }, signal);
  }

  async fetchJson(path: IdxEndpointPath, params: IdxJsonParams, signal?: AbortSignal): Promise<IdxFetchResult> {
    if (!(IDX_ENDPOINT_PATHS as readonly string[]).includes(path)) return { ok: false, reason: "endpoint-not-allowlisted" };
    return this.execute({ op: "request", path, params }, signal);
  }

  async close(): Promise<void> {
    const child = this.child;
    if (!child) return;
    const id = this.nextId++;
    const closed = new Promise<void>((resolve) => {
      const timeout = setTimeout(resolve, 1500);
      child.once("close", () => { clearTimeout(timeout); resolve(); });
      const pending = this.pending;
      pending.set(id, { resolve: () => { clearTimeout(timeout); resolve(); }, reject: () => { clearTimeout(timeout); resolve(); } });
    });
    child.stdin.write(`${JSON.stringify({ id, op: "close" })}\n`);
    await closed;
    if (this.child === child) this.child = null;
  }

  private ensureWorker(): ChildProcessWithoutNullStreams {
    if (this.child) return this.child;
    const env = {
      ...process.env,
      ENGINE_IDX_PRIMARY_BASE_URL: this.options.baseUrl.replace(/\/+$/, ""),
      ENGINE_IDX_PRIMARY_MAX_RETRIES: String(this.options.maxRetries ?? 3),
      ENGINE_IDX_PRIMARY_TIMEOUT_SECONDS: String(this.options.timeoutSeconds ?? 30),
      ENGINE_IDX_PRIMARY_DELAY_SECONDS: String(this.options.delaySeconds ?? 2),
      ENGINE_IDX_PRIMARY_IMPERSONATE: this.options.impersonate ?? "chrome",
    };
    const child = this.spawnWorker(this.python, this.script, env);
    this.child = child;
    const lines = createInterface({ input: child.stdout });
    lines.on("line", (line) => {
      try {
        const reply = JSON.parse(line) as WorkerReply;
        const pending = this.pending.get(reply.id);
        if (!pending) return;
        this.pending.delete(reply.id);
        pending.resolve(reply);
      } catch {
        this.options.log?.warn("idx_curl_worker_invalid_message", { message: line.slice(0, 200) });
      }
    });
    const stderr = createInterface({ input: child.stderr });
    stderr.on("line", (line) => {
      try {
        const event = JSON.parse(line) as { event?: string; [key: string]: unknown };
        const eventName = event.event ?? "idx_curl_worker_log";
        delete event.event;
        const fields: Record<string, string | number | boolean | null> = {};
        for (const [key, value] of Object.entries(event)) {
          if (value == null || ["string", "number", "boolean"].includes(typeof value)) fields[key] = value as string | number | boolean | null;
        }
        this.options.log?.info(eventName, fields);
      } catch {
        this.options.log?.info("idx_curl_worker_log", { message: line.slice(0, 300) });
      }
    });
    child.on("error", (error) => this.rejectPending(error));
    child.on("close", (code) => {
      if (this.child === child) this.child = null;
      this.rejectPending(new Error(`curl_cffi worker exited (${code ?? "signal"})`));
    });
    return child;
  }

  private async execute(message: Record<string, unknown>, signal?: AbortSignal): Promise<IdxFetchResult> {
    if (signal?.aborted) return { ok: false, reason: "request-aborted" };
    const child = this.ensureWorker();
    const id = this.nextId++;
    const reply = new Promise<WorkerReply>((resolve, reject) => this.pending.set(id, { resolve, reject }));
    const onAbort = () => {
      const pending = this.pending.get(id);
      if (pending) {
        this.pending.delete(id);
        pending.resolve({ id, error: "request-aborted" });
        // Requests share one session; terminate its worker to cancel the in-flight socket read.
        child.kill("SIGTERM");
      }
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    try {
      child.stdin.write(`${JSON.stringify({ id, ...message })}\n`);
      const response = await reply;
      if (response.error) return { ok: false, reason: response.error };
      if (!response.result?.ok) {
        const cfRay = response.result?.cfRay ? `, cf-ray=${response.result.cfRay}` : "";
        return { ok: false, reason: `${response.result?.error ?? "http-error"} (status=${response.result?.status ?? "network"}, attempts=${response.result?.attempts ?? 0}${cfRay})` };
      }
      return { ok: true, body: response.result.body };
    } catch (error) {
      return { ok: false, reason: error instanceof Error ? error.message : String(error) };
    } finally {
      signal?.removeEventListener("abort", onAbort);
    }
  }

  private rejectPending(error: Error): void {
    for (const [id, pending] of this.pending) {
      this.pending.delete(id);
      pending.reject(error);
    }
  }
}
