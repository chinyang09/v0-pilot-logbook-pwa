/**
 * Sending feedback from the device. A report written offline — on the ramp,
 * in the air — waits in an OUTBOX on this device and goes the next time the
 * app is online; it carries the id it was given when written, so a resend
 * after a lost answer is the same report, not a second one.
 *
 * The outbox is per signed-in pilot and per device (localStorage): a report
 * is never sent under another account than the one that wrote it.
 */

import type { FeedbackAction, FeedbackContext, FeedbackDraft, FeedbackItem } from "./types"

const KEY = (userId: string) => `oooi:feedback-outbox:${userId}`

export function readOutbox(userId: string): FeedbackDraft[] {
  try {
    const raw = localStorage.getItem(KEY(userId))
    const parsed = raw ? (JSON.parse(raw) as unknown) : []
    return Array.isArray(parsed) ? (parsed as FeedbackDraft[]) : []
  } catch {
    return []
  }
}

function writeOutbox(userId: string, items: FeedbackDraft[]) {
  try {
    if (items.length) localStorage.setItem(KEY(userId), JSON.stringify(items))
    else localStorage.removeItem(KEY(userId))
  } catch {
    // Storage refused (private mode): the report is still sent when it can be.
  }
  notify()
}

const listeners = new Set<() => void>()
function notify() {
  for (const l of listeners) l()
}
/** Called whenever the outbox changes (a write, a send). */
export function subscribeOutbox(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** The page the report is about: where the pilot was before opening Feedback. */
let lastRoute = ""
export function rememberRoute(pathname: string) {
  if (!pathname.startsWith("/feedback")) lastRoute = pathname
}

export function captureContext(): FeedbackContext {
  const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1
  return {
    route: lastRoute || "/",
    build: process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA?.slice(0, 7) || "dev",
    userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "",
    viewport:
      typeof window !== "undefined" ? `${window.innerWidth}×${window.innerHeight} @${Math.round(dpr * 10) / 10}x` : "",
    standalone: typeof window !== "undefined" && window.matchMedia?.("(display-mode: standalone)").matches === true,
    online: typeof navigator === "undefined" || navigator.onLine,
  }
}

export function newFeedbackId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `fb-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

async function post(draft: FeedbackDraft): Promise<"sent" | "rejected" | "later"> {
  try {
    const res = await fetch("/api/feedback", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(draft),
      signal: AbortSignal.timeout(15_000),
    })
    if (res.ok) return "sent"
    // A report the server refuses as written will be refused every time.
    return res.status === 400 ? "rejected" : "later"
  } catch {
    return "later"
  }
}

/**
 * Send a report now, or keep it for later. Resolves to what happened, so the
 * page can say "Sent" or "Will send when online".
 */
export async function submitFeedback(userId: string, draft: FeedbackDraft): Promise<"sent" | "queued" | "rejected"> {
  const result = await post(draft)
  if (result === "later") {
    writeOutbox(userId, [...readOutbox(userId).filter((d) => d.id !== draft.id), draft])
    return "queued"
  }
  return result
}

let flushing: Promise<number> | null = null
/** Send what is waiting. Resolves to how many went. One flush at a time. */
export function flushOutbox(userId: string): Promise<number> {
  flushing ??= (async () => {
    let sent = 0
    try {
      for (const draft of readOutbox(userId)) {
        const result = await post(draft)
        if (result === "later") break
        writeOutbox(userId, readOutbox(userId).filter((d) => d.id !== draft.id))
        if (result === "sent") sent++
      }
    } finally {
      flushing = null
    }
    return sent
  })()
  return flushing
}

export async function fetchFeedback(): Promise<FeedbackItem[]> {
  const res = await fetch("/api/feedback", { signal: AbortSignal.timeout(15_000) })
  if (!res.ok) throw new Error(`Feedback answered ${res.status}`)
  const body = (await res.json()) as { items?: FeedbackItem[] }
  return body.items ?? []
}

/**
 * The pilot's side of a report's conversation — a follow-up, done, reopen.
 * Online only: it answers with the report as the server now holds it, which
 * is what the panel shows. Throws with a sentence the panel can print.
 */
export async function actOnFeedback(id: string, act: FeedbackAction): Promise<FeedbackItem> {
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    throw new Error("You're offline — try again once you're online.")
  }
  let res: Response
  try {
    res = await fetch("/api/feedback", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id, ...act }),
      signal: AbortSignal.timeout(15_000),
    })
  } catch {
    throw new Error("Couldn't reach the server. Try again.")
  }
  const body = (await res.json().catch(() => null)) as { item?: FeedbackItem; error?: string } | null
  if (!res.ok || !body?.item) throw new Error(body?.error || "Couldn't save that. Try again.")
  return body.item
}
