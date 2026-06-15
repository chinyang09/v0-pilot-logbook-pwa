import { NextResponse } from "next/server"
import { validateSession } from "@/lib/auth/server/session"
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
  const sanitized = sessions.map((s) => ({
    id: s._id.toString(),
    isCurrent: s.token === currentToken,
    createdAt: s.createdAt,
    lastAccessedAt: s.lastAccessedAt || s.createdAt,
    expiresAt: s.expiresAt,
    recoveryLogin: s.recoveryLogin || false,
  }))

  return NextResponse.json({ sessions: sanitized })
}

export async function DELETE(request: Request) {
  const session = await validateSession()
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = await request.json()
  const { sessionId } = body as { sessionId?: string }

  if (!sessionId) {
    return NextResponse.json({ error: "Session id is required" }, { status: 400 })
  }

  let objectId: ObjectId
  try {
    objectId = new ObjectId(sessionId)
  } catch {
    return NextResponse.json({ error: "Invalid session id" }, { status: 400 })
  }

  const db = await getDB()

  // Look up the target session scoped to this user, then refuse to revoke the
  // one backing the current request.
  const target = await db.collection("sessions").findOne({ _id: objectId, userId: session.userId })
  if (!target) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 })
  }

  const cookieStore = await cookies()
  const currentToken = cookieStore.get("session")?.value
  if (target.token === currentToken) {
    return NextResponse.json({ error: "Cannot revoke current session" }, { status: 400 })
  }

  await db.collection("sessions").deleteOne({ _id: objectId, userId: session.userId })

  return NextResponse.json({ success: true })
}
