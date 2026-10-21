/**
 * Server sync engine (SERVER-ONLY — imports the MongoDB driver).
 *
 * One implementation of push, pull and the per-user schema migration, used by
 * the single round-trip `/api/sync` AND by the two legacy routes
 * (`/api/sync/bulk`, `/api/sync/[collection]`) that an installed PWA keeps
 * calling until its service worker picks up the new build. Every write from
 * either path lands in the canonical shape (`lib/sync/schema.ts`).
 *
 * Do not import this from client code.
 */

import type { AnyBulkWriteOperation, ClientSession, Db, Document, MongoClient } from "mongodb"
import { ObjectId } from "mongodb"
import type { SyncCollection } from "@/types/sync/sync.types"
import { ensureBackfilled, reserveSeqBlock } from "@/lib/mongodb/counters"
import {
  SYNC_COLLECTIONS,
  SYNC_SCHEMA_VERSION,
  approxBytes,
  buildEnvelope,
  canonicalizeDocument,
  toWireRecord,
  writeSource,
  type WriteMode,
} from "../schema"
import {
  applyFieldPatch,
  decidePush,
  dedupeByRecord,
  editTime,
  newestCopies,
  stampChangedFields,
  writtenKey,
  type FieldConflict,
  type PushItem,
  type PushItemResult,
} from "./plan"
import { toTimestamp } from "../authorship"

export const SYNC_DB = "skylog"
const COUNTERS = "counters"
const DELETIONS = "deletions"
/** The losing side of every field conflict, kept so it can be put back (TTL 90 days). */
export const SYNC_CONFLICTS = "syncConflicts"

/** Tombstones live 30 days (TTL index); a watermark older than that may have missed one. */
export const TOMBSTONE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000

interface CounterDoc {
  _id: string
  seq?: number
  backfillState?: string
  schemaVersion?: number
}

const counterFilter = (userId: string) => ({ _id: userId as unknown as ObjectId })

/** The highest seq reserved for this user — "has anything changed since N?". */
export async function readHeadSeq(db: Db, userId: string): Promise<number> {
  const doc = (await db.collection(COUNTERS).findOne(counterFilter(userId))) as CounterDoc | null
  return typeof doc?.seq === "number" ? doc.seq : 0
}

// ---------------------------------------------------------------------------
// Per-user preparation: legacy serverSeq backfill + canonical-shape migration
// ---------------------------------------------------------------------------

/** Docs rewritten per request while a user's migration is in progress. */
const MIGRATION_BUDGET = 1000

/**
 * Bring a user's stored documents up to `SYNC_SCHEMA_VERSION`, a bounded chunk
 * per call, so no single request carries a whole logbook's rewrite. Every sync
 * request advances it; once nothing is left the counter doc records the
 * version and this is one `findOne`.
 *
 * Two things change:
 *  1. Tombstones get a `serverSeq`, so deletions ride the same monotonic cursor
 *     as records instead of a wall clock.
 *  2. Every document is rewritten into the canonical shape — same keys, same
 *     order, defaults in place of missing fields.
 *
 * Neither bumps a record's `serverSeq`: the content a device reads is
 * unchanged (the defaults are what the client normalizers already fill), so
 * there is nothing for anyone to re-pull. A rewrite is filtered on the seq it
 * was read at, so a push landing mid-migration is never overwritten by the
 * older copy.
 */
