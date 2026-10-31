/**
 * Server-side client for the FR24 gateway Worker (`cloudflare-worker/`).
 *
 * Reads FR24_PROXY_URL / FR24_PROXY_SECRET, so it is server-only — the secret
 * must never reach a browser. The PWA reaches the same routes through
 * `/api/lookup/[...path]` (see `lib/lookup/client.ts`). Uses only fetch +
 * AbortSignal, so it runs in the Edge and Node runtimes alike — but call it
 * only from EDGE routes: the upstream scores whoever calls the Worker and
 * challenges the Node runtime. Node code goes through `lookupFromEdge`
 * (`lib/lookup/handoff.ts`).
 */

import { readEnvelope, setQuery } from "./envelope"
import type { Fr24Result, Fr24Route, Fr24Routes } from "./types"

const WORKER_TIMEOUT_MS = 12000

/** True when a Worker is configured; without one there is nothing to call. */
export function fr24WorkerConfigured(): boolean {
  return !!process.env.FR24_PROXY_URL
}

/**
 * GET a Worker path and hand back its status and parsed body, whatever shape
 * it has — for the operator's routes (`probe`), which do not answer in the
 * normalized envelope. Never throws; a timeout or an unreachable Worker is
 * `status: 0`.
 */
export async function fetchFr24Worker(
  path: string,
  params: Record<string, string | number | undefined>,
  timeoutMs = WORKER_TIMEOUT_MS
): Promise<{ status: number; body: unknown; error?: string }> {
  const base = process.env.FR24_PROXY_URL
  if (!base) return { status: 0, body: null, error: "FR24_PROXY_URL is not set" }

  const url = setQuery(new URL(`${base.replace(/\/$/, "")}/${path}`), params)

  const headers: Record<string, string> = { Accept: "application/json" }
  const secret = process.env.FR24_PROXY_SECRET
  if (secret) headers["x-proxy-secret"] = secret

  try {
    const response = await fetch(url, {
      headers,
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    })
    return { status: response.status, body: await response.json().catch(() => null) }
  } catch (err) {
    return { status: 0, body: null, error: `${(err as Error).name}: ${(err as Error).message}` }
  }
}

/**
 * Call a normalized Worker route. Never throws.
 *
 * A Worker deployment that predates the normalized routes answers them
 * `{ error: "Path not allowed" }` with a 400 — that comes back as
 * `status: 400`. An answer that is not JSON at all is 502 (`readEnvelope`).
 */
export async function callFr24Worker<R extends Fr24Route>(
  route: R,
  params: Record<string, string | number | undefined>,
  timeoutMs = WORKER_TIMEOUT_MS
): Promise<Fr24Result<Fr24Routes[R]>> {
  const { status, body, error } = await fetchFr24Worker(route, params, timeoutMs)
  if (error) return { ok: false, status, error }
  return readEnvelope<Fr24Routes[R]>(status, body)
}
