import { describe, expect, it } from "vitest";
import { fakeClock } from "../../test/support";
import { DEFAULT_HOST_POLICY, HostLimiter, LimiterRegistry, TokenBucket } from "./rate-limit";

describe("TokenBucket", () => {
  it("allows one request per interval with no burst", () => {
    const clock = fakeClock();
    const bucket = new TokenBucket(1, 2000, clock);
    expect(bucket.tryTake()).toBe(0);
    expect(bucket.tryTake()).toBe(2000);
    clock.advance(500);
    expect(bucket.tryTake()).toBe(1500);
    clock.advance(1500);
    expect(bucket.tryTake()).toBe(0);
  });

  it("serves waiters in order, spaced by the interval", async () => {
    const clock = fakeClock();
    const bucket = new TokenBucket(1, 2000, clock);
    const starts: number[] = [];
    await Promise.all([1, 2, 3].map(() => bucket.take().then(() => starts.push(clock.now()))));
    expect(starts).toEqual([0, 2000, 4000]);
  });
});

describe("HostLimiter", () => {
  it("defaults to 1 request / 2 s and concurrency 2", () => {
    expect(DEFAULT_HOST_POLICY).toEqual({ minIntervalMs: 2000, concurrency: 2 });
  });

  it("caps in-flight requests at the policy concurrency", async () => {
    const limiter = new HostLimiter({ minIntervalMs: 10, concurrency: 2 }, fakeClock());
    let active = 0;
    let peak = 0;
    const releases: Array<() => void> = [];
    const tasks = [1, 2, 3, 4].map(() => limiter.run(async () => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise<void>((resolve) => releases.push(resolve));
      active -= 1;
    }));
    for (let i = 0; i < 4; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5));
      releases.shift()?.();
    }
    await Promise.all(tasks);
    expect(peak).toBe(2);
  });

  it("shares one limiter per host (case-insensitive)", () => {
    const registry = new LimiterRegistry(fakeClock());
    expect(registry.forHost("Example.test")).toBe(registry.forHost("example.test"));
    expect(registry.forHost("a.test")).not.toBe(registry.forHost("b.test"));
  });
});
