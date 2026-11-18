/**
 * A stored `feedback` document as the app reads it — pure, so the route and
 * its tests share one reading. Tolerant of what the collection may hold: a
 * reply written by hand, the legacy single `response`, a missing field.
 */

import {
  FEEDBACK_LIMITS,
  type FeedbackContext,
  type FeedbackItem,
  type FeedbackMessage,
  type FeedbackStatus,
} from "./types"

export const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "")

export function contextOf(raw: unknown): FeedbackContext {
  const c = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>
  return {
    route: str(c.route, 200),
    build: str(c.build, 80),
    userAgent: str(c.userAgent, 400),
    viewport: str(c.viewport, 40),
    standalone: c.standalone === true,
    online: c.online !== false,
  }
}

export const FEEDBACK_STATUSES: readonly FeedbackStatus[] = ["open", "planned", "done", "wontfix"]
const ms = (v: unknown) => (v instanceof Date ? v.getTime() : Number(v) || 0)

function messagesOf(raw: unknown): FeedbackMessage[] {
  if (!Array.isArray(raw)) return []
  return raw.flatMap((m): FeedbackMessage[] => {
    if (!m || typeof m !== "object") return []
    const r = m as Record<string, unknown>
    const event = FEEDBACK_STATUSES.includes(r.event as FeedbackStatus) ? (r.event as FeedbackStatus) : undefined
    return [
      {
        id: str(r.id, 64) || `m-${ms(r.at)}`,
        from: r.from === "team" ? "team" : "pilot",
        text: str(r.text, FEEDBACK_LIMITS.message),
        at: ms(r.at),
        ...(event ? { event } : {}),
      },
    ]
  })
}

/** A stored report as the app reads it. */
export function itemOf(r: Record<string, unknown>): FeedbackItem {
  const createdAt = ms(r.createdAt)
  const messages = messagesOf(r.messages)
  // The first replies were one `response` string; it reads as a team reply.
  if (typeof r.response === "string" && r.response.trim() && !messages.some((m) => m.id === "response")) {
    messages.push({ id: "response", from: "team", text: r.response, at: ms(r.respondedAt) || ms(r.updatedAt) || createdAt })
  }
  messages.sort((a, b) => a.at - b.at)
  return {
    id: String(r.id),
    kind: r.kind as FeedbackItem["kind"],
    area: r.area as FeedbackItem["area"],
    title: String(r.title ?? ""),
    details: String(r.details ?? ""),
    context: contextOf(r.context),
    writtenAt: ms(r.writtenAt),
    status: FEEDBACK_STATUSES.includes(r.status as FeedbackStatus) ? (r.status as FeedbackStatus) : "open",
    createdAt,
    updatedAt: Math.max(ms(r.updatedAt), createdAt, ...messages.map((m) => m.at)),
    messages,
  }
}

