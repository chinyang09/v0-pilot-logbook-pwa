/**
 * The panel widths, in ONE place.
 *
 * The main panel has exactly two widths and everything else is derived from
 * them, so they cannot be picked independently. What constrains them:
 *
 * - **A panel is a phone.** Both the main list and the detail pane must stay at
 *   least a phone wide (360px — the common Android/iPhone logical width), so a
 *   panel is always laying out the same component tree the mobile view does.
 *   That is why `SINGLE_MONTH` and `DETAIL_MIN` are the same number.
 * - **The wide main panel is two months.** 600px gives each month pane 300px,
 *   i.e. 7 columns of ~42px — smaller than the single month's ~48px cells, and
 *   about where iOS's own two-up month view sits.
 * - **iPad Air 5 landscape (1180 x 820) has to fit all three**, with the
 *   sidebar OPEN and pushing (that tier starts at 1120):
 *
 *       1180 − 199 (sidebar + margins) − 1 (divider) = 980 available
 *       600 (two months) + 360 (detail) = 960          → 20px spare
 *
 *   At the previous 620 that sum was exactly 980 — it fit with ZERO slack, so
 *   any rounding or a scrollbar took the dual-month toggle away on the owner's
 *   own device. The 20px is the whole reason for 600 over 620.
 *
 * Note the nav pill is NOT part of this budget. The header's action groups are
 * anchored to the VIEWPORT edges, not to the panels, so where the pill sits
 * relative to them does not change with the panel split.
 */

/** Main panel showing one calendar month — also the minimum a panel may be. */
export const SINGLE_MONTH_PX = 360
/** Main panel showing two calendar months side by side. */
export const DUAL_MONTH_PX = 600
/** The detail pane never goes below a phone width either. */
export const DETAIL_MIN_PX = 360
/** Below this the split makes no sense — one panel, mobile layout. */
export const SPLIT_MIN_PX = SINGLE_MONTH_PX + DETAIL_MIN_PX

/**
 * How wide ONE month pane is inside the split layout.
 *
 * A month's day cells are square, so its width sets its HEIGHT. If the single
 * month were wider than a dual pane the calendar would be taller with one
 * month than with two, and toggling the panel width would resize the panel
 * that the flight list has to absorb — the owner's word for it was
 * "disruptive". So in the split layout the calendar is ALWAYS one pane wide,
 * and the single month is centred in its 360px panel rather than filling it.
 *
 * The number is the dual panel minus the page's `px-2` calendar gutter, halved,
 * minus the pane's own `px-1` — the grid box a dual pane actually gets:
 *
 *     (600 − 16) / 2 − 8 = 284      → 7 columns of ~39px, identical either way
 *
 * It does NOT apply on a phone, where there is no dual mode to match and the
 * calendar should use the width it has (see `paneMaxWidth` on LogbookCalendar).
 */
export const MONTH_PANE_PX = (DUAL_MONTH_PX - 16) / 2 - 8
