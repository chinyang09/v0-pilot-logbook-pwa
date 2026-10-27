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
/** `.wheel-fill-glass` — the same strip on a glass panel. */
export const WHEEL_FILL_GLASS = "wheel-fill-glass"

/** Which end of the shared highlight bar a wheel sits at, so its strip takes that corner. */
type Edge = "start" | "middle" | "end"

/**
 * `surface` is what the wheel sits on: a sheet (`card`, the default) or a
 * glass panel (`glass` — the calendar's month/year picker), where the strip is
 * `--on-glass-fill`, the solid fill everything ON the glass uses.
 */
export function wheelClassNames(edge: Edge, numeric = true, surface: "card" | "glass" = "card"): WheelPickerClassNames {
  const nums = numeric ? " tabular-nums" : ""
  const fill = surface === "glass" ? WHEEL_FILL_GLASS : WHEEL_FILL
  // Whole class names, so Tailwind's scan finds them.
  const round = surface === "glass" ? { l: " rounded-l-full", r: " rounded-r-full" } : { l: " rounded-l-lg", r: " rounded-r-lg" }
  return {
    optionItem: `text-lg${nums} text-muted-foreground/50 font-medium`,
    highlightItem: `text-xl${nums} text-foreground font-semibold`,
    // On glass the strip is a capsule, the shape of every selected thing there.
    highlightWrapper: `${fill}${edge === "start" ? round.l : edge === "end" ? round.r : ""}`,
  }
}
