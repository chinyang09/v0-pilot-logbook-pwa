import { NextResponse } from "next/server"
import { validateSession } from "@/lib/auth/server/session"
import { verifyTOTPWithCounter } from "@/lib/auth/server/totp"
import { normalizeCallsign } from "@/lib/auth/shared/cuid"
import { getDB } from "@/lib/mongodb/client"
import { verifyStepUpAssertion, type StepUpAssertion } from "@/lib/auth/server/step-up"

export async function PUT(request: Request) {
  const session = await validateSession()
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = await request.json()
  const { newCallsign, totpCode, assertion } = body as {
    newCallsign?: string
    totpCode?: string
    assertion?: StepUpAssertion
  }

  if (!newCallsign || typeof newCallsign !== "string" || newCallsign.trim().length < 2) {
    return NextResponse.json({ error: "Callsign must be at least 2 characters" }, { status: 400 })
  }

  // The change must be authorized by one of two strong factors: a passkey
  // step-up OR a TOTP code. (Passkey lets a user who lost their authenticator
  // still rename their account.)
  if (!totpCode && !assertion) {
    return NextResponse.json({ error: "Verification required" }, { status: 400 })
  }

  const trimmedCallsign = newCallsign.trim()
  const searchKey = normalizeCallsign(trimmedCallsign)

  const db = await getDB()

  // Get user to verify the chosen factor.
  const user = await db.collection("users").findOne({ _id: session.userId as unknown as import("mongodb").ObjectId })
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 })
  }

  if (assertion) {
    const host = request.headers.get("host") || undefined
    const proto = request.headers.get("x-forwarded-proto") || undefined
    const verified = await verifyStepUpAssertion(db, session.userId, assertion, host, proto)
    if (!verified) {
      return NextResponse.json({ error: "Passkey verification failed" }, { status: 403 })
    }
  } else {
    if (!user.auth?.totpSecret) {
      return NextResponse.json({ error: "TOTP not configured" }, { status: 400 })
    }
    // Verify TOTP code (with single-use replay protection shared across flows)
    const { valid, counter } = await verifyTOTPWithCounter(user.auth.totpSecret, totpCode as string)
    if (!valid) {
      return NextResponse.json({ error: "Invalid TOTP code" }, { status: 403 })
    }
    const lastCounter = (user.auth?.lastTotpCounter as number | undefined) ?? -1
    if (counter <= lastCounter) {
      return NextResponse.json({ error: "Invalid TOTP code" }, { status: 403 })
    }
    await db.collection("users").updateOne(
      { _id: session.userId as unknown as import("mongodb").ObjectId },
      { $set: { "auth.lastTotpCounter": counter } }
    )
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
