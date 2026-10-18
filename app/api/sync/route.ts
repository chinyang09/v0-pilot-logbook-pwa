import { type NextRequest, NextResponse } from "next/server"
import { getMongoClient } from "@/lib/mongodb"
import { validateRequestSession, assertSameOrigin } from "@/lib/auth/server/session"
import { SYNC_COLLECTIONS, SYNC_SCHEMA_VERSION, writeMode } from "@/lib/sync/schema"
import { validatePushItems, type PushItemResult } from "@/lib/sync/server/plan"
import {
  SYNC_DB,
  applyPush,
  needsFullResync,
  prepareUser,
  pullChanges,
  readHeadSeq,
  sanitizeCursor,
  type Cursor,
} from "@/lib/sync/server/engine"
import type { SyncCollection } from "@/types/sync/sync.types"

/**
 * ONE round trip per sync: push the client's pending changes, then return
 * everything that changed since its cursors, across every collection.
 *
 * It replaces a cycle that was one POST plus a GET per collection — seven
 * requests, each its own cold-start lottery on a serverless function — and it
 * answers the commonest question ("has anything changed?") with a single
 * `findOne`: a client that sends nothing to push and the seq head it last saw
 * gets `upToDate` back before any collection is queried. That is what makes it
 * cheap enough to ask every half minute while the app is open.
 *
 * Request:
 *   { schemaVersion, items?, cursors?, tombSeq?, since?, knownSeq?, limit?, pull? }
 * Response:
 *   { results, upToDate?, requiresFullResync?, changes, cursors, tombSeq,
 *     hasMore, headSeq, serverNow }
 */

const MAX_ITEMS = 500
const DEFAULT_LIMIT = 500
const MAX_LIMIT = 1000
// Vercel caps a function response at 4.5MB; stay well inside it.
const MAX_RESPONSE_BYTES = 3_000_000

export async function POST(request: NextRequest) {
  try {
    if (!assertSameOrigin(request)) {
      return NextResponse.json({ error: "Cross-origin request rejected" }, { status: 403 })
    }
    const session = await validateRequestSession(request)
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    let body: Record<string, unknown>
    try {
      body = (await request.json()) as Record<string, unknown>
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
    }
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Invalid body" }, { status: 400 })
    }

    const rawItems = Array.isArray(body.items) ? body.items : []
    if (rawItems.length > MAX_ITEMS) {
      return NextResponse.json({ error: `Too many items (max ${MAX_ITEMS})` }, { status: 413 })
    }

    const userId = session.userId
    const client = await getMongoClient()
    const db = client.db(SYNC_DB)
    await prepareUser(client, db, userId)

    // --- push -------------------------------------------------------------
    const results: PushItemResult[] = []
    let written = new Map<string, number>()
    if (rawItems.length > 0) {
      const { byCollection, invalid } = validatePushItems(rawItems)
      results.push(...invalid)
      const pushed = await applyPush(client, db, userId, byCollection, writeMode(body.schemaVersion))
      results.push(...pushed.results)
      written = pushed.written
    }

    const serverNow = Date.now()
    if (body.pull === false) {
      return NextResponse.json({ results, serverNow, schemaVersion: SYNC_SCHEMA_VERSION })
    }

    // --- retention gate ---------------------------------------------------
    const since = typeof body.since === "number" && Number.isFinite(body.since) ? body.since : 0
    if (needsFullResync(since, serverNow)) {
      return NextResponse.json({
        results,
        requiresFullResync: true,
        reason: "Your last sync was too long ago. A full re-sync is required.",
        serverNow,
        schemaVersion: SYNC_SCHEMA_VERSION,
      })
    }

    // --- cheap "anything new?" -------------------------------------------
    const knownSeq = typeof body.knownSeq === "number" && Number.isFinite(body.knownSeq) ? body.knownSeq : 0
    if (rawItems.length === 0 && knownSeq > 0) {
      const headSeq = await readHeadSeq(db, userId)
      if (headSeq <= knownSeq) {
        return NextResponse.json({ results, upToDate: true, headSeq, serverNow, schemaVersion: SYNC_SCHEMA_VERSION })
      }
    }

    // --- pull -------------------------------------------------------------
    const rawCursors = (body.cursors ?? {}) as Record<string, unknown>
    const cursors: Partial<Record<SyncCollection, Cursor>> = {}
    for (const c of SYNC_COLLECTIONS) cursors[c] = sanitizeCursor(rawCursors[c])
    const tombSeq = typeof body.tombSeq === "number" && Number.isFinite(body.tombSeq) && body.tombSeq >= 0 ? body.tombSeq : 0
    const limit = Math.min(
      Math.max(typeof body.limit === "number" ? Math.floor(body.limit) : DEFAULT_LIMIT, 1),
      MAX_LIMIT
    )

    const pulled = await pullChanges(db, userId, {
      cursors,
      tombSeq,
      limit,
      maxBytes: MAX_RESPONSE_BYTES,
      skip: written,
    })

    return NextResponse.json({ results, ...pulled, serverNow, schemaVersion: SYNC_SCHEMA_VERSION })
  } catch (error) {
    console.error("[Sync] round trip error:", error)
    return NextResponse.json({ error: "Sync failed" }, { status: 500 })
  }
}
