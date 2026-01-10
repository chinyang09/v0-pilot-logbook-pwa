import { type NextRequest, NextResponse } from "next/server"
import { getMongoClient } from "@/lib/mongodb"
import { validateSessionFromHeader } from "@/lib/auth/server/session"

export async function POST(request: NextRequest) {
  try {
    const session = await validateSessionFromHeader(request)
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const mongoClient = await getMongoClient()
    const db = mongoClient.db("skylog")

    // Create TTL index on deletions collection (30 days)
    await db.collection("deletions").createIndex(
      { deletedAt: 1 },
      { expireAfterSeconds: 30 * 24 * 60 * 60 }, // 30 days
    )

    // Create compound index for efficient queries
    await db.collection("deletions").createIndex({ userId: 1, collection: 1, recordId: 1 }, { unique: true })

    // Create index for delta sync queries
    await db.collection("deletions").createIndex({ userId: 1, collection: 1, deletedAt: 1 })

    return NextResponse.json({
      success: true,
      message: "TTL index created on deletions collection (30 days)",
    })
  } catch (error) {
    console.error("Setup TTL error:", error)
    return NextResponse.json(
      { error: "Failed to setup TTL", message: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    )
  }
}
