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

  const passkeys = (user.auth?.passkeys || []).map((pk: Record<string, unknown>) => ({
    credentialId: pk.id ?? pk.credentialId,
    name: pk.name || "Passkey",
    deviceType: pk.deviceType || "unknown",
    backedUp: pk.backedUp || false,
    createdAt: pk.createdAt,
  }))

  return NextResponse.json({ passkeys })
}

export async function DELETE(request: Request) {
  const session = await validateSession()
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = await request.json()
  const { credentialId } = body as { credentialId?: string }

  if (!credentialId) {
    return NextResponse.json({ error: "Credential ID is required" }, { status: 400 })
  }

  const db = await getDB()
  const user = await db.collection("users").findOne({ _id: session.userId as unknown as import("mongodb").ObjectId })

  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 })
  }

  const passkeys = user.auth?.passkeys || []

  // Must keep at least one passkey
  if (passkeys.length <= 1) {
    return NextResponse.json({ error: "Cannot remove last passkey" }, { status: 400 })
  }

  const filtered = passkeys.filter(
    (pk: Record<string, unknown>) => (pk.id ?? pk.credentialId) !== credentialId,
  )

  if (filtered.length === passkeys.length) {
    return NextResponse.json({ error: "Passkey not found" }, { status: 404 })
  }

  await db.collection("users").updateOne(
    { _id: session.userId as unknown as import("mongodb").ObjectId },
    {
      $set: {
        "auth.passkeys": filtered,
        updatedAt: Date.now(),
      },
    }
  )

  return NextResponse.json({ success: true })
}