export async function ensureCanonical(client: MongoClient, db: Db, userId: string): Promise<boolean> {
  const counter = (await db.collection(COUNTERS).findOne(counterFilter(userId))) as CounterDoc | null
  if ((counter?.schemaVersion ?? 0) >= SYNC_SCHEMA_VERSION) return true

  // 1. Unsequenced tombstones. Few (30 days' worth at most), so all at once.
  //    Reserve-and-stamp is ONE transaction: the counter must never show a
  //    seq whose tombstone isn't readable yet, or a "nothing new since N?"
  //    check could record N past a deletion it never delivered.
  for (;;) {
    const legacy = await db
      .collection(DELETIONS)
      .find({ userId, serverSeq: { $exists: false } })
      .project({ _id: 1 })
      .limit(1000)
      .toArray()
    if (legacy.length === 0) break
    const session = client.startSession()
    try {
      await session.withTransaction(async () => {
        let seq = await reserveSeqBlock(db, userId, legacy.length, session)
        await db.collection(DELETIONS).bulkWrite(
          legacy.map((t) => ({
            updateOne: {
              filter: { _id: t._id, serverSeq: { $exists: false } },
              update: { $set: { serverSeq: seq++ } },
            },
          })),
          { session, ordered: false }
        )
      })
    } finally {
      await session.endSession()
    }
  }

  // 2. Documents not yet in the canonical shape.
  let budget = MIGRATION_BUDGET
  for (const collection of SYNC_COLLECTIONS) {
    if (budget <= 0) return false
    const limit = budget
    const docs = await db
      .collection(collection)
      .find({ userId, schemaVersion: { $ne: SYNC_SCHEMA_VERSION } })
      .limit(limit)
      .toArray()
    if (docs.length === 0) continue
    budget -= docs.length

    const now = Date.now()
    const ops: AnyBulkWriteOperation[] = []
    for (const doc of docs) {
      if (typeof doc.id !== "string") {
        // Not a record any client can address. Leave its content alone, but
        // stamp it so it can't hold the migration open forever.
        ops.push({ updateOne: { filter: { _id: doc._id }, update: { $set: { schemaVersion: SYNC_SCHEMA_VERSION } } } })
        continue
      }
      const serverSeq = typeof doc.serverSeq === "number" ? doc.serverSeq : 0
      const envelope = buildEnvelope({ id: doc.id, userId, incoming: doc, existing: doc, serverSeq, now })
      envelope.syncedAt = toTimestamp(doc.syncedAt) ?? now
      const replacement = canonicalizeDocument(collection, doc, envelope)
      ops.push({
        replaceOne: {
          filter: { _id: doc._id, serverSeq: doc.serverSeq, schemaVersion: { $ne: SYNC_SCHEMA_VERSION } },
          replacement,
        },
      })
    }
    if (ops.length > 0) await db.collection(collection).bulkWrite(ops, { ordered: false })
    if (docs.length === limit) return false
  }

  if (budget <= 0) return false
  await db
    .collection(COUNTERS)
    .updateOne(counterFilter(userId), { $max: { schemaVersion: SYNC_SCHEMA_VERSION } }, { upsert: true })
  return true
}

/** Everything a sync request needs done for this user before it reads or writes. */
export async function prepareUser(client: MongoClient, db: Db, userId: string): Promise<void> {
  await ensureBackfilled(db, userId)
  try {
    await ensureCanonical(client, db, userId)
  } catch (err) {
    // Best effort: an unmigrated document still syncs (it is canonicalized
    // the next time anything writes it), so never fail the request over this.
    console.error("[Sync] canonical migration step failed:", err)
  }
}

// ---------------------------------------------------------------------------
// Push
// ---------------------------------------------------------------------------

/** `collection:id` → the serverSeq this request wrote it at. */
export type WrittenSeqs = Map<string, number>

/**
 * Apply one collection's pushed items inside a single transaction. Results are
 * only reported as success AFTER the commit — if anything throws, every item
 * is reported failed so the client keeps its queue and retries.
 */
