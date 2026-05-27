/**
 * ecrew → ICAO type designator mapper.
 *
 * ecrew exports use carrier-specific type codes ("32Q", "32N", "320") that
 * don't match the ICAO DOC 8643 designators ("A21N", "A20N", "A320") the
 * rest of the app standardizes on. Unless we map at parse time, every
 * import shows a continual diff "32Q vs A21N" and the user has to keep
 * accepting the same change.
 *
 * The mapping is deliberately conservative — only types we've actually
 * seen in real ecrew exports are translated. Anything else passes through
 * unchanged so a future fleet addition isn't silently misrouted.
 */

const ECREW_TO_ICAO: Record<string, string> = {
  "32Q": "A21N", // Airbus A321neo
  "32N": "A20N", // Airbus A320neo
  "320": "A320", // Airbus A320 (ceo)
  "318": "A318", // A318 (used as a sim device code in ecrew)
};

export function normalizeAircraftType(rawType: string): string {
  if (!rawType) return rawType;
  const upper = rawType.trim().toUpperCase();
  return ECREW_TO_ICAO[upper] ?? upper;
}

/**
 * Build the same family signature the cross-hydrate matcher uses, but on
 * already-normalized ICAO designators.
 */
export function familyOfNormalizedType(typeCode: string): string {
  if (!typeCode) return "";
  const t = typeCode.toUpperCase();
  if (t === "A20N" || t === "A21N" || t === "A320" || t === "A321") return "A320FAMILY";
  if (t.startsWith("A33") || t === "A330") return "A330";
  if (t.startsWith("B77") || t === "B777") return "B777";
  if (t.startsWith("B78") || t === "B787") return "B787";
  return t;
}
