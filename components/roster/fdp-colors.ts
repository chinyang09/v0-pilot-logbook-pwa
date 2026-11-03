/**
 * The FDP page's series colours, shared by the rolling chart and the duty
 * timeline so a duty, a flight hour and a planned day read the same in both.
 * Hex rather than CSS variables: the rolling chart is SVG, where an oklch
 * variable cannot be used in an attribute. Muted for night viewing.
 */
export const FDP_COLORS = {
  /** Duty — the steel blue of the 14-day duty series. */
  duty: "#6b8eae",
  /** Flight time — the sage of the 28-day flight series. */
  flight: "#5a9478",
  /** What is still PLANNED: every day after today. */
  planned: "#d4b13c",
  /** A limit broken, a rest short. */
  violation: "#b04e3a",
} as const
