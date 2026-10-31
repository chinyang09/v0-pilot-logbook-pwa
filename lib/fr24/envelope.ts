/**
 * The lookup envelope — 200 `{ ok, data, source }`, 404 nothing found, 502
 * the lookup could not be made — read the same way at every hop: the Worker
 * (`callFr24Worker`), the Node → Edge hand-off (`lookupFromEdge`) and the
 * browser (`lookupGet`). Each used to parse it by hand, and they disagreed on
 * the one case that matters: an answer that is NOT the envelope (a sign-in
 * page, a platform error, a deploy without the route) read as "not found"
 * in the browser and as "could not be made" on the server.
 *
 * Pure — no fetch, no env — so the browser, Edge and Node all import it.
 */

import type { Fr24Result } from "./types"

/** Query parameters with `undefined` and "" left out, so an absent filter is not sent as `key=`. */
export function setQuery(url: URL, params: Record<string, string | number | undefined>): URL {
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") url.searchParams.set(key, String(value))
  }
  return url
}

/**
 * A response's status and parsed body as a result. Anything that is not the
 * envelope — no JSON object at all — is 502: the lookup was not made, which a
 * caller must never read as "nothing found" (that sends a pilot to manual
 * entry for an aeroplane the source knows).
 */
export function readEnvelope<T>(status: number, body: unknown): Fr24Result<T> {
  const envelope = body && typeof body === "object" ? (body as { ok?: unknown; data?: unknown; source?: unknown; error?: unknown }) : null
  if (status >= 200 && status < 300 && envelope?.ok === true) {
    return { ok: true, status, data: envelope.data as T, source: typeof envelope.source === "string" ? envelope.source : "" }
  }
  const error = typeof envelope?.error === "string" && envelope.error ? envelope.error : `HTTP ${status}`
  return { ok: false, status: envelope && status >= 400 ? status : 502, error }
}
