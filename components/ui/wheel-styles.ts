/**
 * The look of the app's wheel pickers (`DatePicker`, `TimePicker`).
 *
 * The wheel draws its rows as small rotated text, and the selected row a
 * second time, large and bold, in a highlight strip laid over the centre. The
 * strip was TRANSPARENT, so the small copy of the selected value showed
 * straight through behind the bold one. It is filled now with an OPAQUE
 * colour — the same one the highlight bar behind the wheels resolves to
 * (`--muted` at 40% over the sheet's `--card`) — so it covers that copy and
 * still reads as one bar across every wheel.
 */

import type { WheelPickerClassNames } from "@ncdai/react-wheel-picker"

/** `.wheel-fill` in globals.css. */
export const WHEEL_FILL = "wheel-fill"

/** Which end of the shared highlight bar a wheel sits at, so its strip takes that corner. */
type Edge = "start" | "middle" | "end"

export function wheelClassNames(edge: Edge, numeric = true): WheelPickerClassNames {
  const nums = numeric ? " tabular-nums" : ""
  return {
    optionItem: `text-lg${nums} text-muted-foreground/50 font-medium`,
    highlightItem: `text-xl${nums} text-foreground font-semibold`,
    highlightWrapper: `${WHEEL_FILL}${edge === "start" ? " rounded-l-lg" : edge === "end" ? " rounded-r-lg" : ""}`,
  }
}
