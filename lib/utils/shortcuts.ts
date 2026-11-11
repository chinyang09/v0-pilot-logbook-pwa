/**
 * Whether a key press is a SHORTCUT, or belongs to something else.
 *
 * The app runs on tablets with a keyboard attached (an iPad's, a Chromebook's)
 * and in desktop windows, where reaching for the glass every time is the slow
 * way round. One gate for every shortcut, so they agree on when to stand down:
 *
 * - a modifier is held (the browser's and the OS's own shortcuts),
 * - the press is in a field, a wheel or anything editable,
 * - a dialog, a menu or a sheet is open (its own keys apply),
 * - or something already handled it.
 *
 * | Key | Does | Where |
 * |---|---|---|
 * | `1`–`4` | the nav's tabs, in the pilot's own order | everywhere |
 * | `/` | search | logbook |
 * | `N` | new flight | logbook |
 * | `↑` `↓` | the flight above / below the open one | logbook, beside its panel |
 */
export function isShortcut(e: KeyboardEvent): boolean {
  if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || e.isComposing) return false
  const el = e.target as HTMLElement | null
  if (el) {
    const tag = el.tagName
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable) return false
    if (el.closest?.('[role="dialog"], [role="menu"], [role="listbox"], [data-rwp]')) return false
  }
  if (typeof document !== "undefined" && document.querySelector('[role="dialog"][aria-modal="true"], [role="menu"]')) {
    return false
  }
  return true
}
