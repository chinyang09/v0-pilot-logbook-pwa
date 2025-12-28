import { type NextRequest, NextResponse } from "next/server"
import { ObjectId } from "mongodb"
import { getMongoClient } from "@/lib/mongodb"
import { validateSessionFromHeader } from "@/lib/session"

export async function POST(request: NextRequest) {
  try {
    const session = await validateSessionFromHeader(request)
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { type, collection, data } = await request.json()

    const mongoClient = await getMongoClient()
    const db = mongoClient.db("skylog")
    const coll = db.collection(collection)

    const result: { mongoId?: string } = {}

    const { syncStatus, ...dataWithoutSyncStatus } = data

    const dataWithUser = {
      ...dataWithoutSyncStatus,
      userId: session.userId,
    }

    switch (type) {
      case "create":
        const existing = await coll.findOne({ localId: data.id, userId: session.userId })
        if (existing) {
          // Update instead
          await coll.updateOne(
            { localId: data.id, userId: session.userId },
            {
              $set: {
                ...dataWithUser,
                localId: data.id,
                updatedAt: data.updatedAt || Date.now(),
                syncedAt: Date.now(),
              },
            },
          )
          result.mongoId = existing._id.toString()
        } else {
          const insertResult = await coll.insertOne({
            ...dataWithUser,
            _id: new ObjectId(),
            localId: data.id,
            createdAt: data.createdAt || Date.now(),
            updatedAt: data.updatedAt || Date.now(),
            syncedAt: Date.now(),
          })
          result.mongoId = insertResult.insertedId.toString()
        }
        break

      case "update":
        const updateResult = await coll.findOneAndUpdate(
          {
            userId: session.userId,
            $or: [{ localId: data.id }, { _id: data.mongoId ? new ObjectId(data.mongoId) : new ObjectId() }],
          },
          {
            $set: {
              ...dataWithUser,
              localId: data.id,
              updatedAt: data.updatedAt || Date.now(),
              syncedAt: Date.now(),
            },
          },
          { upsert: true, returnDocument: "after" },
        )
        result.mongoId = updateResult?._id?.toString()
        break

      case "delete":
        await coll.deleteOne({
          userId: session.userId,
          $or: [{ localId: data.id }, { _id: data.mongoId ? new ObjectId(data.mongoId) : null }],
        })
        break

      default:
        return NextResponse.json({ error: "Invalid sync type" }, { status: 400 })
    }

    return NextResponse.json({ success: true, ...result })
  } catch (error) {
    console.error("Sync error:", error)
    return NextResponse.json(
      { error: "Sync failed", message: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    )
  }
}
