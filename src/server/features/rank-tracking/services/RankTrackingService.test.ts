import { beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_CONFIGS_PER_PROJECT } from "@/shared/rank-tracking";
import { RankTrackingService } from "./RankTrackingService";

const mocks = vi.hoisted(() => ({
  getConfigByProjectDomainLocation: vi.fn(),
  getConfigById: vi.fn(),
  getConfigsForProject: vi.fn(),
  createConfig: vi.fn(),
  updateConfig: vi.fn(),
  resolveRankTrackingLocation: vi.fn(),
}));

vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock("@/server/lib/dataforseo", () => ({ createDataforseoClient: vi.fn() }));
vi.mock(
  "@/server/features/rank-tracking/repositories/RankTrackingRepository",
  () => ({ RankTrackingRepository: mocks }),
);
vi.mock("./resolveRankTrackingLocation", () => ({
  resolveRankTrackingLocation: mocks.resolveRankTrackingLocation,
}));

const archivedConfig = {
  id: "config_archived",
  projectId: "project_1",
  domain: "acme.com",
  locationCode: 2840,
  languageCode: "en",
  devices: "both" as const,
  serpDepth: 20,
  scheduleInterval: "weekly" as const,
  isActive: false,
  lastSkipReason: "insufficient_credits",
};

const baseInput = {
  projectId: "project_1",
  projectMarket: { locationCode: 2704, languageCode: "vi" },
  domain: "acme.com",
  locationCode: 2840,
  languageCode: "es",
  devices: "desktop" as const,
  serpDepth: 40,
  scheduleInterval: "daily" as const,
};

