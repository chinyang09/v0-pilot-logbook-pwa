/**
 * Smoothly scroll an element's content back to the top (ease-out cubic).
 */
export function smoothScrollElementToTop(el: HTMLElement, duration = 300): void {
  const start = el.scrollTop
  if (start <= 0) return
  const startTime = performance.now()
  const tick = (now: number) => {
    const progress = Math.min((now - startTime) / duration, 1)
    const ease = 1 - Math.pow(1 - progress, 3)
    el.scrollTop = start * (1 - ease)
    if (progress < 1) requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
}

/**
 * Scroll the currently-visible page's scroll container back to the top.
 *
 * Scoped to the main content area (`[data-app-main]`) so it never grabs the
 * sidebar nav, and it skips the keep-alive pages that are mounted-but-hidden
 * (visibility:hidden) so we always target the page the user is actually looking
 * at. Used by the nav pill's "tap the active tab to scroll to top" gesture, the
 * mobile counterpart of the desktop tap-the-header behaviour.
 */
export function scrollActivePageToTop(): void {
  if (typeof document === "undefined") return
  const root = document.querySelector("[data-app-main]") ?? document
  const candidates = root.querySelectorAll<HTMLElement>(
    "[data-scroll-container], .overflow-y-auto, .overflow-auto",
  )
  let fallback: HTMLElement | null = null
  for (const el of candidates) {
    if (el.getClientRects().length === 0) continue
    if (getComputedStyle(el).visibility === "hidden") continue
    if (el.scrollTop > 0) {
      smoothScrollElementToTop(el)
      return
    }
    if (!fallback) fallback = el
  }
  if (fallback) smoothScrollElementToTop(fallback)
}