async function pushCollection(
  client: MongoClient,
  db: Db,
  userId: string,
  collection: SyncCollection,
  items: PushItem[],
  mode: WriteMode,
  written: WrittenSeqs
): Promise<PushItemResult[]> {
  const coll = db.collection(collection)
  const { kept, superseded } = dedupeByRecord(items)
  const recordIds = kept.map((i) => i.data.id)

  let results: PushItemResult[] = []
  let writes: { key: string; seq: number }[] = []
  const session: ClientSession = client.startSession()

  try {
    await session.withTransaction(async () => {
      // Reset on every (possibly retried) attempt.
      results = superseded.map((i) => ({ queueItemId: i.id, success: true }))
      writes = []

      const tombstones = await db
        .collection(DELETIONS)
        .find({ userId, collection, recordId: { $in: recordIds } }, { session })
        .project({ recordId: 1 })
        .toArray()
      const tombstoned = new Set(tombstones.map((t) => t.recordId as string))

      const existingDocs = await coll.find({ userId, id: { $in: recordIds } }, { session }).toArray()
      const { byId: existingById, superseded: staleCopies } = newestCopies(existingDocs as Document[])

      const now = Date.now()
      // Decide everything BEFORE reserving seqs, because a patch whose every
      // field lost its conflict writes nothing and must not take a seq.
      type Planned =
        | { kind: "write"; item: PushItem; existing?: Document; source: Record<string, unknown>; patch?: ReturnType<typeof applyFieldPatch> }
        | { kind: "delete"; item: PushItem }
        | { kind: "rejected"; item: PushItem }
        | { kind: "unchanged"; item: PushItem; existing: Document; conflicts?: FieldConflict[] }

      const planned: Planned[] = kept.map((item) => {
        const existing = existingById.get(item.data.id)
        const decision = decidePush(item, existing, tombstoned.has(item.data.id))
        switch (decision) {
          case "delete":
            return { kind: "delete", item }
          case "rejected":
            return { kind: "rejected", item }
          case "stale":
            return { kind: "unchanged", item, existing: existing! }
          case "patch": {
            const patch = applyFieldPatch({
              existing: existing!,
              incoming: item.data,
              fields: item.changedFields ?? [],
              baseSeq: item.baseSeq ?? 0,
              deviceId: typeof item.data.deviceId === "string" ? item.data.deviceId : "",
              editedAt: editTime(item, now),
              seq: 0, // stamped once the seq is reserved
            })
            if (patch.applied.length === 0) {
              return { kind: "unchanged", item, existing: existing!, conflicts: patch.conflicts }
            }
            return { kind: "write", item, existing, source: patch.doc, patch }
          }
          default:
            return { kind: "write", item, existing, source: writeSource(collection, mode, item.data, existing) }
        }
      })

      const seqNeeded = planned.filter((p) => p.kind === "write" || p.kind === "delete").length
      let nextSeq = seqNeeded > 0 ? await reserveSeqBlock(db, userId, seqNeeded, session) : 0

      const dataOps: AnyBulkWriteOperation[] = []
      const tombstoneOps: AnyBulkWriteOperation[] = []
      const conflictDocs: Document[] = []

      for (const p of planned) {
        const id = p.item.data.id
        const deviceId = typeof p.item.data.deviceId === "string" ? p.item.data.deviceId : ""
        if (p.kind === "write") {
          const serverSeq = nextSeq++
          const editedAt = editTime(p.item, now)
          const stamp = { seq: serverSeq, at: editedAt, by: deviceId }
          let fieldVersions: Record<string, unknown>
          let author: Record<string, unknown> = p.item.data
          if (p.patch) {
            fieldVersions = { ...p.patch.fieldVersions }
            for (const field of p.patch.applied) fieldVersions[field] = stamp
            // A merged record keeps the LATER of the two edit times, so a
            // whole-record comparison by an older build still orders it right.
            const storedAt = toTimestamp(p.existing?.updatedAt) ?? 0
            if (storedAt > editedAt) author = { ...p.item.data, updatedAt: storedAt }
          } else {
            fieldVersions = stampChangedFields(p.existing, p.source, stamp)
          }
          const envelope = buildEnvelope({
            id, userId, incoming: author, existing: p.existing, state: p.source, serverSeq, now, fieldVersions,
          })
          const replacement = canonicalizeDocument(collection, p.source, envelope)
          // Replace the copy that was READ (the newest), never "whichever
          // matches first" — see `newestCopies`.
          dataOps.push(
            p.existing
              ? { replaceOne: { filter: { _id: p.existing._id }, replacement } }
              : { replaceOne: { filter: { userId, id }, replacement, upsert: true } }
          )
          writes.push({ key: writtenKey(collection, id), seq: serverSeq })
          // A recreated derived id (see `decidePush`): the old tombstone goes
          // in the same commit, or a device that has not yet pulled it would
          // apply the deletion over the new record.
          if (tombstoned.has(id)) {
            tombstoneOps.push({ deleteOne: { filter: { userId, collection, recordId: id } } })
          }

          const conflicts = p.patch?.conflicts ?? []
          for (const c of conflicts) conflictDocs.push(conflictDoc(userId, collection, id, c, now))
          // Send the record back when it is not what the client holds: another
          // device changed other fields since its base, or a field went the
          // other way. Otherwise the client's copy already IS the record.
          const differs = !!p.patch && (p.patch.concurrent || conflicts.some((c) => c.winner === "server"))
          results.push({
            queueItemId: p.item.id,
            success: true,
            serverSeq,
            ...(differs ? { record: toWireRecord(replacement) } : {}),
            ...(conflicts.length ? { conflicts: conflicts.map((c) => ({ field: c.field, winner: c.winner })) } : {}),
          })
        } else if (p.kind === "delete") {
          // Tombstone and delete commit together (one transaction), and the
          // tombstone is sequenced so every device's cursor sees it.
          tombstoneOps.push({
            updateOne: {
              filter: { userId, collection, recordId: id },
              update: { $set: { userId, collection, recordId: id, deletedAt: new Date(now), serverSeq: nextSeq++ } },
              upsert: true,
            },
          })
          // Every copy: a stray duplicate left behind would outlive its purge.
          dataOps.push({ deleteMany: { filter: { userId, id } } })
          results.push({ queueItemId: p.item.id, success: true })
        } else if (p.kind === "rejected") {
          results.push({
            queueItemId: p.item.id,
            success: true,
            rejected: true,
            reason: "Record was deleted on another device",
          })
        } else {
          for (const c of p.conflicts ?? []) conflictDocs.push(conflictDoc(userId, collection, id, c, now))
          results.push({
            queueItemId: p.item.id,
            success: true,
            stale: true,
            record: toWireRecord(p.existing),
            ...(p.conflicts?.length ? { conflicts: p.conflicts.map((c) => ({ field: c.field, winner: c.winner })) } : {}),
          })
        }
      }

      // A write supersedes every copy of its record, so the stale ones go in
      // the same commit. A record this push did not touch keeps its copies.
      const touched = new Set(planned.filter((p) => p.kind === "write").map((p) => p.item.data.id))
      const strays = staleCopies.filter((d) => touched.has(d.id as string)).map((d) => d._id)
      if (strays.length > 0) dataOps.push({ deleteMany: { filter: { _id: { $in: strays } } } })

      if (conflictDocs.length > 0) {
        await db.collection(SYNC_CONFLICTS).insertMany(conflictDocs, { session })
      }
      if (tombstoneOps.length > 0) {
        await db.collection(DELETIONS).bulkWrite(tombstoneOps, { session, ordered: false })
      }
      if (dataOps.length > 0) {
        await coll.bulkWrite(dataOps, { session, ordered: false })
      }
    })

    for (const w of writes) written.set(w.key, w.seq)
    return results
  } catch (err) {
    console.error(`[Sync] push transaction failed for ${collection}:`, err)
    return items.map((i) => ({ queueItemId: i.id, success: false, reason: "Write transaction failed" }))
  } finally {
    await session.endSession()
  }
}

