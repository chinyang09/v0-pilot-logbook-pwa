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

import type { Fr24Result, Fr24Route, Fr24Routes } from "./types"

const WORKER_TIMEOUT_MS = 12000

/** True when a Worker is configured; without one there is nothing to call. */
export function fr24WorkerConfigured(): boolean {
  return !!process.env.FR24_PROXY_URL
}

/**
 * Call a normalized Worker route. Never throws.
 *
 * A Worker deployment that predates the normalized routes answers them
 * `{ error: "Path not allowed" }` with a 400 — that comes back as
 * `status: 400`, and callers that have a legacy path fall back to it.
 */
export async function callFr24Worker<R extends Fr24Route>(
  route: R,
  params: Record<string, string | number | undefined>,
  timeoutMs = WORKER_TIMEOUT_MS
): Promise<Fr24Result<Fr24Routes[R]>> {
  const base = process.env.FR24_PROXY_URL
  if (!base) return { ok: false, status: 0, error: "FR24_PROXY_URL is not set" }

  const url = new URL(`${base.replace(/\/$/, "")}/${route}`)
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") url.searchParams.set(key, String(value))
  }

  const headers: Record<string, string> = { Accept: "application/json" }
  const secret = process.env.FR24_PROXY_SECRET
  if (secret) headers["x-proxy-secret"] = secret

  try {
    const response = await fetch(url, {
      headers,
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    })
    const body = (await response.json().catch(() => null)) as
      | { ok?: boolean; data?: unknown; source?: string; error?: string }
      | null

    if (response.ok && body?.ok === true) {
      return {
        ok: true,
        status: response.status,
        data: body.data as Fr24Routes[R],
        source: body.source ?? "",
      }
    }
    return {
      ok: false,
      status: response.status,
      error: body?.error || `HTTP ${response.status}`,
    }
  } catch (err) {
    return { ok: false, status: 0, error: `${(err as Error).name}: ${(err as Error).message}` }
  }
}
