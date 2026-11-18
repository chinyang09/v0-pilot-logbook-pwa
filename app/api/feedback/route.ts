import { NextResponse } from "next/server"
import { assertSameOrigin, validateSession } from "@/lib/auth/server/session"
import { getDB } from "@/lib/mongodb/client"
import {
  FEEDBACK_AREAS,
  FEEDBACK_KINDS,
  feedbackProblem,
  FEEDBACK_LIMITS,
  isClosedStatus,
  type FeedbackItem,
  type FeedbackStatus,
} from "@/lib/feedback/types"
import { FEEDBACK_STATUSES, contextOf, itemOf, str } from "@/lib/feedback/stored"

/**
 * In-app feedback. POST files a report (idempotent on the device's id, so the
 * outbox can resend one safely); GET lists the signed-in pilot's own, newest
 * first; PATCH adds the pilot's follow-up to a report's conversation, or
 * marks it done / reopens it. Replies and "planned" / "won't do" are written on
 * the `feedback` collection by whoever works through it — a `messages` entry
 * `{ from: "team" }`, or the legacy single `response`.
 */

async function sessionOr(request?: Request) {
  if (request && !assertSameOrigin(request)) {
    return { error: NextResponse.json({ error: "Cross-origin request rejected" }, { status: 403 }) }
  }
  const session = await validateSession().catch(() => undefined)
  if (session === undefined) return { error: NextResponse.json({ error: "Session store unavailable" }, { status: 503 }) }
  if (!session) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) }
  return { session }
}

export async function POST(request: Request) {
  const { session, error } = await sessionOr(request)
  if (error) return error

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  const id = str(body?.id, 64)
  const draft = {
    kind: body?.kind as FeedbackItem["kind"],
    area: body?.area as FeedbackItem["area"],
    title: str(body?.title, 1000).trim(),
    details: str(body?.details, 10_000),
  }
  const problem = !/^[A-Za-z0-9_-]{8,64}$/.test(id) ? "Missing report id" : feedbackProblem(draft)
  if (problem || !FEEDBACK_KINDS.includes(draft.kind) || !FEEDBACK_AREAS.includes(draft.area)) {
    return NextResponse.json({ error: problem ?? "Invalid report" }, { status: 400 })
  }

  const writtenAt = typeof body?.writtenAt === "number" && Number.isFinite(body.writtenAt) ? body.writtenAt : Date.now()
  const db = await getDB()
  const now = new Date()
  // Insert once; a resend of the same id changes nothing it already holds.
  await db.collection("feedback").updateOne(
    { userId: session.userId, id },
    {
      $setOnInsert: {
        userId: session.userId,
        callsign: session.callsign,
        id,
        ...draft,
        context: contextOf(body?.context),
        writtenAt: new Date(writtenAt),
        status: "open" satisfies FeedbackStatus,
        messages: [],
        createdAt: now,
        updatedAt: now,
      },
    },
    { upsert: true },
  )
  return NextResponse.json({ ok: true, id })
}

export async function GET() {
  const { session, error } = await sessionOr()
  if (error) return error

  const db = await getDB()
  const rows = await db
    .collection("feedback")
    .find({ userId: session.userId })
    .sort({ createdAt: -1 })
    .limit(200)
    .toArray()
  return NextResponse.json({ items: rows.map((r) => itemOf(r as Record<string, unknown>)) })
}

/**
 * The pilot's side of a report's conversation: a follow-up (which reopens a
 * closed report), marking it done, or reopening it. Each writes an entry in
 * `messages`, so the report shows what happened and when. A follow-up carries
 * the device's id for it, so a retried send adds it once.
 */
export async function PATCH(request: Request) {
  const { session, error } = await sessionOr(request)
  if (error) return error

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  const id = str(body?.id, 64)
  const action = body?.action
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(id) || (action !== "message" && action !== "complete" && action !== "reopen")) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 })
  }

  const db = await getDB()
  const feedback = db.collection("feedback")
  const filter = { userId: session.userId, id }
  const doc = await feedback.findOne(filter)
  if (!doc) return NextResponse.json({ error: "No such report" }, { status: 404 })
  const status = FEEDBACK_STATUSES.includes(doc.status as FeedbackStatus) ? (doc.status as FeedbackStatus) : "open"
  const now = new Date()

  if (action === "message") {
    const messageId = str(body?.messageId, 64)
    const text = str(body?.text, FEEDBACK_LIMITS.message + 1).trim()
    if (!/^[A-Za-z0-9_-]{8,64}$/.test(messageId) || !text || text.length > FEEDBACK_LIMITS.message) {
      return NextResponse.json({ error: "Write a follow-up" }, { status: 400 })
    }
    const entries: Record<string, unknown>[] = [{ id: messageId, from: "pilot", text, at: now }]
    if (isClosedStatus(status)) entries.push({ id: `${messageId}-reopen`, from: "pilot", text: "Reopened", at: now, event: "open" })
    // Once per message id: a resend after a lost answer finds it there.
    await feedback.updateOne(
      { ...filter, "messages.id": { $ne: messageId } },
      {
        $push: { messages: { $each: entries } },
        $set: { updatedAt: now, ...(isClosedStatus(status) ? { status: "open" } : {}) },
      } as never,
    )
  } else {
    const next: FeedbackStatus = action === "complete" ? "done" : "open"
    if (next !== status) {
      await feedback.updateOne(filter, {
        $push: {
          messages: {
            id: `${action}-${now.getTime()}`,
            from: "pilot",
            text: action === "complete" ? "Marked done" : "Reopened",
            at: now,
            event: next,
          },
        },
        $set: { status: next, updatedAt: now },
      } as never)
    }
  }

  const updated = await feedback.findOne(filter)
  return NextResponse.json({ item: itemOf((updated ?? doc) as Record<string, unknown>) })
}
