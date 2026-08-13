import { NextResponse } from "next/server"
import { validateSession, assertSameOrigin } from "@/lib/auth/server/session"
import { getDB } from "@/lib/mongodb/client"
import { cookies } from "next/headers"
import { ObjectId } from "mongodb"

export async function GET() {
  const session = await validateSession()
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const db = await getDB()
  const cookieStore = await cookies()
  const currentToken = cookieStore.get("session")?.value

  const sessions = await db
    .collection("sessions")
    .find({
      userId: session.userId,
      expiresAt: { $gt: new Date() },
    })
    .sort({ lastAccessedAt: -1 })
    .toArray()

  // Never expose the session token (the bearer secret) to client JS — hand out
  // the opaque session id for revocation and compute "current" server-side.
  // The raw User-Agent is the user's own and is parsed into a device label
  // client-side for the "Active Sessions" list.
  const sanitized = sessions.map((s) => ({
    id: s._id.toString(),
    isCurrent: s.token === currentToken,
    createdAt: s.createdAt,
    lastAccessedAt: s.lastAccessedAt || s.createdAt,
    expiresAt: s.expiresAt,
    recoveryLogin: s.recoveryLogin || false,
    userAgent: typeof s.userAgent === "string" ? s.userAgent : null,
  }))

  return NextResponse.json({ sessions: sanitized })
}

export async function DELETE(request: Request) {
  if (!assertSameOrigin(request)) {
    return NextResponse.json({ error: "Cross-origin request rejected" }, { status: 403 })
  }
  const session = await validateSession()
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = await request.json().catch(() => ({}))
  const { sessionId, all } = body as { sessionId?: string; all?: boolean }

  const db = await getDB()
  const cookieStore = await cookies()
  const currentToken = cookieStore.get("session")?.value

  // "Logout of all devices": drop every session row for this user (including the
  // current one). The client clears its local cookie/data via the logout flow.
  if (all === true) {
    await db.collection("sessions").deleteMany({ userId: session.userId })
    return NextResponse.json({ success: true, loggedOutCurrent: true })
  }

  if (!sessionId) {
    return NextResponse.json({ error: "Session id is required" }, { status: 400 })
  }

  let objectId: ObjectId
  try {
    objectId = new ObjectId(sessionId)
  } catch {
    return NextResponse.json({ error: "Invalid session id" }, { status: 400 })
  }

  // Look up the target session scoped to this user. Logout management now lives
  // entirely in the sessions list, so revoking the *current* device's session is
  // allowed and signals the client to run its local logout/cleanup.
  const target = await db.collection("sessions").findOne({ _id: objectId, userId: session.userId })
  if (!target) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 })
  }

  await db.collection("sessions").deleteOne({ _id: objectId, userId: session.userId })

  const loggedOutCurrent = !!currentToken && target.token === currentToken
  return NextResponse.json({ success: true, loggedOutCurrent })
}
