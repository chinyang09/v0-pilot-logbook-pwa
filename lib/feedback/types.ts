/**
 * In-app feedback: a bug, a feature or a tweak, written on the go and kept in
 * MongoDB (`feedback`) for the work it asks for to be picked up later.
 * Shared by the page, the outbox and the route, so the three agree on what a
 * report is and what makes one valid.
 */

export const FEEDBACK_KINDS = ["bug", "feature", "tweak"] as const
export type FeedbackKind = (typeof FEEDBACK_KINDS)[number]

export const FEEDBACK_KIND_LABEL: Record<FeedbackKind, string> = {
  bug: "Bug",
  feature: "New Feature",
  tweak: "Tweak",
}

/** Where in the app it is about — the sidebar's destinations, and what is not one. */
export const FEEDBACK_AREAS = [
  "Dashboard",
  "Logbook",
  "Flight Form",
  "Calendar",
  "Import",
  "Aircraft",
  "Airports",
  "Crew",
  "Currencies",
  "FDP",
  "Discrepancies",
  "Sync",
  "Settings",
  "Account",
  "Other",
] as const
export type FeedbackArea = (typeof FEEDBACK_AREAS)[number]

/**
 * Where a report stands. "planned" and "wontfix" are set by whoever works
 * through the list (on the collection); the PILOT can mark a report done and
 * reopen it, and a follow-up on a closed report reopens it — "still broken in
 * the next build" is the commonest follow-up there is.
 */
export type FeedbackStatus = "open" | "planned" | "done" | "wontfix"

export const FEEDBACK_STATUS_LABEL: Record<FeedbackStatus, string> = {
  open: "Open",
  planned: "Planned",
  done: "Done",
  wontfix: "Won't Do",
}

/** What a status means, in one line under it. */
export const FEEDBACK_STATUS_MEANING: Record<FeedbackStatus, string> = {
  open: "Received, not worked on yet.",
  planned: "Being worked on.",
  done: "Done. If it isn't, add a follow-up — that reopens it.",
  wontfix: "Not going ahead. A follow-up reopens it.",
}

export const isClosedStatus = (s: FeedbackStatus) => s === "done" || s === "wontfix"

/**
 * One entry in a report's conversation: a follow-up from the pilot, a reply
 * from whoever works on it, or a status change (`event`) — so a report reads
 * as what happened to it, not a bare "Open".
 */
export interface FeedbackMessage {
  id: string
  from: "pilot" | "team"
  text: string
  /** ms */
  at: number
  /** A status change rather than words: the text is what it says. */
  event?: FeedbackStatus
}

/** What the device knew when the report was written — for reproducing it. */
export interface FeedbackContext {
  /** The page the report was written about, or from. */
  route: string
  build: string
  userAgent: string
  /** "390×844 @3x" */
  viewport: string
  standalone: boolean
  online: boolean
}

export interface FeedbackDraft {
  /** Given by the device, so a resend from the outbox is the same report. */
  id: string
  kind: FeedbackKind
  area: FeedbackArea
  title: string
  details: string
  context: FeedbackContext
  /** When it was written (ms) — it may be sent later, from the outbox. */
  writtenAt: number
}

export interface FeedbackItem extends FeedbackDraft {
  status: FeedbackStatus
  /** When the server received it (ms). */
  createdAt: number
  /** The last thing that happened to it (ms) — a message or a status change. */
  updatedAt: number
  /** Oldest first. A legacy single `response` is read in as a team reply. */
  messages: FeedbackMessage[]
}

export type FeedbackAction =
  | { action: "message"; messageId: string; text: string }
  | { action: "complete" }
  | { action: "reopen" }

/** Did the team say something after the pilot last did? */
export function hasUnansweredReply(item: Pick<FeedbackItem, "messages">): boolean {
  for (let i = item.messages.length - 1; i >= 0; i--) {
    const m = item.messages[i]
    if (m.event) continue
    return m.from === "team"
  }
  return false
}

export const FEEDBACK_LIMITS = { title: 140, details: 4000, message: 4000 } as const

/** Why a draft cannot be sent, in words — or null when it can. */
export function feedbackProblem(d: Pick<FeedbackDraft, "kind" | "area" | "title" | "details">): string | null {
  if (!FEEDBACK_KINDS.includes(d.kind)) return "Choose what it is"
  if (!FEEDBACK_AREAS.includes(d.area)) return "Choose where it is"
  const title = d.title.trim()
  if (!title) return "Give it a title"
  if (title.length > FEEDBACK_LIMITS.title) return `Title is over ${FEEDBACK_LIMITS.title} characters`
  if (d.details.length > FEEDBACK_LIMITS.details) return `Details are over ${FEEDBACK_LIMITS.details} characters`
  return null
}
