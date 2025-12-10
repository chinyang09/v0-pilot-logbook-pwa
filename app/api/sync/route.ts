import { type NextRequest, NextResponse } from "next/server"
import { MongoClient, ObjectId } from "mongodb"

const uri = process.env.MONGODB_URI || ""
let client: MongoClient | null = null

async function getClient() {
  if (!uri) {
    throw new Error("MONGODB_URI environment variable is not set")
  }

  if (!client) {
    client = new MongoClient(uri)
    await client.connect()
  }
  return client
}

export async function POST(request: NextRequest) {
  try {
    const { type, collection, data } = await request.json()

    const mongoClient = await getClient()
    const db = mongoClient.db("skylog")
    const coll = db.collection(collection)

    const result: { mongoId?: string } = {}

    switch (type) {
      case "create":
        const existing = await coll.findOne({ localId: data.id })
        if (existing) {
          // Update instead
          await coll.updateOne(
            { localId: data.id },
            {
              $set: {
                ...data,
                localId: data.id,
                updatedAt: data.updatedAt || Date.now(),
                syncedAt: Date.now(),
              },
            },
          )
          result.mongoId = existing._id.toString()
        } else {
          const insertResult = await coll.insertOne({
            ...data,
            _id: new ObjectId(),
            localId: data.id,
            syncedAt: Date.now(),
          })
          result.mongoId = insertResult.insertedId.toString()
        }
        break

      case "update":
        const updateResult = await coll.findOneAndUpdate(
          { $or: [{ localId: data.id }, { _id: data.mongoId ? new ObjectId(data.mongoId) : new ObjectId() }] },
          {
            $set: {
              ...data,
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
