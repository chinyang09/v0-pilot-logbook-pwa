import { NextResponse } from "next/server"
import { validateSession } from "@/lib/auth/server/session"
import { verifyTOTP } from "@/lib/auth/server/totp"
import { normalizeCallsign } from "@/lib/auth/shared/cuid"
import { getDB } from "@/lib/mongodb/client"

export async function PUT(request: Request) {
  const session = await validateSession()
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = await request.json()
  const { newCallsign, totpCode } = body as { newCallsign?: string; totpCode?: string }

  if (!newCallsign || typeof newCallsign !== "string" || newCallsign.trim().length < 2) {
    return NextResponse.json({ error: "Callsign must be at least 2 characters" }, { status: 400 })
  }

  if (!totpCode || typeof totpCode !== "string") {
    return NextResponse.json({ error: "TOTP code is required" }, { status: 400 })
  }

  const trimmedCallsign = newCallsign.trim()
  const searchKey = normalizeCallsign(trimmedCallsign)

  const db = await getDB()

  // Get user to verify TOTP
  const user = await db.collection("users").findOne({ _id: session.userId as unknown as import("mongodb").ObjectId })
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 })
  }

  if (!user.auth?.totpSecret) {
    return NextResponse.json({ error: "TOTP not configured" }, { status: 400 })
  }

  // Verify TOTP code
  const isValid = await verifyTOTP(user.auth.totpSecret, totpCode)
  if (!isValid) {
    return NextResponse.json({ error: "Invalid TOTP code" }, { status: 403 })
  }

  // Check if callsign is already taken by another user
  const existing = await db.collection("users").findOne({
    "identity.searchKey": searchKey,
    _id: { $ne: session.userId as unknown as import("mongodb").ObjectId },
  })

  if (existing) {
    return NextResponse.json({ error: "Callsign already taken" }, { status: 409 })
  }

  // Update user callsign
  await db.collection("users").updateOne(
    { _id: session.userId as unknown as import("mongodb").ObjectId },
    {
      $set: {
        "identity.callsign": trimmedCallsign,
        "identity.searchKey": searchKey,
        updatedAt: Date.now(),
      },
    }
  )

  // Update all active sessions with new callsign
  await db.collection("sessions").updateMany(
    { userId: session.userId },
    { $set: { callsign: trimmedCallsign } }
  )

  return NextResponse.json({ callsign: trimmedCallsign })
}
