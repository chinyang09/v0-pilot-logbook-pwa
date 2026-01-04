import { type NextRequest, NextResponse } from "next/server"
import { ObjectId } from "mongodb"
import { getMongoClient } from "@/lib/mongodb"
import { validateSessionFromHeader } from "@/lib/session"

async function checkTombstone(db: any, userId: string, collection: string, recordId: string): Promise<boolean> {
  const tombstone = await db.collection("deletions").findOne({
    userId,
    collection,
    recordId,
  })
  return !!tombstone
}

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

    const result: { mongoId?: string; rejected?: boolean; reason?: string } = {}

    const { syncStatus, ...dataWithoutSyncStatus } = data

    const dataWithUser = {
      ...dataWithoutSyncStatus,
      userId: session.userId,
    }

    switch (type) {
      case "create":
      case "update":
        const isTombstoned = await checkTombstone(db, session.userId, collection, data.id)
        if (isTombstoned) {
          console.log(`[v0] Rejecting ${type} for tombstoned record: ${data.id}`)
          return NextResponse.json({
            success: false,
            rejected: true,
            reason: "Record was deleted on another device",
          })
        }

        if (type === "create") {
          const existing = await coll.findOne({ localId: data.id, userId: session.userId })
          if (existing) {
            const incomingTime = data.updatedAt || data.createdAt || Date.now()
            const existingTime = existing.updatedAt || existing.createdAt || 0

            if (incomingTime >= existingTime) {
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
            }
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
        } else {
          // update
          const existingRecord = await coll.findOne({
            userId: session.userId,
            $or: [{ localId: data.id }, { _id: data.mongoId ? new ObjectId(data.mongoId) : new ObjectId() }],
          })

          if (existingRecord) {
            const incomingTime = data.updatedAt || Date.now()
            const existingTime = existingRecord.updatedAt || existingRecord.createdAt || 0

            if (incomingTime >= existingTime) {
              await coll.updateOne(
                { _id: existingRecord._id },
                {
                  $set: {
                    ...dataWithUser,
                    localId: data.id,
                    updatedAt: data.updatedAt || Date.now(),
                    syncedAt: Date.now(),
                  },
                },
              )
            }
            result.mongoId = existingRecord._id.toString()
          } else {
            // Upsert if not found
            const updateResult = await coll.findOneAndUpdate(
              {
                userId: session.userId,
                localId: data.id,
              },
              {
                $set: {
                  ...dataWithUser,
                  localId: data.id,
                  updatedAt: data.updatedAt || Date.now(),
                  syncedAt: Date.now(),
                },
                $setOnInsert: {
                  _id: new ObjectId(),
                  createdAt: data.createdAt || Date.now(),
                },
              },
              { upsert: true, returnDocument: "after" },
            )
            result.mongoId = updateResult?._id?.toString()
          }
        }
        break

      case "delete":
        const deleteQuery = {
          userId: session.userId,
          $or: [{ localId: data.id }, { _id: data.mongoId ? new ObjectId(data.mongoId) : null }],
        }

        const deletedRecord = await coll.findOneAndDelete(deleteQuery)

        if (deletedRecord || data.id) {
          await db.collection("deletions").updateOne(
            {
              userId: session.userId,
              collection,
              recordId: data.id,
            },
            {
              $set: {
                userId: session.userId,
                collection,
                recordId: data.id,
                mongoId: data.mongoId || deletedRecord?._id?.toString(),
                deletedAt: new Date(),
              },
            },
            { upsert: true },
          )
        }
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
