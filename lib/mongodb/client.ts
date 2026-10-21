/**
 * MongoDB client connection
 * SERVER-ONLY module
 */

import { MongoClient, type Db } from "mongodb"
import { SYNC_COLLECTIONS } from "@/lib/sync/schema"

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
    ...SYNC_COLLECTIONS.flatMap((coll) => [
      // One document per record. It CANNOT be built while a collection holds
      // a duplicate, and until it exists every push looks a record up by
      // scanning the user's documents and nothing stops two concurrent first
      // pushes inserting a copy each — which is how production came to hold
      // duplicates in the first place. The engine copes with them
      // (`newestCopies`); this says which ids are blocking the index.
      safe(`${coll}.userId+id`, async () => {
        try {
          await db.collection(coll).createIndex({ userId: 1, id: 1 }, { unique: true })
        } catch (err) {
          if ((err as { code?: number }).code === 11000) {
            const dupes = await db
              .collection(coll)
              .aggregate([
                { $group: { _id: { userId: "$userId", id: "$id" }, copies: { $sum: 1 } } },
                { $match: { copies: { $gt: 1 } } },
                { $limit: 20 },
              ])
              .toArray()
            console.error(`[Mongo] ${coll}: duplicate { userId, id } blocks the unique index:`, JSON.stringify(dupes))
          }
          throw err
        }
      }),
      // Server-authored monotonic version — the delta-pull keyset cursor.
      // (The old `userId+syncedAt` and `userId+createdAt` indexes backed the
      // wall-clock delta query every route has since moved off; nothing reads
      // them, so they are no longer created. Existing ones are harmless.)
      safe(`${coll}.userId+serverSeq+_id`, () =>
        db.collection(coll).createIndex({ userId: 1, serverSeq: 1, _id: 1 }),
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
    // The losing side of field conflicts (lib/sync/server/engine.ts), kept 90
    // days so a value overwritten by a concurrent edit can still be recovered.
    safe("syncConflicts.ttl", () =>
      db.collection("syncConflicts").createIndex({ createdAt: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 }),
    ),
    safe("syncConflicts.record", () =>
      db.collection("syncConflicts").createIndex({ userId: 1, collection: 1, recordId: 1, createdAt: -1 }),
    ),
    // Tombstones ride the same per-user seq counter as records (/api/sync).
    safe("deletions.seq", () =>
      db.collection("deletions").createIndex({ userId: 1, serverSeq: 1 }),
    ),
    // Auth: expire WebAuthn challenges automatically (they are also consumed via
    // findOneAndDelete, but this sweeps abandoned ceremonies). `expiresAt` is a
    // BSON Date, so a 0-second TTL deletes each doc at its own expiry instant.
    safe("challenges.ttl", () =>
      db.collection("challenges").createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
    ),
    // Auth: enforce one account per normalized callsign atomically (registration
    // also checks, but the unique index closes the begin→complete race).
    safe("users.searchKey", () =>
      db.collection("users").createIndex({ "identity.searchKey": 1 }, { unique: true }),
    ),
    // Auth: passkey login looks up the owning user by credential id.
    safe("users.passkeyId", () =>
      db.collection("users").createIndex({ "auth.passkeys.id": 1 }),
    ),
    // Auth: session lookups by token (every authed request).
    safe("sessions.token", () =>
      db.collection("sessions").createIndex({ token: 1 }, { unique: true }),
    ),
    safe("sessions.userDevice", () =>
      db.collection("sessions").createIndex({ userId: 1, deviceId: 1 }),
    ),
    // Expired sessions are never read (every lookup filters `expiresAt > now`)
    // but nothing removed them either — 13 of 15 rows in production were dead.
    // `expiresAt` is a BSON Date, which is what a TTL index needs.
    safe("sessions.ttl", () =>
      db.collection("sessions").createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
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
