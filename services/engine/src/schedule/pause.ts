// Global crawl pause (§4): disk usage on the data volume above ENGINE_DISK_STOP_PERCENT, or the
// build/maintenance flag file `${dataDir}/PAUSE` (set via POST /v1/admin/pause, or `touch` on the volume).
import { mkdir, rm, statfs, writeFile, access } from "node:fs/promises";
import { join } from "node:path";

/** Used share of the filesystem, as `df` reports it (reserved blocks excluded from the total). */
export async function diskUsagePercent(path: string): Promise<number> {
  const stats = await statfs(path);
  const used = stats.blocks - stats.bfree;
  const total = used + stats.bavail;
  return total > 0 ? (used / total) * 100 : 0;
}

export type PauseState = { paused: boolean; reason: "disk" | "flag" | null; diskPercent: number | null; diskStopPercent: number };

export class PauseGuard {
  private cached: { state: PauseState; at: number } | null = null;

  constructor(
    private readonly dataDir: string,
    private readonly diskStopPercent: number,
    private readonly options: { cacheMs?: number; measure?: (path: string) => Promise<number>; now?: () => number } = {},
  ) {}

  private get flagPath(): string {
    return join(this.dataDir, "PAUSE");
  }

  async check(force = false): Promise<PauseState> {
    const now = (this.options.now ?? Date.now)();
    if (!force && this.cached && now - this.cached.at < (this.options.cacheMs ?? 30_000)) return this.cached.state;
    await mkdir(this.dataDir, { recursive: true });
    let diskPercent: number | null = null;
    try {
      diskPercent = await (this.options.measure ?? diskUsagePercent)(this.dataDir);
    } catch {
      diskPercent = null;
    }
    const flagged = await access(this.flagPath).then(() => true, () => false);
    // An unmeasurable disk pauses too: crawling blind on a tight server is what §4 forbids.
    const diskStop = diskPercent === null || diskPercent > this.diskStopPercent;
    const state: PauseState = {
      paused: flagged || diskStop,
      reason: flagged ? "flag" : diskStop ? "disk" : null,
      diskPercent: diskPercent === null ? null : Math.round(diskPercent * 10) / 10,
      diskStopPercent: this.diskStopPercent,
    };
    this.cached = { state, at: now };
    return state;
  }

  /** Last known state without I/O (for hot paths such as a job's shouldYield). */
  get last(): PauseState | null {
    return this.cached?.state ?? null;
  }

  async setFlag(paused: boolean, note = ""): Promise<PauseState> {
    await mkdir(this.dataDir, { recursive: true });
    if (paused) await writeFile(this.flagPath, `${new Date().toISOString()} ${note}`.trim() + "\n");
    else await rm(this.flagPath, { force: true });
    return this.check(true);
  }
}
