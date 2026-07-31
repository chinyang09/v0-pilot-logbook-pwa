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

/**
 * The gravity blob's two halves. POSITION carries only a small overshoot —
 * a big one reads as the blob springing left and right to find its seat, which
 * is the mechanical-looking part. SIZE overshoots harder and runs longer, so
 * the blob arrives, overshoots its width, and compresses back: the elasticity
 * shows up as squash-and-stretch rather than as sideways bounce, which is what
 * makes it read as one fluid body instead of a rectangle being moved.
 */
export const GRAVITY_POSITION_BEZIER = "cubic-bezier(0.3, 1.22, 0.5, 1)"
export const GRAVITY_SIZE_BEZIER = "cubic-bezier(0.25, 1.45, 0.45, 1)"

/**
 * Ease for the nav pill ↔ sidebar morph geometry — an even accelerate/
 * decelerate, deliberately NOT front-loaded.
 *
 * It used to be `cubic-bezier(0.3, 0.9, 0.35, 1.02)`: a fast launch with a ~2%
 * liquid overshoot, which suited the old ~190ms groups. Over the ~1s morph the
 * app runs now that curve puts the collapse 94% of the way home in the first
 * HALF of its duration — it reads as a snap followed by a long crawl, and the
 * 2% overshoot at that length is a visible wobble at the end rather than
 * surface tension. This curve spends its time evenly, so the collapse and the
 * slide into place feel like one continuous motion.
 */
export const MORPH_EASE = "cubic-bezier(0.4, 0.02, 0.2, 1)"

/** Enter/exit transition for list items (filter changes, add/remove). */
export const LIST_ITEM_TRANSITION = { duration: 0.18, ease: [0.22, 1, 0.36, 1] as const }
