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
        const insertResult = await coll.insertOne({
          ...data,
          _id: new ObjectId(),
          localId: data.id,
          syncedAt: new Date(),
        })
        result.mongoId = insertResult.insertedId.toString()
        break

      case "update":
        await coll.updateOne(
          { localId: data.id },
          {
            $set: {
              ...data,
              syncedAt: new Date(),
            },
          },
        )
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
