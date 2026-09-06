import type { WorkflowStep } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";

const envValues = new Map<string, string>();
vi.mock("@/server/lib/runtime-env", () => ({
  getOptionalEnvValue: (name: string) => envValues.get(name),
}));

import {
  configuredCrawlWindow,
  readCrawlPacing,
  RequestStartPacer,
  snapshotCrawlPacing,
} from "@/server/lib/audit/crawl-pacing";

afterEach(() => {
  envValues.clear();
  vi.useRealTimers();
});

describe("crawl pacing configuration", () => {
  it("preserves the current defaults when unset", async () => {
    await expect(readCrawlPacing()).resolves.toEqual({
      concurrency: 20,
      delayMs: 0,
    });
  });

  it("clamps bounds and falls back deterministically for invalid values", async () => {
    envValues.set("AUDIT_CRAWL_CONCURRENCY", "99");
    envValues.set("AUDIT_CRAWL_DELAY_MS", "10001");
    await expect(readCrawlPacing()).resolves.toEqual({
      concurrency: 20,
      delayMs: 10_000,
    });

    envValues.set("AUDIT_CRAWL_CONCURRENCY", "not-a-number");
    envValues.set("AUDIT_CRAWL_DELAY_MS", "-1");
    await expect(readCrawlPacing()).resolves.toEqual({
      concurrency: 20,
      delayMs: 0,
    });

    envValues.set("AUDIT_CRAWL_CONCURRENCY", "0");
    await expect(readCrawlPacing()).resolves.toEqual({
      concurrency: 1,
      delayMs: 0,
    });
  });

  it.each([
    ["1", "0", { concurrency: 1, delayMs: 0 }],
    ["20", "10000", { concurrency: 20, delayMs: 10_000 }],
  ])(
    "accepts boundary values concurrency=%s and delay=%s",
    async (concurrency, delayMs, expected) => {
      envValues.set("AUDIT_CRAWL_CONCURRENCY", concurrency);
      envValues.set("AUDIT_CRAWL_DELAY_MS", delayMs);
      await expect(readCrawlPacing()).resolves.toEqual(expected);
    },
  );

  it("persists one pacing snapshot across workflow replays", async () => {
    const persisted = new Map<string, unknown>();
    const step = {
      do: vi.fn(async (name: string, callback: () => Promise<unknown>) => {
        if (!persisted.has(name)) persisted.set(name, await callback());
        return persisted.get(name);
      }),
    } as unknown as WorkflowStep;

    envValues.set("AUDIT_CRAWL_CONCURRENCY", "3");
    envValues.set("AUDIT_CRAWL_DELAY_MS", "100");
    await expect(snapshotCrawlPacing(step)).resolves.toEqual({
      concurrency: 3,
      delayMs: 100,
    });

    envValues.set("AUDIT_CRAWL_CONCURRENCY", "9");
    envValues.set("AUDIT_CRAWL_DELAY_MS", "900");
    await expect(snapshotCrawlPacing(step)).resolves.toEqual({
      concurrency: 3,
      delayMs: 100,
    });
    expect(step.do).toHaveBeenCalledTimes(2);
    expect([...persisted.keys()]).toEqual(["crawl-pacing"]);
  });

  it("caps every normal and retry window bound consistently", () => {
    expect(configuredCrawlWindow(false, 3)).toMatchObject({
      initial: 3,
      min: 3,
      max: 3,
    });
    expect(configuredCrawlWindow(true, 1)).toMatchObject({
      initial: 1,
      min: 1,
      max: 1,
    });
  });

  it("spaces request starts using a shared clock", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const pacer = new RequestStartPacer(250);
    const starts: number[] = [];

    await pacer.wait();
    starts.push(Date.now());
    const second = pacer.wait().then(() => starts.push(Date.now()));
    await vi.advanceTimersByTimeAsync(249);
    expect(starts).toEqual([1_000]);
    await vi.advanceTimersByTimeAsync(1);
    await second;
    expect(starts).toEqual([1_000, 1_250]);
  });
});