function conflictDoc(userId: string, collection: SyncCollection, recordId: string, c: FieldConflict, now: number): Document {
  return {
    userId,
    collection,
    recordId,
    field: c.field,
    winner: c.winner,
    kept: c.kept,
    discarded: c.discarded,
    serverBy: c.serverBy,
    serverAt: c.serverAt,
    incomingBy: c.incomingBy,
    incomingAt: c.incomingAt,
    createdAt: new Date(now),
  }
}

export async function applyPush(
  client: MongoClient,
  db: Db,
  userId: string,
  byCollection: Map<SyncCollection, PushItem[]>,
  mode: WriteMode
): Promise<{ results: PushItemResult[]; written: WrittenSeqs }> {
  const results: PushItemResult[] = []
  const written: WrittenSeqs = new Map()
  for (const collection of SYNC_COLLECTIONS) {
    const items = byCollection.get(collection)
    if (!items?.length) continue
    results.push(...(await pushCollection(client, db, userId, collection, items, mode, written)))
  }
  return { results, written }
}

// ---------------------------------------------------------------------------
// Pull
// ---------------------------------------------------------------------------

export interface Cursor {
  seq: number
  id: string
}

export interface CollectionChanges {
  records: Record<string, unknown>[]
  deletions: string[]
}

export interface PullResult {
  changes: Partial<Record<SyncCollection, CollectionChanges>>
  cursors: Record<SyncCollection, Cursor>
  tombSeq: number
  hasMore: boolean
  /** The user's seq head as read BEFORE the queries — safe to store as "known". */
  headSeq: number
}

