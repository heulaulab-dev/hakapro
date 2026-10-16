// Per-host politeness: a token bucket (1 request per minIntervalMs, no burst by default) plus a concurrency cap.

export type Clock = { now(): number; sleep(ms: number): Promise<void> };
export const realClock: Clock = { now: () => Date.now(), sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)) };

export type HostPolicy = { minIntervalMs: number; concurrency: number; burst?: number };
export const DEFAULT_HOST_POLICY: HostPolicy = { minIntervalMs: 2000, concurrency: 2 };

export class TokenBucket {
  private tokens: number;
  private updatedAt: number;
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly capacity: number, private readonly refillMs: number, private readonly clock: Clock = realClock) {
    this.tokens = capacity;
    this.updatedAt = clock.now();
  }

  /** Takes a token now and returns 0, or returns the ms until one is available. */
  tryTake(): number {
    const now = this.clock.now();
    this.tokens = Math.min(this.capacity, this.tokens + (now - this.updatedAt) / this.refillMs);
    this.updatedAt = now;
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return 0;
    }
    return Math.ceil((1 - this.tokens) * this.refillMs);
  }

  /** FIFO: waiters are served in call order. */
  take(): Promise<void> {
    const next = this.queue.then(async () => {
      for (let wait = this.tryTake(); wait > 0; wait = this.tryTake()) await this.clock.sleep(wait);
    });
    this.queue = next.catch(() => {});
    return next;
  }
}

export class Semaphore {
  private active = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(private readonly limit: number) {}

  async acquire(): Promise<void> {
    if (this.active < this.limit) {
      this.active += 1;
      return;
    }
    await new Promise<void>((resolve) => this.waiters.push(resolve));
  }

  release(): void {
    const next = this.waiters.shift();
    if (next) next();
    else this.active -= 1;
  }

  get inFlight(): number {
    return this.active;
  }
}

export class HostLimiter {
  private readonly bucket: TokenBucket;
  private readonly slots: Semaphore;

  constructor(readonly policy: HostPolicy, clock: Clock = realClock) {
    this.bucket = new TokenBucket(Math.max(1, policy.burst ?? 1), policy.minIntervalMs, clock);
    this.slots = new Semaphore(Math.max(1, policy.concurrency));
  }

  async run<T>(task: () => Promise<T>): Promise<T> {
    await this.slots.acquire();
    try {
      await this.bucket.take();
      return await task();
    } finally {
      this.slots.release();
    }
  }

  get inFlight(): number {
    return this.slots.inFlight;
  }
}

/** One limiter per host. A host shared by several sources keeps the policy it was first created with. */
export class LimiterRegistry {
  private readonly limiters = new Map<string, HostLimiter>();

  constructor(private readonly clock: Clock = realClock) {}

  forHost(host: string, policy: HostPolicy = DEFAULT_HOST_POLICY): HostLimiter {
    const key = host.toLowerCase();
    let limiter = this.limiters.get(key);
    if (!limiter) {
      limiter = new HostLimiter(policy, this.clock);
      this.limiters.set(key, limiter);
    }
    return limiter;
  }
}
