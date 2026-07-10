import { NextResponse } from "next/server"
import { validateSession } from "@/lib/auth/server/session"
import { getDB } from "@/lib/mongodb/client"

export async function GET() {
  const session = await validateSession()
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const db = await getDB()
  const user = await db.collection("users").findOne({ _id: session.userId as unknown as import("mongodb").ObjectId })

  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 })
  }

  const sessionCount = await db.collection("sessions").countDocuments({
    userId: session.userId,
    expiresAt: { $gt: new Date() },
  })

  const passkeys = (user.auth?.passkeys || []).map((pk: Record<string, unknown>) => ({
    // Stored passkeys key the credential id as `id`; older docs may have used
    // `credentialId`. Expose it consistently as `credentialId` to the client.
    credentialId: pk.id ?? pk.credentialId,
    name: pk.name || "Passkey",
    deviceType: pk.deviceType || "unknown",
    backedUp: pk.backedUp || false,
    createdAt: pk.createdAt,
    // Opaque id of the browser that registered this passkey, so the client can
    // tell whether the *current* device already has one.
    deviceId: pk.deviceId ?? null,
  }))

  return NextResponse.json({
    userId: user._id,
    callsign: user.identity?.callsign || session.callsign,
    totpEnabled: user.auth?.totpEnabled || false,
    passkeys,
    sessionCount,
    createdAt: user.createdAt,
  })
}