export function sanitizeCursor(raw: unknown): Cursor {
  const c = raw as { seq?: unknown; id?: unknown } | null | undefined
  const seq = typeof c?.seq === "number" && Number.isFinite(c.seq) && c.seq >= 0 ? c.seq : 0
  const id = typeof c?.id === "string" && ObjectId.isValid(c.id) ? c.id : ""
  return { seq, id }
}

/** Keyset query for "records after this cursor", ordered (serverSeq, _id). */
export function keysetQuery(userId: string, cursor: Cursor): Record<string, unknown> {
  const query: Record<string, unknown> = { userId }
  if (cursor.seq > 0 || cursor.id) {
    query.$or = cursor.id
      ? [{ serverSeq: { $gt: cursor.seq } }, { serverSeq: cursor.seq, _id: { $gt: new ObjectId(cursor.id) } }]
      : [{ serverSeq: { $gt: cursor.seq } }]
  }
  return query
}

const TOMBSTONE_PAGE = 2000

/**
 * Everything that changed after the client's cursors, across ALL collections,
 * in one response bounded by `limit` records and `maxBytes`.
 *
 * Records this same request just wrote (`skip`) are left out of the payload —
 * the client already holds them — but the cursor still advances past them.
 */
export async function pullChanges(
  db: Db,
  userId: string,
  opts: {
    cursors: Partial<Record<SyncCollection, Cursor>>
    tombSeq: number
    limit: number
    maxBytes: number
    skip?: WrittenSeqs
  }
): Promise<PullResult> {
  const headSeq = await readHeadSeq(db, userId)
  const changes: PullResult["changes"] = {}
  const cursors = {} as Record<SyncCollection, Cursor>
  let remaining = opts.limit
  let bytes = 0
  let hasMore = false

  for (const collection of SYNC_COLLECTIONS) {
    let cursor = opts.cursors[collection] ?? { seq: 0, id: "" }
    if (remaining <= 0 || bytes >= opts.maxBytes) {
      cursors[collection] = cursor
      hasMore = true
      continue
    }
    const docs = await db
      .collection(collection)
      .find(keysetQuery(userId, cursor))
      .sort({ serverSeq: 1, _id: 1 })
      .limit(remaining)
      .toArray()

    const records: Record<string, unknown>[] = []
    let consumed = 0
    for (const doc of docs) {
      const seq = typeof doc.serverSeq === "number" ? doc.serverSeq : cursor.seq
      const skipSeq = opts.skip?.get(writtenKey(collection, doc.id as string))
      if (skipSeq === undefined || skipSeq !== seq) {
        const wire = toWireRecord(doc)
        const size = approxBytes(wire)
        // Always take at least one record per page, or an oversized record
        // would stall the cursor for good.
        if (records.length > 0 && bytes + size > opts.maxBytes) {
          hasMore = true
          break
        }
        bytes += size
        records.push(wire)
      }
      consumed++
      cursor = { seq, id: (doc._id as ObjectId).toString() }
    }
    if (consumed === remaining) hasMore = true
    remaining -= consumed
    cursors[collection] = cursor
    if (records.length > 0) changes[collection] = { records, deletions: [] }
  }

  // Deletions, on the same monotonic counter as records.
  const tombstones = await db
    .collection(DELETIONS)
    .find({ userId, serverSeq: { $gt: opts.tombSeq } })
    .sort({ serverSeq: 1 })
    .limit(TOMBSTONE_PAGE)
    .project({ collection: 1, recordId: 1, serverSeq: 1 })
    .toArray()
  let tombSeq = opts.tombSeq
  for (const t of tombstones) {
    const collection = t.collection as SyncCollection
    if (SYNC_COLLECTIONS.includes(collection) && typeof t.recordId === "string") {
      const entry = (changes[collection] ??= { records: [], deletions: [] })
      entry.deletions.push(t.recordId)
    }
    if (typeof t.serverSeq === "number") tombSeq = Math.max(tombSeq, t.serverSeq)
  }
  if (tombstones.length === TOMBSTONE_PAGE) hasMore = true

  return { changes, cursors, tombSeq, hasMore, headSeq }
}

/**
 * The retention gate: a client whose last clean sync is older than tombstone
 * retention may have missed a deletion that has since expired, and only a
 * clean re-pull can tell it which of its records no longer exist.
 */
export function needsFullResync(since: number, now = Date.now()): boolean {
  return since > 0 && since < now - TOMBSTONE_RETENTION_MS
}
