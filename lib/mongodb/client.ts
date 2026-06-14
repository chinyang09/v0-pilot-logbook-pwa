/**
 * MongoDB client connection
 * SERVER-ONLY module
 */

import { MongoClient, type Db } from "mongodb"

const uri = process.env.MONGODB_URI || ""

let client: MongoClient | undefined = undefined
let clientPromise: Promise<MongoClient> | undefined = undefined

if (!uri) {
  console.warn("MONGODB_URI environment variable is not set")
}

const options = {
  compressors: [] as ("none" | "snappy" | "zlib" | "zstd")[],
  minPoolSize: 0,
  maxPoolSize: 10,
}

let indexesEnsured = false

/**
 * Idempotently create the indexes the sync/submission paths rely on.
 * `createIndex` is a no-op when the index already exists, and each call is
 * isolated so one failure (e.g. a pre-existing duplicate blocking a unique
 * index) never prevents the others. Best-effort: never blocks a request.
 */
async function ensureIndexes(mongoClient: MongoClient): Promise<void> {
  if (indexesEnsured) return
  indexesEnsured = true

  const db = mongoClient.db("skylog")
  const safe = async (label: string, fn: () => Promise<unknown>) => {
    try {
      await fn()
    } catch (err) {
      console.error(`[Mongo] ensureIndexes(${label}) failed:`, err)
    }
  }

  await Promise.all([
    ...["flights", "aircraft", "personnel", "scheduleEntries", "currencies", "discrepancies"].flatMap((coll) => [
      safe(`${coll}.userId+id`, () =>
        db.collection(coll).createIndex({ userId: 1, id: 1 }, { unique: true }),
      ),
      // Server-assigned watermark used by delta-sync (see /api/sync/[collection]).
      safe(`${coll}.userId+syncedAt`, () =>
        db.collection(coll).createIndex({ userId: 1, syncedAt: 1 }),
      ),
      // Server-authored monotonic version — the delta-pull keyset cursor.
      safe(`${coll}.userId+serverSeq+_id`, () =>
        db.collection(coll).createIndex({ userId: 1, serverSeq: 1, _id: 1 }),
      ),
      // Backs the legacy createdAt fallback branch of the delta query.
      safe(`${coll}.userId+createdAt`, () =>
        db.collection(coll).createIndex({ userId: 1, createdAt: 1 }),
      ),
    ]),
    // Tombstones — TTL + delta-sync lookups (mirrors /api/sync/setup-ttl).
    safe("deletions.ttl", () =>
      db
        .collection("deletions")
        .createIndex({ deletedAt: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 }),
    ),
    safe("deletions.unique", () =>
      db
        .collection("deletions")
        .createIndex({ userId: 1, collection: 1, recordId: 1 }, { unique: true }),
    ),
    safe("deletions.delta", () =>
      db.collection("deletions").createIndex({ userId: 1, collection: 1, deletedAt: 1 }),
    ),
    // Submission dedup — back the upsert-by-key race fix.
    safe("aircraftSubmissions.reg", () =>
      db
        .collection("aircraftSubmissions")
        .createIndex({ registrationNormalized: 1 }, { unique: true }),
    ),
    safe("airportSubmissions.icao", () =>
      db.collection("airportSubmissions").createIndex({ icao: 1 }, { unique: true }),
    ),
    safe("airportSubmissions.status", () =>
      db.collection("airportSubmissions").createIndex({ status: 1, enrichedAt: -1 }),
    ),
  ])
}

export async function getMongoClient(): Promise<MongoClient> {
  if (!uri) {
    throw new Error("MONGODB_URI environment variable is not set")
  }

  if (client) {
    return client
  }

  if (!clientPromise) {
    client = new MongoClient(uri, options)
    clientPromise = client.connect().then((connected) => {
      // Fire-and-forget; index creation must not block the first query.
      void ensureIndexes(connected)
      return connected
    })
  }

  return clientPromise
}

export async function getDB(): Promise<Db> {
  const mongoClient = await getMongoClient()
  return mongoClient.db("skylog")
}

export function getClientPromise(): Promise<MongoClient> {
  if (!uri) {
    return Promise.reject(new Error("No MongoDB URI"))
  }
  return getMongoClient()
}
