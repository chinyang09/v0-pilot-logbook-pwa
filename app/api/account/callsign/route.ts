import { NextResponse } from "next/server"
import { validateSession, assertSameOrigin } from "@/lib/auth/server/session"
import { verifyTOTPWithCounter } from "@/lib/auth/server/totp"
import { normalizeCallsign } from "@/lib/auth/shared/cuid"
import { getDB } from "@/lib/mongodb/client"
import { verifyStepUpAssertion, type StepUpAssertion } from "@/lib/auth/server/step-up"
import { claimTotpCounter, recordTotpFailure } from "@/lib/auth/server/totp-attempts"

export async function PUT(request: Request) {
  if (!assertSameOrigin(request)) {
    return NextResponse.json({ error: "Cross-origin request rejected" }, { status: 403 })
  }
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
    // The same throttle as the TOTP login: this endpoint accepts a code too,
    // and without one it was an unlimited guessing oracle for a signed-in
    // session.
    if (((user.auth?.totpLockUntil as number | undefined) ?? 0) > Date.now()) {
      return NextResponse.json({ error: "Too many attempts. Try again later." }, { status: 429 })
    }
    // Verify TOTP code, then claim its time-step — single use, shared with the
    // TOTP login, and atomic (see totp-attempts.ts).
    const { valid, counter } = await verifyTOTPWithCounter(user.auth.totpSecret, totpCode as string)
    if (!valid || !(await claimTotpCounter(db, user._id, counter, { clearFailures: true }))) {
      await recordTotpFailure(db, user._id)
      return NextResponse.json({ error: "Invalid TOTP code" }, { status: 403 })
    }
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
