import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveRankTrackingLocation } from "./resolveRankTrackingLocation";

const mocks = vi.hoisted(() => ({ fetchLocations: vi.fn() }));

vi.mock("@/server/lib/dataforseo/serp-locations", () => ({
  fetchSerpLocationsForCountry: mocks.fetchLocations,
}));

const location = (locationName: string) => ({
  locationCode: 1,
  locationName,
  locationType: "City",
  displayLabel: locationName,
});

describe("resolveRankTrackingLocation", () => {
  beforeEach(() => {
    mocks.fetchLocations.mockReset();
  });

  it("returns the registry's canonical value for a valid full name", async () => {
    mocks.fetchLocations.mockResolvedValue([
      location("Enid,Oklahoma,United States"),
    ]);

    await expect(
      resolveRankTrackingLocation(2840, "enid, oklahoma, united states"),
    ).resolves.toBe("Enid,Oklahoma,United States");
    expect(mocks.fetchLocations).toHaveBeenCalledWith("us");
  });

  it("resolves a unique exact local name", async () => {
    mocks.fetchLocations.mockResolvedValue([
      location("Enid,Oklahoma,United States"),
    ]);

    await expect(resolveRankTrackingLocation(2840, "Enid")).resolves.toBe(
      "Enid,Oklahoma,United States",
    );
  });

  it("rejects an unknown name without guessing its spelling", async () => {
    mocks.fetchLocations.mockResolvedValue([
      location("Sao Paulo,State of Sao Paulo,Brazil"),
    ]);

    await expect(
      resolveRankTrackingLocation(2076, "São Paolo"),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("rejects an ambiguous local name", async () => {
    mocks.fetchLocations.mockResolvedValue([
      location("Springfield,Illinois,United States"),
      location("Springfield,Missouri,United States"),
    ]);

    const error = await resolveRankTrackingLocation(2840, "Springfield").catch(
      (cause: unknown) => cause,
    );
    expect(error).toBeInstanceOf(Error);
    if (!(error instanceof Error) || !("code" in error)) throw error;
    expect(error.code).toBe("VALIDATION_ERROR");
    expect(error.message).toContain("ambiguous");
  });

  it("reports registry failures separately from invalid names", async () => {
    mocks.fetchLocations.mockRejectedValue(new Error("KV unavailable"));

    await expect(
      resolveRankTrackingLocation(2840, "Enid"),
    ).rejects.toMatchObject({ code: "UPSTREAM_UNAVAILABLE" });
  });

  it("rejects an unsupported local country without querying another registry", async () => {
    await expect(
      resolveRankTrackingLocation(999999, "Enid"),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(mocks.fetchLocations).not.toHaveBeenCalled();
  });
});
