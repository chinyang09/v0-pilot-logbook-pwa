import { NextResponse } from "next/server"
import { validateSession } from "@/lib/auth/server/session"
import { getDB } from "@/lib/mongodb/client"
import { cookies } from "next/headers"

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

  const sanitized = sessions.map((s) => ({
    token: s.token,
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
  const { sessionToken } = body as { sessionToken?: string }

  if (!sessionToken) {
    return NextResponse.json({ error: "Session token is required" }, { status: 400 })
  }

  // Prevent revoking current session
  const cookieStore = await cookies()
  const currentToken = cookieStore.get("session")?.value

  if (sessionToken === currentToken) {
    return NextResponse.json({ error: "Cannot revoke current session" }, { status: 400 })
  }

  const db = await getDB()
  const result = await db.collection("sessions").deleteOne({
    token: sessionToken,
    userId: session.userId,
  })

  if (result.deletedCount === 0) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 })
  }

  return NextResponse.json({ success: true })
}
