export const dynamic = "force-dynamic"
export const revalidate = 0

import { type NextRequest, NextResponse } from "next/server"
import { validateSession } from "@/lib/auth/server/session"
import { getDB } from "@/lib/mongodb/client"
import { issueStepUpChallenge } from "@/lib/auth/server/step-up"

// GET /api/account/step-up — issue a user-bound WebAuthn challenge so the client
// can re-prove possession of a passkey before a sensitive account action.
export async function GET(request: NextRequest) {
  const session = await validateSession()
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const db = await getDB()
  const host = request.headers.get("host") || undefined
  const options = await issueStepUpChallenge(db, session.userId, host)

  if (!options) {
    return NextResponse.json({ error: "No passkeys registered" }, { status: 400 })
  }
  if (options.allowCredentials.length === 0) {
    return NextResponse.json({ error: "No passkeys registered" }, { status: 400 })
  }

  return NextResponse.json(options)
}
