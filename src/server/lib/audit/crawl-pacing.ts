import { getOptionalEnvValue } from "@/server/lib/runtime-env";
import {
  CRAWL_WINDOW,
  RETRY_CRAWL_WINDOW,
  type CrawlWindowLimits,
} from "@/server/lib/audit/crawl-window";

export type CrawlPacing = {
  concurrency: number;
  delayMs: number;
};

function boundedInteger(
  value: string | undefined,
  minimum: number,
  maximum: number,
  fallback: number,
): number {
  if (value === undefined || !/^\d+$/.test(value)) return fallback;
  const parsed = Number(value);
  return Math.min(maximum, Math.max(minimum, parsed));
}

export async function readCrawlPacing(): Promise<CrawlPacing> {
  const [concurrency, delayMs] = await Promise.all([
    getOptionalEnvValue("AUDIT_CRAWL_CONCURRENCY"),
    getOptionalEnvValue("AUDIT_CRAWL_DELAY_MS"),
  ]);
  return {
    concurrency: boundedInteger(concurrency, 1, 20, CRAWL_WINDOW.max),
    delayMs: boundedInteger(delayMs, 0, 10_000, 0),
  };
}

export function configuredCrawlWindow(
  retry: boolean,
  concurrency: number,
): CrawlWindowLimits {
  const defaults = retry ? RETRY_CRAWL_WINDOW : CRAWL_WINDOW;
  const max = Math.min(defaults.max, concurrency);
  return {
    ...defaults,
    initial: Math.min(defaults.initial, max),
    min: Math.min(defaults.min, max),
    max,
  };
}

export class RequestStartPacer {
  private nextStartAt = 0;

  constructor(private readonly delayMs: number) {}

  async wait(): Promise<void> {
    const now = Date.now();
    const waitMs = Math.max(0, this.nextStartAt - now);
    if (waitMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
    this.nextStartAt = Date.now() + this.delayMs;
  }
}
