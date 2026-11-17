import { NextResponse } from "next/server"
import { assertSameOrigin, validateSession } from "@/lib/auth/server/session"
import { getDB } from "@/lib/mongodb/client"
import {
  FEEDBACK_AREAS,
  FEEDBACK_KINDS,
  feedbackProblem,
  type FeedbackContext,
  type FeedbackItem,
  type FeedbackStatus,
} from "@/lib/feedback/types"

/**
 * In-app feedback. POST files a report (idempotent on the device's id, so the
 * outbox can resend one safely); GET lists the signed-in pilot's own, newest
 * first. Reports are read and triaged straight from the `feedback`
 * collection; nothing here changes a status.
 */

const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "")

function contextOf(raw: unknown): FeedbackContext {
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

export async function POST(request: Request) {
  if (!assertSameOrigin(request)) {
    return NextResponse.json({ error: "Cross-origin request rejected" }, { status: 403 })
  }
  const session = await validateSession().catch(() => undefined)
  if (session === undefined) return NextResponse.json({ error: "Session store unavailable" }, { status: 503 })
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

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
        createdAt: now,
      },
    },
    { upsert: true },
  )
  return NextResponse.json({ ok: true, id })
}

export async function GET() {
  const session = await validateSession().catch(() => undefined)
  if (session === undefined) return NextResponse.json({ error: "Session store unavailable" }, { status: 503 })
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const db = await getDB()
  const rows = await db
    .collection("feedback")
    .find({ userId: session.userId })
    .sort({ createdAt: -1 })
    .limit(200)
    .toArray()
  const items: FeedbackItem[] = rows.map((r) => ({
    id: String(r.id),
    kind: r.kind,
    area: r.area,
    title: String(r.title ?? ""),
    details: String(r.details ?? ""),
    context: contextOf(r.context),
    writtenAt: r.writtenAt instanceof Date ? r.writtenAt.getTime() : Number(r.writtenAt) || 0,
    status: (r.status as FeedbackStatus) ?? "open",
    createdAt: r.createdAt instanceof Date ? r.createdAt.getTime() : Number(r.createdAt) || 0,
    ...(typeof r.response === "string" && r.response ? { response: r.response } : {}),
  }))
  return NextResponse.json({ items })
}
