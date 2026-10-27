/**
 * Run `fn` when the main thread is next idle (within `timeout`), never inside
 * the task that asked for it.
 *
 * For work that keeps data honest but is not what the user is waiting on —
 * the re-read a kept-alive page does when it is shown again. Run inside the
 * tab switch, it was a full read of the table, a deep compare and a render
 * stacked on the very frame the page was supposed to appear in. Every write
 * path already updates the shared cache, so the re-read is a safety net and
 * can wait a beat. (No `requestIdleCallback` — older Safari — falls back to a
 * short timeout: same order of events, coarser timing.)
 */
export function whenIdle(fn: () => void, timeout = 1000): void {
  if (typeof window === "undefined") return
  if (typeof window.requestIdleCallback === "function") {
    window.requestIdleCallback(() => fn(), { timeout })
  } else {
    window.setTimeout(fn, 200)
  }
}
