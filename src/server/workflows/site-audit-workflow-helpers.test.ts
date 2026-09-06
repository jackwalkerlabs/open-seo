import { afterEach, describe, expect, it, vi } from "vitest";
import {
  crawlPage,
  retryAfterMs,
} from "@/server/workflows/site-audit-workflow-helpers";

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function rateLimited(retryAfter?: string): Response {
  return new Response("throttled", {
    status: 429,
    headers: {
      "content-type": "text/html",
      ...(retryAfter ? { "retry-after": retryAfter } : {}),
    },
  });
}

describe("429 crawl retry", () => {
  it("parses Retry-After seconds and HTTP dates with a safe fallback", () => {
    const now = Date.UTC(2026, 0, 1);
    expect(retryAfterMs("3", now)).toBe(3_000);
    expect(retryAfterMs(new Date(now + 4_000).toUTCString(), now)).toBe(4_000);
    expect(retryAfterMs(null, now)).toBe(2_000);
    expect(retryAfterMs("invalid", now)).toBe(2_000);
  });

  it.each([undefined, "2", "Thu, 01 Jan 2026 00:00:02 GMT"])(
    "retries once after a supported delay (%s)",
    async (retryAfter) => {
      vi.useFakeTimers();
      vi.setSystemTime(Date.UTC(2026, 0, 1));
      const fetchMock = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(rateLimited(retryAfter))
        .mockResolvedValueOnce(rateLimited());

      const resultPromise = crawlPage("https://example.com/", 0, false);
      await vi.advanceTimersByTimeAsync(2_000);
      const result = await resultPromise;

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(result).toMatchObject({ statusCode: 429, fetchClass: "blocked" });
    },
  );

  it("does not retry early when Retry-After exceeds the cap", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(rateLimited("31"));

    const result = await crawlPage("https://example.com/", 0, false);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ statusCode: 429, fetchClass: "blocked" });
  });
});
