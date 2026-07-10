export const dynamic = "force-dynamic"

import { type NextRequest, NextResponse } from "next/server"
import { validateSession } from "@/lib/auth/server/session"
import { getDB } from "@/lib/mongodb/client"
import { verifyStepUpAssertion, type StepUpAssertion } from "@/lib/auth/server/step-up"
import { generateTOTPUri } from "@/lib/auth/server/totp"

// POST /api/account/totp/reveal — return the TOTP seed + otpauth URI so the user
// can re-add it to an authenticator (e.g. after losing the original). This is
// sensitive, so it is gated behind a fresh passkey step-up: the seed is never
// served on a plain GET and never without re-proving possession of a passkey.
export async function POST(request: NextRequest) {
  const session = await validateSession()
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = await request.json().catch(() => ({}))
  const { assertion } = body as { assertion?: StepUpAssertion }

  const db = await getDB()
  const host = request.headers.get("host") || undefined
  const proto = request.headers.get("x-forwarded-proto") || undefined

  const verified = await verifyStepUpAssertion(db, session.userId, assertion, host, proto)
  if (!verified) {
    return NextResponse.json({ error: "Passkey verification required" }, { status: 403 })
  }

  const user = await db
    .collection("users")
    .findOne({ _id: session.userId as unknown as import("mongodb").ObjectId })
  if (!user?.auth?.totpSecret) {
    return NextResponse.json({ error: "TOTP not configured" }, { status: 400 })
  }

  const callsign = user.identity?.callsign || session.callsign
  return NextResponse.json({
    secret: user.auth.totpSecret,
    uri: generateTOTPUri(user.auth.totpSecret, callsign),
  })
}
