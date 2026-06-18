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
 * Find the scroll container the user is actually looking at within `root`.
 *
 * `root` can hold several stacked scroll containers (the keep-alive page stack):
 * inactive pages stay mounted as `visibility:hidden` and keep their `scrollTop`,
 * so a naive "first with scrollTop > 0" could lock onto a hidden page. We skip
 * anything that is not currently visible and prefer the first scrolled one,
 * falling back to the first visible candidate.
 */
export function findVisibleScrollTarget(root: ParentNode): HTMLElement | null {
  const candidates = root.querySelectorAll<HTMLElement>(
    "[data-scroll-container], .overflow-y-auto, .overflow-auto",
  )
  let fallback: HTMLElement | null = null
  for (const el of candidates) {
    if (el.getClientRects().length === 0) continue
    if (getComputedStyle(el).visibility === "hidden") continue
    if (el.scrollTop > 0) return el
    if (!fallback) fallback = el
  }
  return fallback
}
