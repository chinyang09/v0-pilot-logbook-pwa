/**
 * The app's shared motion vocabulary. Every spring/bezier used for interactive
 * motion lives here so the whole UI moves with the same physics — don't scatter
 * new literals across components.
 *
 * NOTE: the gravity nav indicator and the pill↔sidebar morph must stay on CSS
 * transitions (compositor-driven — a JS spring hitches when a heavy page
 * mounts), so the beziers below are exported as CSS strings for them.
 */

/** Primary snap/settle spring — swipe rows, sheet settles. */
export const SPRING = { type: "spring" as const, stiffness: 520, damping: 42, mass: 0.9 }

/** Snappier pop-in spring — small elements scaling into view (swipe action buttons). */
export const POP_SPRING = { stiffness: 700, damping: 24, mass: 0.6 }

/** Light tap-feedback spring (glass containers). */
export const TAP_SPRING = { type: "spring" as const, stiffness: 400, damping: 25, duration: 0.15 }

/** Bouncy overshoot bezier — gravity blob position, pill scroll re-show. */
export const OVERSHOOT_BEZIER = "cubic-bezier(0.34, 1.5, 0.64, 1)"

/** Ease-out that settles slightly faster than the overshoot (size trailing position → stretch). */
export const SETTLE_BEZIER = "cubic-bezier(0.22, 1, 0.36, 1)"

/** Standard ease for non-bouncy morphs (nav pill ↔ sidebar). */
export const MORPH_EASE = "cubic-bezier(0.4, 0, 0.2, 1)"

/** Enter/exit transition for list items (filter changes, add/remove). */
export const LIST_ITEM_TRANSITION = { duration: 0.18, ease: [0.22, 1, 0.36, 1] as const }
