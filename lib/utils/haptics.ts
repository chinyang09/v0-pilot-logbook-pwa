/**
 * A touch you can feel, where the hardware offers one.
 *
 * The app's controls are drawn as physical things — a capsule that blooms
 * under a press, a wheel with rows, a pill that carries a bead of glass — and
 * a physical control answers the finger. `navigator.vibrate` is the only
 * haptic the web has: Android has it, iOS does not, and where it is missing
 * this does nothing (the look and the behaviour are the same either way, so
 * it is not a platform branch).
 *
 * Three weights, so a tick means the same thing everywhere:
 *
 * | | ms | For |
 * |---|---|---|
 * | `tick` | 6 | moving between things — a tab, a wheel row, a menu choice |
 * | `tap` | 10 | committing a value — NOW, USE, a switch |
 * | `thud` | 18 | something left — a delete |
 *
 * Never on a scroll, a render or a timer: only inside the gesture that caused it.
 */
const WEIGHT = { tick: 6, tap: 10, thud: 18 } as const

export type HapticWeight = keyof typeof WEIGHT

export function haptic(weight: HapticWeight = "tick"): void {
  if (typeof navigator === "undefined" || typeof navigator.vibrate !== "function") return
  try {
    navigator.vibrate(WEIGHT[weight])
  } catch {
    // A browser may refuse outside a gesture; nothing depends on it.
  }
}
