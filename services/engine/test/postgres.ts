// Throwaway PostgreSQL 17 in Docker for the opt-in e2e suites (`bun run engine:test:e2e`).
import { spawnSync } from "node:child_process";
import postgres from "postgres";

const docker = (...args: string[]) => spawnSync("docker", args, { encoding: "utf8" });

/** True when ENGINE_E2E_DOCKER=1 and a Docker daemon answers. */
export const dockerEnabled = (): boolean => {
  const wanted = process.env.ENGINE_E2E_DOCKER === "1";
  const enabled = wanted && docker("info", "--format", "{{.ServerVersion}}").status === 0;
  if (wanted && !enabled) console.warn("engine e2e skipped: docker is not available");
  return enabled;
};

export type TestPostgres = { url: string; createDatabase(name: string): Promise<string>; stop(): void };

async function waitReady(url: string): Promise<void> {
  for (let attempt = 0; ; attempt += 1) {
    const probe = postgres(url, { max: 1, connect_timeout: 2, onnotice: () => {} });
    const ok = await probe`select 1`.then(() => true, () => false);
    await probe.end({ timeout: 1 });
    if (ok) return;
    if (attempt > 60) throw new Error("postgres did not become ready");
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

export async function startPostgres(): Promise<TestPostgres> {
  const started = docker("run", "-d", "--rm", "-e", "POSTGRES_PASSWORD=engine", "-e", "POSTGRES_USER=engine", "-e", "POSTGRES_DB=engine", "-p", "127.0.0.1::5432", "postgres:17-alpine");
  if (started.status !== 0) throw new Error(`docker run failed: ${started.stderr}`);
  const container = started.stdout.trim();
  const port = docker("port", container, "5432/tcp").stdout.trim().split(":").pop();
  const url = `postgresql://engine:engine@127.0.0.1:${port}/engine`;
  await waitReady(url);
  return {
    url,
    /** A fresh, empty database in the same container (isolates one test's engine). */
    async createDatabase(name: string) {
      if (!/^[a-z][a-z0-9_]{0,40}$/.test(name)) throw new Error("bad database name");
      const admin = postgres(url, { max: 1, onnotice: () => {} });
      try {
        await admin.unsafe(`create database ${name}`);
      } finally {
        await admin.end({ timeout: 1 });
      }
      return url.replace(/\/engine$/, `/${name}`);
    },
    stop: () => { docker("rm", "-f", container); },
  };
}
