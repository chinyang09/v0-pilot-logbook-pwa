/**
 * Recovering from a page whose code is from a deploy that no longer exists.
 *
 * The service worker serves navigations cache-first (an offline-first app has
 * to), so the first launch after a deploy runs the PREVIOUS build's HTML. Any
 * route that build never fetched the code for then asks Vercel for a chunk
 * the new deploy no longer serves, and the page dies with "Something went
 * wrong" — the currencies page did this on its first open after every deploy
 * that changed it, and "Reload App" fixed it because the worker had refreshed
 * its copy in the background by then.
 *
 * So a chunk failure is not an error to show: drop this route's stale copy
 * from the worker's page cache and reload ONCE. The guard stops a genuinely
 * missing chunk (offline, or a broken deploy) looping; the second failure is
 * shown as an error like any other.
 */

const RELOAD_KEY = "oooi:chunk-reload-at"
const RELOAD_WINDOW_MS = 60_000
/** `STATIC_CACHE` in `public/sw.js`, without its version suffix. */
const PAGE_CACHE_PREFIX = "skylog-static-"

/** True for the ways webpack and the browsers report a code chunk that would not load. */
export function isChunkLoadError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false
  const { name, message } = error as { name?: unknown; message?: unknown }
  if (name === "ChunkLoadError") return true
  return (
    typeof message === "string" &&
    /Loading (CSS )?chunk [\w-]+ failed|Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module/i.test(
      message
    )
  )
}

/** Whether a recovery reload has NOT just been tried (so trying one is safe). */
export function canRecoverFromChunkError(now = Date.now()): boolean {
  try {
    const last = Number(sessionStorage.getItem(RELOAD_KEY) ?? 0)
    return !(last > 0 && now - last < RELOAD_WINDOW_MS)
  } catch {
    return false
  }
}

/** Drop this route's cached page and reload. Call only after `canRecoverFromChunkError`. */
export async function recoverFromChunkError(): Promise<void> {
  try {
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()))
  } catch {
    // No session storage: no guard, so no reload either.
    return
  }
  try {
    const { pathname, href } = window.location
    for (const name of await caches.keys()) {
      if (!name.startsWith(PAGE_CACHE_PREFIX)) continue
      const cache = await caches.open(name)
      await Promise.all([cache.delete(pathname), cache.delete(href)])
    }
  } catch {
    // No Cache Storage (or no worker): the reload alone still fetches fresh.
  }
  window.location.reload()
}
