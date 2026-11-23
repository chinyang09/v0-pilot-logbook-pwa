/**
 * A runway's length as the pilot reads it (Settings › Display › Runway
 * Length): feet by default — "10,499'" — or metres — "3,200m". The sources
 * store feet (OurAirports, aviationweather.gov); metres are worked out here,
 * the one place every screen goes through.
 */

import type { DisplayPreferences } from "@/types/db/stores.types"

const FT_TO_M = 0.3048

export function formatRunwayLength(lengthFt: number, unit: DisplayPreferences["runwayLength"] | undefined): string {
  if (!Number.isFinite(lengthFt) || lengthFt <= 0) return ""
  return unit === "m"
    ? `${Math.round(lengthFt * FT_TO_M).toLocaleString("en-US")}m`
    : `${Math.round(lengthFt).toLocaleString("en-US")}'`
}
