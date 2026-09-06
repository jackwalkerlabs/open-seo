import { fetchSerpLocationsForCountry } from "@/server/lib/dataforseo/serp-locations";
import { AppError } from "@/server/lib/errors";
import { LOCATION_OPTIONS } from "@/shared/keyword-locations";

function normalized(value: string): string {
  return value
    .split(",")
    .map((part) => part.trim().toLowerCase())
    .join(",");
}

export async function resolveRankTrackingLocation(
  locationCode: number,
  requestedName: string,
): Promise<string> {
  const country = LOCATION_OPTIONS.find(
    (location) => location.code === locationCode,
  );
  if (!country) {
    throw new AppError(
      "VALIDATION_ERROR",
      "Select a supported country before choosing a local rank-tracking location.",
    );
  }

  let locations;
  try {
    const iso =
      country.shortLabel === "UK" ? "gb" : country.shortLabel.toLowerCase();
    locations = await fetchSerpLocationsForCountry(iso);
  } catch {
    throw new AppError(
      "UPSTREAM_UNAVAILABLE",
      "The location registry is unavailable. Try saving the rank tracker again in a moment.",
    );
  }

  const needle = normalized(requestedName);
  const canonicalMatches = locations.filter(
    (location) => normalized(location.locationName) === needle,
  );
  if (canonicalMatches.length > 0) return canonicalMatches[0].locationName;

  const localNameMatches = locations.filter(
    (location) => normalized(location.locationName.split(",", 1)[0]) === needle,
  );
  if (localNameMatches.length === 1) return localNameMatches[0].locationName;
  if (localNameMatches.length > 1) {
    throw new AppError(
      "VALIDATION_ERROR",
      `Location "${requestedName}" is ambiguous. Choose a specific location from the location search results.`,
    );
  }

  throw new AppError(
    "VALIDATION_ERROR",
    `Location "${requestedName}" was not found for the selected country. Choose a location from the location search results.`,
  );
}