describe("RankTrackingService.createConfig", () => {
  beforeEach(() => {
    mocks.resolveRankTrackingLocation.mockImplementation(
      async (_locationCode: number, locationName: string) => locationName,
    );
  });

  it("reactivates an archived config instead of throwing, applying the new settings", async () => {
    mocks.getConfigByProjectDomainLocation.mockResolvedValue(archivedConfig);
    mocks.getConfigsForProject.mockResolvedValue([]);
    mocks.updateConfig.mockResolvedValue(undefined);
    mocks.getConfigById.mockResolvedValue({
      ...archivedConfig,
      languageCode: "es",
      devices: "desktop",
      serpDepth: 40,
      scheduleInterval: "daily",
      isActive: true,
      lastSkipReason: null,
    });

    await expect(
      RankTrackingService.createConfig(baseInput),
    ).resolves.toMatchObject({
      id: "config_archived",
      isActive: true,
      languageCode: "es",
      devices: "desktop",
    });

    expect(mocks.updateConfig).toHaveBeenCalledTimes(1);
    expect(mocks.updateConfig).toHaveBeenCalledWith(
      "config_archived",
      "project_1",
      expect.objectContaining({
        isActive: true,
        languageCode: "es",
        devices: "desktop",
        serpDepth: 40,
        scheduleInterval: "daily",
        lastSkipReason: null,
      }),
    );
    // Reactivation must not insert a duplicate row.
    expect(mocks.createConfig).not.toHaveBeenCalled();
  });

  it("throws when an active config already tracks the same domain + location", async () => {
    mocks.getConfigByProjectDomainLocation.mockResolvedValue({
      ...archivedConfig,
      isActive: true,
    });

    await expect(
      RankTrackingService.createConfig(baseInput),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(mocks.updateConfig).not.toHaveBeenCalled();
    expect(mocks.createConfig).not.toHaveBeenCalled();
  });

  it("keys the duplicate check on locationName so national and city configs coexist", async () => {
    mocks.getConfigByProjectDomainLocation.mockResolvedValue(null);
    mocks.getConfigsForProject.mockResolvedValue([]);
    mocks.createConfig.mockResolvedValue(undefined);

    // Local config: the lookup must be scoped to this exact city, so an
    // existing national row for the same domain doesn't collide.
    await RankTrackingService.createConfig({
      ...baseInput,
      locationName: "Enid,Oklahoma,United States",
    });
    expect(mocks.getConfigByProjectDomainLocation).toHaveBeenCalledWith(
      "project_1",
      "acme.com",
      2840,
      "Enid,Oklahoma,United States",
    );

    // National config: the lookup is scoped to NULL locationName.
    await RankTrackingService.createConfig(baseInput);
    expect(mocks.getConfigByProjectDomainLocation).toHaveBeenLastCalledWith(
      "project_1",
      "acme.com",
      2840,
      null,
    );
  });

  it("canonicalizes a local location before checking duplicates and saving", async () => {
    mocks.getConfigByProjectDomainLocation.mockResolvedValue(null);
    mocks.getConfigsForProject.mockResolvedValue([]);
    mocks.createConfig.mockResolvedValue(undefined);
    mocks.resolveRankTrackingLocation.mockResolvedValue(
      "Enid,Oklahoma,United States",
    );

    await RankTrackingService.createConfig({
      ...baseInput,
      locationName: "enid",
    });

    expect(mocks.getConfigByProjectDomainLocation).toHaveBeenCalledWith(
      "project_1",
      "acme.com",
      2840,
      "Enid,Oklahoma,United States",
    );
    expect(mocks.createConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        locationName: "Enid,Oklahoma,United States",
      }),
    );
  });

  it("does not load the location registry for a national config", async () => {
    mocks.getConfigByProjectDomainLocation.mockResolvedValue(null);
    mocks.getConfigsForProject.mockResolvedValue([]);
    mocks.createConfig.mockResolvedValue(undefined);

    await RankTrackingService.createConfig(baseInput);

    expect(mocks.resolveRankTrackingLocation).not.toHaveBeenCalled();
  });

  it("canonicalizes a changed location before updating", async () => {
    mocks.resolveRankTrackingLocation.mockResolvedValue(
      "Enid,Oklahoma,United States",
    );
    mocks.updateConfig.mockResolvedValue(undefined);

    await RankTrackingService.updateConfig("config_1", "project_1", {
      locationCode: 2840,
      locationName: "Enid",
    });

    expect(mocks.updateConfig).toHaveBeenCalledWith(
      "config_1",
      "project_1",
      expect.objectContaining({
        locationCode: 2840,
        locationName: "Enid,Oklahoma,United States",
      }),
    );
  });

  it("uses the saved country when only the location name changes", async () => {
    mocks.getConfigById.mockResolvedValue({
      ...archivedConfig,
      locationCode: 2840,
    });
    mocks.resolveRankTrackingLocation.mockResolvedValue(
      "Enid,Oklahoma,United States",
    );

    await RankTrackingService.updateConfig("config_1", "project_1", {
      locationName: "Enid",
    });

    expect(mocks.resolveRankTrackingLocation).toHaveBeenCalledWith(
      2840,
      "Enid",
    );
  });

  it("can clear a local location without loading the registry", async () => {
    await RankTrackingService.updateConfig("config_1", "project_1", {
      locationName: null,
    });

    expect(mocks.resolveRankTrackingLocation).not.toHaveBeenCalled();
    expect(mocks.updateConfig).toHaveBeenCalledWith(
      "config_1",
      "project_1",
      expect.objectContaining({ locationName: null }),
    );
  });

  it("rejects reactivating an archived config when the project is at the active-config cap", async () => {
    mocks.getConfigByProjectDomainLocation.mockResolvedValue(archivedConfig);
    mocks.getConfigsForProject.mockResolvedValue(
      Array.from({ length: MAX_CONFIGS_PER_PROJECT }, (_, i) => ({
        ...archivedConfig,
        id: `config_${i}`,
        isActive: true,
      })),
    );

    await expect(
      RankTrackingService.createConfig(baseInput),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(mocks.updateConfig).not.toHaveBeenCalled();
    expect(mocks.createConfig).not.toHaveBeenCalled();
  });

  it("creates a new config when none exists for the domain + location", async () => {
    mocks.getConfigByProjectDomainLocation.mockResolvedValue(null);
    mocks.getConfigsForProject.mockResolvedValue([]);
    mocks.createConfig.mockResolvedValue(undefined);

    const result = await RankTrackingService.createConfig(baseInput);

    expect(result.id).toBeTruthy();
    expect(mocks.createConfig).toHaveBeenCalledTimes(1);
    expect(mocks.updateConfig).not.toHaveBeenCalled();
    expect(mocks.createConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        id: result.id,
        projectId: "project_1",
        domain: "acme.com",
        devices: "desktop",
        serpDepth: 40,
        scheduleInterval: "daily",
      }),
    );
  });

  it("uses the project's market when location and language are omitted", async () => {
    mocks.getConfigByProjectDomainLocation.mockResolvedValue(null);
    mocks.getConfigsForProject.mockResolvedValue([]);
    mocks.createConfig.mockResolvedValue(undefined);

    await RankTrackingService.createConfig({
      projectId: "project_1",
      projectMarket: { locationCode: 2704, languageCode: "vi" },
      domain: "acme.com",
      serpDepth: 40,
    });

    expect(mocks.createConfig).toHaveBeenCalledWith(
      expect.objectContaining({ locationCode: 2704, languageCode: "vi" }),
    );
  });

  it("snaps the language when only location overrides the project market", async () => {
    mocks.getConfigByProjectDomainLocation.mockResolvedValue(null);
    mocks.getConfigsForProject.mockResolvedValue([]);
    mocks.createConfig.mockResolvedValue(undefined);

    await RankTrackingService.createConfig({
      projectId: "project_1",
      projectMarket: { locationCode: 2704, languageCode: "vi" },
      domain: "acme.com",
      locationCode: 2276,
      serpDepth: 40,
    });

    expect(mocks.createConfig).toHaveBeenCalledWith(
      expect.objectContaining({ locationCode: 2276, languageCode: "de" }),
    );
  });
});
