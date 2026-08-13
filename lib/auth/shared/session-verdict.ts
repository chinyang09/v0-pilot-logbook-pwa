/**
 * Classifying the answer to "is my session still valid?".
 *
 * THREE states, not two. The two-state version — `!data.authenticated` — is
 * what used to log an offline user out of the app.
 *
 * The trap is that a `fetch` which RESOLVES is not proof the server answered.
 * `public/sw.js` turns a failed API request into a resolved
 * `503 {error:"Offline", offline:true}` so callers can render an offline state.
 * That body parses perfectly well as JSON, has no `authenticated` key, and so
 * reads as "not authenticated" to anything that only inspects the body. The
 * same hole swallows a 500 from a MongoDB cold start.
 *
 * `unknown` therefore means "the server did not answer" and must never end a
 * session. Only an authoritative answer may.
 *
 * This is safe precisely because nothing that grants ACCESS depends on it:
 * every API route validates the session server-side on every request, so a
 * stale "alive" belief on the client buys nothing. All this flag controls is
 * whether the UI throws the user at the login screen.
 */

export type SessionVerdict = "valid" | "invalid" | "unknown"

export interface SessionResponseFacts {
  /** `Response.ok` — a non-2xx is the server failing to answer, not saying "no". */
  ok: boolean
  /** The service worker's `X-SW-Offline` header, when present. */
  swOffline?: string | null
  /** The parsed JSON body, or undefined if it could not be parsed. */
  body?: unknown
}

export function classifySessionResponse({
  ok,
  swOffline,
  body,
}: SessionResponseFacts): SessionVerdict {
  if (!ok) return "unknown"
  if (swOffline === "1") return "unknown"

  const parsed = body as { authenticated?: unknown; offline?: unknown } | undefined
  if (!parsed || typeof parsed !== "object") return "unknown"
  if (parsed.offline === true) return "unknown"

  // The server states this explicitly. A missing key is an unrecognised
  // payload — an error envelope, a proxy's interstitial, a captive portal's
  // JSON — not a denial.
  if (typeof parsed.authenticated !== "boolean") return "unknown"

  return parsed.authenticated ? "valid" : "invalid"
}
