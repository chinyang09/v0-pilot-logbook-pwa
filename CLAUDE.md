# CLAUDE.md — AI Assistant Guide for OOOI Pilot Logbook PWA

## Project Overview

**OOOI** is a professional pilot logbook Progressive Web App named after the four critical flight times: Out, Off, On, In. It is an offline-first PWA with cloud synchronization, passkey-based authentication, and OCR capabilities for digitizing handwritten logbook entries.

Deployed on **Vercel** and synced from [v0.app](https://v0.app/chat/eXgJay4h1Jy).

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16 (App Router) with React 19 |
| Language | TypeScript 5 (strict mode) |
| Styling | Tailwind CSS v4 with OKLch color space |
| UI Components | shadcn/ui (New York style) + Radix UI primitives |
| Icons | Lucide React |
| Local DB | Dexie (IndexedDB wrapper) |
| Cloud DB | MongoDB 6 |
| Auth | WebAuthn passkeys + TOTP 2FA |
| Data Fetching | SWR + Dexie React hooks |
| Forms | Custom hooks (`useCrewForm`, `useDraft`) — no form library |
| OCR | PP-OCRv4 models (`@gutenye/ocr-models`) on ONNX Runtime — our own pipeline, `lib/ocr/engine/` |
| Charts | Hand-drawn SVG/DOM (the FDP timeline) — no chart library; Recharts was removed with its last chart |
| Package Manager | pnpm (not npm) |
| Bundler | Webpack (not Turbopack) |

## Commands

```bash
pnpm dev          # Start dev server (Next.js with Webpack)
pnpm build        # Production build (8GB heap for OCR models)
pnpm lint         # Run ESLint
pnpm test         # Run the Vitest suite once
pnpm test:watch   # Vitest in watch mode
pnpm start        # Run production server
pnpm install      # Install dependencies (MUST use pnpm, not npm)
```

**Important:** This project uses **pnpm** as its package manager. Vercel deploys with `frozen-lockfile`, so the `pnpm-lock.yaml` must stay in sync with `package.json`. **Never use `npm install`** to add dependencies — always use `pnpm add <package>` (or `pnpm add -D <package>` for dev deps). Using npm will only update `package-lock.json` and the Vercel build will fail.

### Testing

**Vitest** is configured (`vitest.config.ts`, devDependency) and the suite must
stay green. There is no Playwright/browser test runner and no component
rendering tests — everything is **pure-function** coverage of the logic that is
expensive to get wrong, kept next to its subject in `__tests__/`:

| Area | What it pins down |
|---|---|
| `lib/utils/roster/__tests__/` | reconciler classification, repeated-route matching, the spilled-duty match window, import decisions + retention, report tracking, pilot-role rules, sim dedup, tracked fields, the accepted-comparison stamp, that the single-pass timeline sums and acclimatisation equal their per-item definitions, the rolling windows in six time zones, the duty timeline's blocks (duty vs FDP, the FDP's limit at the last on-blocks) and the state at its pointer, the rolling limits at an instant (equal to the day figure once duties end), the Quick Check's violations, and `fifth-schedule-scenarios.test.ts` — the Fifth and First Schedules clause by clause as worked scenarios through the real pipeline, days off (para 5) included; `fdp-pipeline.test.ts` — `runFDPPipeline` itself on the owner's part-flown day (7 Nov 26) and the dashboard on a late last leg |
| `lib/utils/parsers/__tests__/` | PDF row merge, crew-column wrapping, Flt-time/PIC bleed, logbook→sector mapping, aircraft type map, time-reference normalisation, and a REAL schedule PDF (`fixtures/schedule-oct-2026-local-base.pdf`) run through the actual extractor |
| `lib/utils/parsers/shared/__tests__/pooled-map.test.ts` | the bounded fan-out both enrichment chains end in |
| `lib/lookup/__tests__/search-candidates.test.ts`, `lib/lookup/__tests__/composite.test.ts`, `app/api/lookup/__tests__/` | search candidates — airframe and live-flight hits, exact / begins / inside ranking, one row per tail, airport codes off the label; the composed `aircraft/candidates` asking the flight history only for a whole registration search missed, and `exact=1` answering 404 only when every source answered; the door's sign-in rule over both kinds of route; enrichment never taking a near miss |
| `lib/airports/__tests__/code-changes.test.ts`, `lib/utils/parsers/shared/__tests__/airport-enricher.test.ts` | codes that moved between airports (VTZ) — the date rule, each end at its own instant, which stored flights the repair corrects, both airports bundled in one zone; the chain resolving a moved code through its airports and flagging a pool that disagrees |
| `lib/utils/__tests__/history-markers.test.ts` | overlay marker ordering — which dialog `history.back()` would actually take |
| `lib/utils/parsers/logten/__tests__/` | the LogTen Pro migration, run against REAL exports in `fixtures/` — value coercion, the three parsers, UTC-vs-local detection + conversion, duplicate detection, and the cross-file pass |
| `lib/ocr/__tests__/` | both OCR screenshot layouts from synthetic boxes, the engine's plumbing with stand-in models (boxes, CTC decode, the keypad never recognised), device-first routing with the server as the backstop, and SEVEN REAL MCDU PHOTOS (`fixtures/mcdu/`) — what the engine actually reads from each, on the server AND on the device, every slot checked; `OCR_ENGINE=1 pnpm test` runs the photos through the real server engine (`OCR_FIXTURE_WRITE=1` re-pins the reads) |
| `lib/settings/__tests__/` | per-user settings — flat sparse fields, only moved keys written, the legacy carry-up seeding only non-default choices the account lacks, theme kept off the record |
| `lib/theme/__tests__/` | the palette generator — contrast and gamut for every preset in both modes and a sweep of custom seeds, and that globals.css carries the default palette exactly |
| `lib/utils/__tests__/`, `lib/sync/__tests__/`, `lib/db/.../__tests__/` | pending actions, the 90-day window, the recycle bin, sync compaction, conflict resolution, the canonical document shape + write modes, push batching, the sync triggers |
| `cloudflare-worker/__tests__/` | the FR24 gateway Worker — its normalizers (FR24 shapes → the app's), each lookup chain against stand-in upstreams (which source answers when another is challenged, 404 vs 502, failures never cached, `/raw` kept to FR24 hosts), the legacy passthroughs, and the probe's explore mode (`shapeOf`); `lib/airports/__tests__/` the browser's online lookup (the shared pool asked before the gateway, its offset dropped, a blank timezone derived) |
| `lib/sync/server/__tests__/` | the server engine end to end — two devices pushing and pulling, deletions, stale pushes, paging, the migration — against an in-memory Mongo stand-in (`fake-mongo.ts`; it implements only the operators the engine sends) |

Tests that touch a parser must mock `@/lib/db` and
`lib/utils/parsers/shared/airport-enricher` — both reach for IndexedDB at
module scope. See `pdf-schedule-merge.test.ts` for the established stub set.

The synthetic-box OCR tests catch a **geometry** or mapping regression only.
The real-photo fixtures pin what the engines READ, and the photos are
committed at `OCR_MAX_SIDE` — run `OCR_ENGINE=1 pnpm test` before changing the
engine, a model or the image size. (The Time Summary layout still has only a
synthetic fixture.)

## Project Structure

```
app/                              # Next.js App Router
├── layout.tsx                    # Root layout (PWA setup, providers)
├── globals.css                   # Tailwind global styles
├── api/                          # API routes
│   ├── auth/                     #   Registration, login, passkey, session
│   ├── sync/                     #   Round-trip sync (route.ts), legacy bulk + per-collection, TTL setup
│   ├── ocr/                      #   Image OCR processing
│   ├── lookup/                   #   THE online-lookup door (Edge) + the shared pool
│   │   ├── [...path]/            #     Worker routes passed through + composed ones
│   │   └── pool/                 #     aircraft/ + airport/ — MongoDB pool (Node)
│   ├── submissions/              #   User-submitted reference data
│   │   ├── aircraft/             #     Custom aircraft → enrichment
│   │   └── airport/              #     Custom airport → enrichment
│   ├── enrichment/               #   Background enrichment pipeline
│   │   └── batch/                #     Cron-triggered batch enrichment
│   └── timezone/                 #   Coordinate → timezone lookup
└── (app)/                        # Authenticated app pages (route group)
    ├── layout.tsx                #   App layout with nav
    ├── logbook/                  #   Main flight logbook
    ├── flights/[id]/             #   Flight detail & editing
    ├── aircraft/                 #   Aircraft management
    ├── airports/                 #   Airport reference
    ├── crew/                     #   Personnel management
    ├── roster/                   #   Schedule management
    ├── currencies/               #   Certificate tracking
    ├── discrepancies/            #   Pilot-vs-company comparisons + import notes
    ├── recycle-bin/              #   Deleted flights, restorable for 90 days
    └── fdp/                      #   Flight Duty Period tracking

components/                       # React components
├── ui/                           # shadcn/ui base components
├── providers/                    # Context providers (auth, sync, theme)
├── flight-form/                  # Flight entry form components
├── roster/                       # Roster feature components
├── login/                        # Authentication UI
├── flight-list.tsx               # List view with search
├── logbook-calendar.tsx          # Calendar view
├── keep-alive-pages.tsx           # Persistent page shell (keeps heavy pages mounted)
├── desktop-layout.tsx            # Responsive app shell (sidebar + detail panel)
├── bottom-navbar.tsx             # Mobile navigation
├── aircraft-new-form.tsx         # New aircraft form (FR24 auto-populate)
├── airport-new-form.tsx          # New airport form (FR24 auto-populate)
├── aircraft-detail-panel.tsx     # Aircraft detail view (desktop panel)
├── airport-detail-panel.tsx      # Airport detail view (desktop panel)
├── nav-pill.tsx                  # Nav pill ↔ sidebar morph, gravity blob, drag lens
├── bottom-edge-blur.tsx          # Home-indicator darkening fade (iOS standalone)
├── service-worker-register.tsx   # SW registration
└── pwa-install-prompt.tsx        # PWA install prompts

hooks/                            # Custom React hooks
├── data/                         # Data fetching (useFlights, useAircraft, etc.)
├── auth/                         # Authentication hooks
├── sync/                         # Sync status hooks
├── use-detail-panel.tsx           # Detail panel state (keep-alive route aware)
├── use-page-active.tsx           # Active route context + usePageActive hook
└── use-is-desktop.ts             # Responsive breakpoint hook

lib/                              # Core utilities and services
├── db/                           # Database layer
│   ├── user-db.ts                #   Dexie schema & initialization
│   ├── reference-db.ts           #   Reference data DB (airports, aircraft, types)
│   └── stores/                   #   CRUD operations by collection
│       ├── user/                 #     flights.store, aircraft.store, etc.
│       │   └── crud-helpers.ts    #       Generic sync-aware CRUD (create/update/delete/upsertFromServer) shared by user stores
│       └── reference/            #     Reference data stores
│           ├── aircraft.store.ts #       Aircraft DB (FR24/MongoDB-synced + custom)
│           ├── airports.store.ts #       Airport reference data
│           └── aircraft-types.store.ts # ICAO DOC 8643 type designators
├── submissions/                  # Client-side submission helpers
│   └── submit.ts                 #   Fire-and-forget aircraft/airport submissions
├── sync/                         # Cloud sync engine
│   ├── sync-service.ts           #   Client orchestration (one round trip per cycle)
│   ├── sync-trigger-manager.ts   #   When to sync (lifecycle, debounce, poll, retry)
│   ├── schema.ts                 #   Canonical server document shape (shared)
│   ├── authorship.ts             #   Last-write-wins (shared client/server)
│   └── server/engine.ts          #   Server push/pull/migration (server-only)
├── auth/                         # Authentication
│   ├── server/                   #   Server-only (session, webauthn, totp)
│   └── shared/                   #   Shared utilities (cuid)
├── mongodb/                      # MongoDB client (connection pooling)
├── ocr/                          # OCR service & flight data extraction
├── theme/                        # Palettes: the generator (palette.ts) + applying/persisting one (apply.ts)
└── utils/                        # Utility functions
    ├── flight-calculations.ts    #   Time calculations
    ├── night-time.ts             #   Night time rules + the single per-minute night-time calculator (calculateNightTimeComplete)
    ├── time.ts                   #   Time formatting
    ├── aircraft-type-utils.ts    #   ICAO type code parsing & display
    ├── roster/                   #   FDP calculator, draft generator
    └── parsers/                  #   CSV schedule parsers

types/                            # TypeScript type definitions
├── entities/                     # Domain types (flight, aircraft, crew, roster)
│   ├── aircraft.types.ts         #   AircraftRecord, AircraftReference
│   ├── aircraft-type.types.ts    #   AircraftType (DOC 8643)
│   └── airport.types.ts          #   Airport entity with submission support
├── db/                           # Database schema types
├── sync/                         # Sync queue & conflict types
├── auth/                         # Session & WebAuthn types
└── api/                          # Request/response shapes

public/
├── manifest.json                 # PWA manifest
├── sw.js                         # Service worker
├── airports.min.json             # Airport reference database
├── aircraft-types.json           # ICAO DOC 8643 type designators
└── models/                       # OCR ONNX models (~16MB)
```

## Architecture

### Offline-First with Dual Database

All user data is stored locally in **IndexedDB via Dexie** and synced to **MongoDB** when online. This means:

- Data hooks read from Dexie first, not the server
- Mutations write to Dexie and enqueue a sync item
- The sync engine pushes the queue and pulls changes in **one round trip**
  (`POST /api/sync`) — see "The Sync Protocol" below
- Conflicts are resolved **per FIELD, not per record** — see "Field-Level
  Sync" below. Whole-record last-write-wins (`lib/sync/authorship.ts`, one pure
  function both ends import) survives only for creates and for pushes from
  older builds
- Deletions: a user delete is a SOFT delete (an ordinary update); only a purge
  writes a tombstone, and the tombstone commits in the same transaction as the
  record's removal, so a deletion can never apply without one (which would
  resurrect the record on other devices)
- Failed push items are retried and **dead-lettered** after
  `MAX_SYNC_RETRIES` (5) so a poison item can't loop forever; transient
  network/offline failures are not counted toward the cap — and neither is a
  REQUEST-level 4xx (a proxy's 403, a 413), which is no single item's fault.
  Only a per-item `success:false`, or a batch of one, counts
- **The fetch timeout covers the BODY** (`fetchWithTimeout`'s `read`). It used
  to be cleared when the headers arrived, so a connection dropping mid-body
  left `response.json()` pending forever: the cycle never settled, the Web
  Lock was never released and every later sync chained onto it
- **A purge carries the seq it saw the record BINNED at.** The server answers a
  purge of a record that is now LIVE and past that base with the record
  (`stale`), not a deletion — a device that had not caught up used to purge,
  everywhere, a flight another device had restored
- **A comparison's id is derived** (`mismatch:<flight>:<field>`), so a CREATE
  of a tombstoned discrepancy id is a new record: inserted, with the tombstone
  removed in the same commit. Random-id collections keep the rejection
- **One document per record, and the engine copes when there are two**
  (`newestCopies`). The `{userId, id}` unique index cannot be built while a
  collection holds a duplicate, and production carried two (two concurrent
  first pushes, no index to refuse the second). A write used to `replaceOne`
  whichever copy matched FIRST — the older one — and a purge's `deleteOne`
  left the other standing. Now the newest copy (highest `serverSeq`) is the
  record: a write replaces it by `_id` and deletes the superseded copies in the
  same commit, and a purge is a `deleteMany`. `ensureIndexes` removes the
  superseded copies (`collapseDuplicateCopies` — each delete pinned to the seq
  it read) and then builds the index

### The Sync Protocol (`/api/sync`, `lib/sync/`)

| | Where | What |
|---|---|---|
| request | `lib/sync/sync-service.ts` | `{ schemaVersion, items, cursors, tombSeq, since, knownSeq }` |
| server | `app/api/sync/route.ts` → `lib/sync/server/engine.ts` | push (one transaction per collection), then pull every collection |
| response | | `{ results, changes, cursors, tombSeq, hasMore, headSeq }` or `{ upToDate }` |

- **Everything is on ONE per-user monotonic counter** (`counters.seq`, reserved
  inside the write transaction). Records carry `serverSeq`; tombstones carry
  one too, so deletions ride the same cursor as records instead of a wall
  clock. Per-collection record cursors are keyset `(serverSeq, _id)`; deletions
  use `tombSeq`.
- **The cheap poll.** After a COMPLETE pull the client stores the seq head
  (`knownSeq`). A request with nothing to push and that `knownSeq` is answered
  `upToDate` after ONE `findOne` on the counter — no collection is queried. The
  head is read BEFORE the pull's queries, which is what makes storing it safe.
  Anything that reserves seqs outside a write transaction (the tombstone
  migration) must reserve and write in one transaction, or the head can run
  ahead of a row that isn't readable yet.
- **A pusher doesn't download its own write.** Records this request just wrote
  are left out of the pull payload while the cursor still advances past them
  (matched on the exact seq written, so a concurrent overwrite still arrives).
- **A stale push is answered with the winner** (`stale` + `record`), applied
  immediately rather than left for a pull that may already be past it.
- **Pulled changes are applied in BULK** — per collection one transaction,
  one `bulkGet`, LWW in memory (`selectServerWinners`), one `bulkPut`, one
  `bulkDelete`. A locally newer copy (an unpushed edit) is kept; a tie is
  re-applied, which repairs a drifted local copy.
- **Bounded both ways**: a push batch by count AND bytes (`takePushBatch` — a
  signed flight is tens of KB), a pull page by records AND bytes (Vercel caps a
  response at 4.5MB). Each always takes at least one item so an oversized
  record cannot stall a queue.
- **The client heals itself.** Every cycle re-enqueues records marked
  `pending` with no queue row (`requeueOrphanedRecords` — a store writes the
  record and THEN enqueues, so a tab killed between the two used to lose the
  edit forever). The `SYNC_PROTOCOL` bump re-pulls everything once per device
  and gives dead-lettered records one more chance.
- **Tabs**: a Web Lock serialises sync across tabs (they share one queue) and a
  `BroadcastChannel` tells the other tabs their SWR caches are stale.
- `lastSyncTime` is the SERVER clock, advanced only on a clean drain (or an
  `upToDate`); it drives the 30-day `requiresFullResync` gate, because a
  tombstone expires after 30 days.

**The legacy routes stay** (`/api/sync/bulk`, `/api/sync/[collection]`) for an
installed PWA still on an older build; both go through the same engine, so
their writes are canonical too.

### Field-Level Sync (`lib/sync/changes.ts`)

Whole-record last-write-wins corrupts data in the most ordinary situation: a
device that has not caught up holds an OLD copy, the pilot edits one field on
it, the whole record goes up with a newer timestamp, and every field another
device changed in the meantime is reverted to the stale copy. So an edit is a
PATCH, not a record:

| | Client | Server |
|---|---|---|
| what changed | `updateEntity` diffs before/after → `changedFields`; a no-op edit writes nothing | applies ONLY those fields onto the stored document |
| against what | `baseSeq` — the record's `serverSeq` when the first collapsed edit was made | `fieldVersions` — `{seq, at, by}` per field, which write last changed it |
| conflict | — | the same field changed by ANOTHER device since `baseSeq`, to a different value |
| resolution | — | the later edit wins (`editTime`, capped 5 min past the server clock); the loser is written to `syncConflicts` (TTL 90 days) |

- A change since the base made by the SAME device is its own history, not a
  conflict — which is why each push result carries the new `serverSeq` and
  `reconcilePushedRecords` stores it.
- Queue rows UNION their fields when edits collapse, and keep the EARLIEST
  base (`addToSyncQueue`, `compactSyncQueue`). A create is a whole-record
  write; edits that collapse into a create row still accumulate fields, and
  once the create is confirmed the row becomes a field patch on the seq it
  landed at.
- **A pulled record is REBASED, not compared by clock** (`planLocalApply`): no
  pending edit → the server's copy, whatever the timestamps say (it came off a
  monotonic cursor, so it is newer than anything this device last saw); a
  pending field edit → the server's copy with those fields laid over it; a
  pending purge → not resurrected; a pending create or a dead-lettered
  (`error`) row → last-write-wins.
- When a push comes back MERGED (another device changed other fields), the
  record is returned and the device recomputes a flight's DERIVED times from
  the combined record (`recomputeMergedFlights`) — A set IN while B set OUT, and
  each computed block time from half the picture. `manualOverrides` are
  respected and simulators skipped, like every other recalculation pass.
- Arrays and objects (`approaches`, `additionalCrew`, `signature`,
  `importDecisions`) are ONE field each: two devices editing the same list
  concurrently is a conflict, not an element merge. An EMPTY list or object
  counts as no value (`sameValue`), the same as `null`/`undefined`.
- **An edit FORM writes only what the user changed** (`lib/utils/form-patch.ts`).
  The flight form saved its whole copy of the flight, and after a pull that
  copy was stale — so an iPad with a flight open sent the phone's new OUT time
  and signature straight back, with nobody touching the iPad, and the server
  saw a genuine edit (diffed against the pulled row, based on the pulled seq).
  The form keeps a BASELINE, saves `formPatch(form, baseline)`, and follows
  the row underneath it with `rebaseForm` — every field the user has not
  touched is adopted into form and baseline alike. The crew form does the same.
- **A queue row an edit collapsed into mid-push is REBASED** when that push
  is confirmed: the fields now on the server are dropped and its base moves to
  the seq the push landed at (`reconcilePushedRecords`). Re-sending them
  against the old base made another device's later edit look concurrent.
- **An orphan is requeued as a field PATCH** of every field against its last
  seq, not a whole record — a stale copy with a newer `updatedAt` used to win
  every field by clock. Enqueueing is ONE transaction (read + write).
- **A full resync keeps unsynced rows** (`clearDataTablesForResync`): pending,
  dead-lettered and queued records survive the wipe; the server leaves a record
  out of the pull of the request that pushed it, so wiping it lost it.

### The Canonical Document Shape (`lib/sync/schema.ts`)

Every document in every synced collection has the SAME keys in the SAME order:
the envelope (`id, userId, schemaVersion, createdAt, updatedAt, deletedAt,
deviceId, serverSeq, syncedAt, fieldVersions`), then every field of the entity in declared
order, missing ones written as their default (`""`, `0`, `"00:00"`, `[]`, or
`null` for anything optional). Keys the table does not know are KEPT, at the
end — a newer build's field or unexamined legacy data, and dropping either is
data loss.

- The field tables are **`satisfies`-checked against the entity types** — add a
  field to `FlightLog` without adding it there and `tsc` fails.
- **`null` is stripped again on the way down** (`toWireRecord`), and so are
  the server-only keys (`syncedAt`, `schemaVersion`, `fieldVersions`), so a
  client sees exactly the shape it always has. That is safe for `deletedAt`: a pulled
  record REPLACES the local row whole.
- **Write modes** (`writeMode`): a client that declares the current
  `SYNC_SCHEMA_VERSION` sends complete entities, so its payload REPLACES the
  stored document — an omitted key is cleared, which `$set` never allowed. A
  client that declares nothing (an old build) is MERGED over the stored
  document, because it may not know a field a newer device wrote.
- **Migration is lazy and chunked** (`ensureCanonical`): each sync request
  rewrites up to 1000 of the user's documents and sequences their legacy
  tombstones, until the counter doc records the version. It does NOT bump
  `serverSeq` (content is unchanged), and each rewrite is filtered on the seq
  it read, so a push landing mid-migration is never overwritten.
- Bump `SYNC_SCHEMA_VERSION` when a field table changes in a way existing
  documents must be rewritten for — and ADDING a field is such a change. `pfRole`
  went into the personnel table after version 2 had already migrated, so not one
  stored crew card carried it until version 3.
- **One fact, one spelling** (`NORMALIZE`, v3). A field whose right value follows
  from another is settled on every write: a flight's `entryType` and
  `isSimulator` always agree and are never `null`, `isLocked` and a crew card's
  switches are booleans. Production held "an ordinary unlocked flight" three
  ways (`entryType` on 14 flights and `null` on 307; `isLocked` `false` on 250
  and `null` on 71), which every query on those fields had to know about.
- **One type per field, one way of saying nothing** (`conformField` in
  `canonicalizeDocument`, on every write). A field declared with a value is
  REQUIRED in that value's type and never `null` — a switch is `true`/`false`,
  a list `[]`, a time `"00:00"`; a field declared `opt(kind)` is OPTIONAL,
  `null` when unrecorded and of `kind` when recorded. Bare `null` (any type)
  is kept only where the type really varies (a comparison's two values, the
  sparse settings record). A wrong type is converted when unambiguous (`"true"`,
  `"90"`, `8`→`"8"`); otherwise the value goes to `schemaRejects` on the
  document and the field takes its default — set aside, never silently lost.
  Unknown keys are still kept: that is the room left for a future build.
  Audited 21 Oct 2026: production already held one type per field everywhere
  except the null switches v3 settles.
- **A key is only dropped by name** (`RETIRED_KEYS`). Unknown keys are kept,
  because one may be a newer build's field; `isDraft` (213 flights, all `false`,
  referenced nowhere) was checked dead first, then listed.

### Sync Triggers (`lib/sync/sync-trigger-manager.ts`)

| Trigger | Does |
|---|---|
| app opened, foregrounded, focused, back online, page restored | sync now (coalesced within 2s) |
| a local edit | push after 1.5s quiet, never later than 8s |
| app visible + online | poll every 15s (the cheap `upToDate` request) |
| a failed cycle with work left | retry, 5s doubling to 5min |
| app hidden / `pagehide` / unload | keepalive flush (push only, under the 64KB keepalive cap) |

**No trigger looks at the local queue.** The old manager returned "no sync
needed" whenever THIS device had nothing to push — so foreground, focus,
online and the periodic check never pulled another device's edits, and the
only unconditional pull was the one at login. That is why logging in again was
the reliable way to catch up. `sync-triggers.test.ts` pins it.

**A failed cycle says so** (`SyncStatus` `"error"`). The status was
`online` / `offline` / `syncing`, and a cycle that ended `ok: false` while
online — the server answering 5xx, a session that could not be renewed, an
item rejected — fell straight back to `online`: a green cloud over edits that
were not reaching the server. It now ends in `error` (an amber cloud with its
own mark, still tappable to retry) until the next clean cycle. A cycle that
stopped at the round cap is `partial`, unfinished rather than failed, and
stays `online`.

The "syncing" status is only raised for real work (a push, a first pull, or a
poll that came back with changes), and `onDataChanged` only fires when
something changed — a poll every 15s must not flash the indicator or refresh
every cache.

A sync requested WHILE one is running (an edit during the initial sync) gets
ONE shared follow-up run when it finishes (`fullSync`'s `followUp`). Returning
the running sync's promise instead left the edit for the next poll, because
that run had already read the queue.

**Signing out pushes first and asks before discarding.** Both sign-out paths
on the account page revoked the session and THEN ran the pre-logout sync, which
then got a 401 — so every unsynced edit was wiped with the local data, online
or not. `confirmUnsyncedLoss` pushes while the session still works
(`flushBeforeSignOut`) and confirms if anything is left. It is a confirmation
because the loss has no undo. It then signs out with `logout({ skipSync: true })`
(the session is already revoked, so a second sync would only meet a 401), and
`logout` waits for an in-flight cycle (`syncService.whenIdle`) before wiping —
or that cycle wrote the previous user's records back into the wiped tables.
"Sign out of all devices" refuses offline and requires the revoke to succeed:
it exists for a LOST device, and swallowing the failure signed out only this one.

**A sign-out answers the TAP, and its push is bounded.** The button said
nothing until `flushBeforeSignOut` came back, and that is a full cycle — on a
phone a round trip to the server and the reference pull, or a wait behind
another tab's cross-tab lock — so on device the tap read as a sign-out that did
not work. The label turns to "Signing out…" on the tap, and the push is raced
against 8s (`flushBeforeSignOut(maxWaitMs)`): past it the queue is counted as it
stands, which can only OVER-count (the confirmation asks about rows the running
cycle may yet deliver), and `logout` still waits for that cycle before wiping.
A failure says so (`appAlert`) rather than leaving the button as it was.

**Live multi-device test** — `scripts/sync-live-test/` drives the real app in
separate browser profiles against a real MongoDB replica set (README there).
It is what found the trigger gating, the stale-device overwrite, the logout
loss and the airport-seed stall; run it after changing anything here.

**Initialization is auth-driven, not mount-driven.** `SyncProvider`
(`components/providers/sync-provider.tsx`) is mounted once at the root and never
remounts across login/logout (those are route changes). It watches
`useAuth().user`: when `userId` becomes non-null — on a boot-with-session **or
any later login** — it calls `initializeTriggers()` and runs an initial
`fullSync()`; when `userId` goes null (logout) it tears the triggers down so the
next login re-initializes cleanly. A `syncedUserId` ref ensures this fires only
on a real user transition (a callsign change or silent reauth keeps the same
`userId`, so it does not resync). Do **not** revert this to a one-shot
`getUserSession()` check at mount — that skips the initial sync *and the
triggers* whenever the app is cold-opened logged-out and the user then logs in
(only the manual sync button worked).

**Per-collection dispatch** (delete + normalize for the server's records) goes
through the single `COLLECTION_HANDLERS` registry in `sync-service.ts`, keyed by
the closed `SyncCollection` union — add a collection in one compile-checked
place (and its field table in `lib/sync/schema.ts`), not in parallel
switch/if-else chains.

**`SyncProvider` is the ONE `onDataChanged` → `refreshAllData` subscriber.**
The dashboard and the logbook each had their own as well, and both of those
pages are keep-alive — permanently mounted once visited — so a single sync
cycle ran the entire cache refresh three times over, which is three full reads
of every table plus the re-renders each one triggers. A page that needs its own
data back after a background pull gets it from the shared refresh; a page that
needs it on RE-ACTIVATION uses `usePageActive`'s callback, which is a different
trigger — and runs the re-read through `whenIdle` (`lib/utils/idle.ts`), never
inside the tab switch: the logbook's was a read of every flight, a deep compare
and a render on the frame the page was meant to appear in, and the dashboard's
was `refreshAllData`, i.e. every table.

`refreshAllData` (`hooks/data/use-db.ts`) also **coalesces**: concurrent callers
share one in-flight pass, so a provider refresh landing on the same tick as a
page's re-activation refresh is still one pass. And it revalidates by **key
filter** (`key.startsWith("idb:")`), not a hardcoded list — the old four-key
version never touched the schedule, currency or discrepancy caches, so those
pages showed pre-sync numbers until they remounted. Every SWR key in
`hooks/data/` carries the `idb:` prefix, including derived ones
(`idb:discrepancies:counts`, `idb:schedule:<from>:<to>`); keep it that way.


### Authentication Flow

1. **Registration**: Create callsign → server issues WebAuthn challenge (stores `userId`/`callsign`/`totpSecret` on the challenge doc with `type: "registration"`) → register passkey → `register/complete` consumes the challenge and creates the user from the **server-authored** values (it does not trust client-supplied `userId`/`callsign`/`totpSecret`) → setup TOTP
2. **Login**: server issues WebAuthn challenge → passkey assertion is **cryptographically verified** server-side via `verifyAuthenticationResponse` (challenge binding in `clientDataJSON` + signature against the stored public key + ceremony type) → optional TOTP → session cookie
3. **Silent reauth**: On page load, checks session → if expired, attempts passkey silent auth (same server-side verification)

**Auth security invariants (do not regress):**
- Every passkey login **must** call `verifyAuthenticationResponse` before issuing a session — never trust a `credential.id` lookup alone (credential IDs are not secret). `register/complete` and `register/add-passkey` likewise bind the attestation by checking `clientDataJSON.type === "webauthn.create"` and a matching challenge.
- Challenges are **single-use**: consume them with `findOneAndDelete` (type + expiry checked) so they can't be replayed.
- The WebAuthn signature counter is enforced as strictly-increasing **only when a counter is in use** (either side non-zero) — synced/platform passkeys report `signCount 0` permanently and must not be locked out on their second use.
- TOTP is **single-use**: verify with `verifyTOTPWithCounter` and reject any code whose time-step `counter <= auth.lastTotpCounter` (shared across the TOTP login and callsign-change endpoints). Compare codes in constant time.
- TOTP bookkeeping is **atomic** (`lib/auth/server/totp-attempts.ts`): `claimTotpCounter` is a conditional update only one request can win, and `recordTotpFailure` counts with `$inc`. Read-then-write let parallel guesses skip the 5-attempt lockout and one code log in twice. The callsign change shares the lockout.
- Login challenges are typed `"login"` and consumed only as that type.
- No route returns the session TOKEN in a body — it is the HttpOnly cookie's secret.
- **A session row stores the SHA-256 of the token, never the token**
  (`hashSessionToken`, in the row's `token` field so the unique index still
  holds). Look a row up with `sessionTokenFilter` and recognise the current one
  with `isSessionRowFor` — both also accept a row written before hashing, which
  `upgradeLegacySessionRow` rewrites to the hash on its first use.
- **A store error is not a missing session.** `validateSession` throws (`SessionStoreUnavailableError`) so the route answers 5xx; returning `null` turned a MongoDB cold start into a 401 the client read as "signed out". It also re-sets the cookie when it slides the session forward.

**A 401 during sync is a claim, not proof** (`handleSyncReauth`): the session
probe decides — `valid` retries, `unknown` changes nothing, only `invalid` marks
the session expired. A passkey ceremony is attempted only with live user
activation, and `silentReauth` shares ONE in-flight ceremony; from a background
poll it used to raise the passkey sheet repeatedly. The login page returns to
`/` when the session turns out to be fine, so a pilot sent there by a false
alarm is not left signing in again.

**One device, one account's data.** `syncMeta.dataOwner` records whose data the
device holds. Signing in as a DIFFERENT account clears it first (asking if
anything is unsynced) — it used to push the first account's queued edits into
the second account and pull the second one from the first one's cursors. A
silent reauth answered by another account's passkey is ignored.

Sessions are stored in MongoDB (TTL on `expiresAt`, a BSON Date — `ensureIndexes` creates it; until it did, expired rows were never removed) and mirrored to IndexedDB. Cookies are HttpOnly + Secure + SameSite=Lax. Each session row also stores the request **`userAgent`** (set in `issueSession`) so the account page can label active sessions by device.

**Session reactivity & resync interception** (`auth-provider.tsx`):
- A global **session monitor** revalidates `/api/auth/session` on focus, visibility, network-online, an `auth:unauthorized` event, and a slow interval, flipping a reactive **`sessionExpired`** flag so a session revoked elsewhere is reflected without a manual refresh. The route guard sends a logged-in-but-expired user through the custom login flow (keeping local data).
- The sync engine emits `auth:unauthorized` on any 401, and a **locally-expired** session attempts reauth (custom passkey flow) instead of a silent no-op — this is why a manual resync against a dead session now actually prompts re-auth. `ensureValidSession()` gates the manual sync button: it revalidates, runs passkey reauth if needed, and only then syncs. Do **not** restore the silent early-return on expiry.

**Step-up auth** (`lib/auth/server/step-up.ts`): sensitive account actions are gated behind a fresh passkey assertion. `GET /api/account/step-up` issues a user-bound single-use challenge; `verifyStepUpAssertion` verifies it with the same `verifyAuthenticationResponse` path (and advances the counter). Used to **reveal the TOTP seed/QR** (`/api/account/totp/reveal` — never served without it) so a user who lost their authenticator can re-add it, and as an **alternative to TOTP** for changing the callsign.

**Per-device passkeys:** each passkey stores the registering browser's opaque `deviceId` (`getOrCreateDeviceId`, sent on register/add-passkey). The account page uses it to show "Add passkey for this device" vs "This device already has a passkey" (instead of letting `navigator.credentials.create` throw `InvalidStateError` on a duplicate — which is also caught gracefully everywhere as a no-op).

### Shared Reference Data System

Aircraft and airport reference data is managed through a multi-tier lookup and enrichment pipeline:

**Data Sources:**
- **Aircraft Database** (IndexedDB `referenceDb.aircraftDatabase`): there is **no** bulk CDN download. The table is populated on demand from FR24 search results, custom user entries, and the shared MongoDB enriched pool synced via `/api/sync/aircraft-reference` (per-user cursor)
- **Airport Database**: Loaded from `public/airports.min.json` into IndexedDB
- **ICAO DOC 8643 Aircraft Types**: Loaded from `public/aircraft-types.json` with memory + IndexedDB two-level caching
- **FR24 APIs** (live), all through ONE Cloudflare Worker — the FR24 gateway
  (`cloudflare-worker/worker.js`, README there). Calling FR24 directly from Node or
  Edge is 403'd by its Cloudflare challenge; through the Worker it depends on
  who calls the Worker (below). It
  answers in the APP's shapes (`lib/fr24/types.ts`), and every lookup the app
  depends on is a CHAIN, because FR24 changes what it challenges without
  notice — `traffic-stats`, the airport source for months, stopped answering:

  | Worker route | Chain |
  |---|---|
  | `/airport` | `airport.json` + `traffic-stats` (carry the timezone) → `_json/airports.php` + search (position only) |
  | `/aircraft` | search → the registration's flight history → live feed |
  | `/aircraft/flights`, `/flight` | `common/v1/flight/list.json` by registration / flight number |
  | `/airport/details`, `/airport/schedule` | `airport.json` plugins (runways, weather, boards) |
  | `/airports`, `/airlines`, `/search`, `/live`, `/flight/details` | the lists, search grouped by kind, the live feed, one live flight |

  `GET /probe` on the deployed Worker reports which upstreams answer from
  Cloudflare today — run it before concluding a lookup is broken in the app;
  `explore=1` adds sources no route reads yet and the SHAPE of what each
  answers (and of what the in-use normalizers drop), for deciding what to add.
  **FR24 scores whoever CALLS the Worker, not the Worker.** For a Worker's
  subrequest Cloudflare carries the original caller's bot signals through,
  so the same Worker, headers and endpoints pass from a pilot's browser and
  from Vercel's EDGE runtime and are challenged from the NODE runtime
  (measured 29 Oct 2026: every Edge call passed, every Node call failed,
  same region). That is why every app route that calls the Worker must run
  on Edge — the old airport search route was moved to Node on 2 Jun 2026 to
  read MongoDB and stopped finding airports. A NODE route that needs a lookup
  (the aircraft enrichment on submit and the daily cron) HANDS IT to the Edge
  door with `lookupFromEdge` (`lib/lookup/handoff.ts`): on the user's own
  deployment with their cookies (which is what gets a preview's call past
  Vercel's deployment protection), or on the production domain for the cron,
  with `x-lookup-secret`. Enrichment has THREE outcomes (`found` /
  `not_found` / `unavailable`) and only `not_found` costs a retry: counting
  a challenged lookup as "unknown aircraft" is what marked submissions
  `failed` while every Node lookup was challenged. A `/probe` run from a server
  measures that server, not the app — which is why `/api/lookup-test/probe`
  exists (EDGE, no sign-in, previews only by default): it is the one place the
  probe measures the caller the app actually is. Run 30 Oct 2026 from `iad1`,
  every in-use source answered; of the candidates, an airline's FLEET page
  (`/data/airlines/<iata>-<icao>/fleet`, HTML, ~63 Scoot registrations), the
  live feed by airline, flight playback (the track and photos), the second
  search host (`common/v1/search.json`), airport disruptions and airline logos
  answer; the live click handler carries gate/terminal/baggage, which the
  flight history does not; `/api/v1/airlines/<icao>/fleet` exists but answers
  401 (an FR24 account — not to be worked round). The keyed official API
  (`fr24api.flightradar24.com`) is the route that does not depend on how
  FR24 scores a caller; do not work
  round the challenge (impersonated clients, FR24's web gRPC headers). The
  Worker's secret binding is `PROXY_SECRET` — the dashboard one was
  `" PROXY_SECRET"` with a leading space, so the secret was never enforced.
  Keep it a SECRET (encrypted), not a plain-text variable: `wrangler deploy`
  replaces the Worker's configuration with `wrangler.toml`'s, and a deploy
  without `keep_vars = true` (now set) deleted the plain-text one on 29 Oct
  2026 and left the Worker open — after a deploy, `/probe` without the header
  must answer 401.
  404 means a source answered and has no such thing (manual entry); 502 means
  every source failed (try later) — callers must not treat them alike. Every
  hop reads that envelope through ONE function, `readEnvelope`
  (`lib/fr24/envelope.ts`) — the Worker client, the Node → Edge hand-off and
  the browser each parsed it by hand, and the browser read an answer that was
  not the envelope (a deploy's HTML 404, a sign-in page) as "not found". It is
  502. The door lets the browser keep an answer for a minute, except the ones
  that move by the minute (`LIVE_ROUTES`: gates, whereabouts, boards, airport
  details, the live feed) — kept, the duty band's refresh read the same gate
  back from the HTTP cache. The shared pool answers a MongoDB failure 503,
  which `lookup.pool*` turns into `null` ("not asked"), not `{}` ("nobody has
  it"). The
  Worker's legacy passthroughs (`/v1/search/web/find`,
  `/airports/traffic-stats/`) stay so the app and the Worker can deploy in
  either order. Server code calls it through `callFr24Worker`
  (`lib/fr24/worker-client.ts`, reads `FR24_PROXY_URL`/`FR24_PROXY_SECRET`);
  the PWA through `/api/lookup/[...path]` (EDGE; `lib/lookup/client.ts`),
  which never exposes `/raw` or `/probe`. **The door is the app's ONE online
  lookup surface**: it passes the Worker's normalized routes through and
  COMPOSES the ones the app needs from several of them
  (`lib/lookup/composite.ts` — `aircraft/candidates`, `airport/candidates`),
  in one envelope, behind one sign-in rule; the shared MongoDB pool is the two
  Node routes beside it, `/api/lookup/pool/{aircraft,airport}` (a static
  segment routes before the catch-all; not behind the sign-in rule, because it
  spends no lookup quota). `/api/search/*`, the per-kind routes all of this
  grew out of, is GONE — nothing fetches a lookup URL by hand, every caller
  goes through `lookup.*`, and a new route is a key in `LookupRoutes`
  (`lib/lookup/types.ts`). The door admits server code with
  `x-lookup-secret` and a browser only with a session the Node
  `/api/auth/session` confirms (Edge cannot read MongoDB, so it forwards the
  cookies there; a failed check is a 503, not a sign-out). The path does not
  name the source, on purpose
- **Server Enrichment DB** (MongoDB): User-submitted aircraft/airports enriched and shared across users

**Lookup Chain (aircraft):**
1. Local IndexedDB (`referenceDb.aircraftDatabase`) — FR24 + custom + MongoDB-synced records in one unified table
2. The shared pool (`lookup.poolAircraft`, `/api/lookup/pool/aircraft`) — checks enriched submissions from other users
3. The door's `aircraft/candidates` (`lookup.aircraftCandidates`) — EDGE. It answers EVERY aircraft
   the text could be (`aircraftCandidates`, `lib/lookup/search-candidates.ts`),
   off the Worker's `/search`: airframe hits AND live flights flying a matching
   tail, exact first, then the registrations it begins, then those it is
   inside, each marked `exact`. The Worker's `/aircraft` chain keeps only
   `type: "aircraft"` hits, which is why "9VO" found nothing there while the
   search route listed many. When nothing is exact and the text could be a
   whole registration (5+ characters once the dash goes), the registration's
   flight history (`aircraft/flights`) is asked as well — search does not index
   every airframe. ONLY an exact candidate is ever taken without the pilot
   choosing it: the add-aircraft form and the aircraft page list the rest; the
   import enricher and the server enrichment ask with `exact=1`
   (`lookup.aircraftExact`), which answers that registration, 404 only when
   every source asked has answered, and 502 when one could not be asked
4. Manual entry (user types registration + type code)

**Lookup Chain (airport):**
1. Local IndexedDB (`referenceDb.airports`) — includes static + custom airports
2. Shared pool (`lookup.poolAirports`, `/api/lookup/pool/airport`, MongoDB,
   Node) — airports other users added; asked first, so they never cost a
   gateway call
3. The door's `airport` (`lookup.airport`, the Worker's chain) — EDGE. 2 and 3
   are one call from the browser, `lookupAirportOnline`
   (`lib/airports/online-lookup.ts`), which also derives a blank timezone
   through `/api/timezone`; `lookupAirportLive` is 3 alone, for the import
   enricher, which asks the pool for every code in one request
4. Manual entry (user types ICAO + details)

The add-airport form also LISTS what a partial code could be
(the door's `airport/candidates`, EDGE, `airportCandidates` — the codes read
off the search hit's label, name matched when the text is no code); choosing
one looks it up in full like a typed code.

**Smart seeding — what a flight number, a date and an airline already say**
(30 Oct 2026; every source measured from Edge through `/api/lookup-test`):

| | Source | Rule |
|---|---|---|
| a flight from its number + date (`flight/suggest`, `lib/lookup/flight-suggest.ts`) | the number's list (`/flight`): a week ahead SCHEDULED, a week back flown; the registration appears on the day the aeroplane is assigned | `basis: "scheduled"` is that UTC date's row; past the list, `"usual"` moves the nearest day's times onto the date and NEVER carries its registration |
| filling the form (`lib/utils/flight-seed.ts` `lookupPatch`, `useFlightLookup`) | — | asked ONLY on the form's Lookup button (or Enter in Flight #) — it used to ask by itself once the number settled, a lookup per pause while typing. An answer is applied only while the form still holds the number and date it was asked for (`sameFlightNumber`) — one landing after the pilot moved on is dropped, and the status line hides once either changes. Writes BLANK fields and whatever the PREVIOUS lookup wrote that the pilot has not touched since (`ownedAfter`), so 288 then 289 moves the route and times with the number and clears 288's aeroplane; anything the pilot entered is kept, and "Replace" writes over it. Replace is offered only where the pilot's OWN non-blank value differs — a blank is filled, and a value that merely completes theirs (the IATA of their ICAO, the type of their registration) is filled too; "9VTNF" and "wsss" are not differences. It is read off the form AS IT STANDS (`lookupDiffers`), not stored when the answer came, so it follows edits; the line names the rows ("Kept yours: Aircraft, To") under the summary, never beside it A `usual` answer fills route and times (the pilot asked; the status line says "Usual times (6 Nov)") but never the aeroplane; never OOOI, never a simulator, signed or locked entry. The status line wraps between its parts (`whitespace-nowrap` per part), never inside a registration |
| gates (`flight/gates`, `useDutyLookups`) | the tracked flight's `info`, else the departures board at the origin and the arrivals board at the destination, from an hour before | NOT in the flight form (it is for logging): drawn on the dashboard's sector chain, under each stop, asked ONLY while the page is on screen and the duty within 18h of now (no SWR key otherwise, so coming back asks about the duty as it now stands — deduplicated to 5 min — instead of showing a stale "nothing yet"), every 15 min while it stays up, with a refresh; never stored (a gate is published late and moves). The duty's legs end at the first 8h on the ground (`dutyFlights` — 18h can reach the next duty's first sector). The line under the chain (`describeDuty`, `lib/utils/dashboard/duty-line.ts`) never calls a failure "not published yet": checking / not checked / unavailable / not published are four different sentences |
| a fleet (`airline/fleet`, `AirlineFleetSection`, the add-aircraft form's **By fleet** mode) | the airline's fleet page, by type | By registration is the default; By fleet asks for the pilot's airline when it opens, and otherwise only on Find / Enter — never per keystroke. Add writes a whole type in one `bulkPut` (`addFleetAircraftToDatabase`); a registration already held is left as it is |
| the network (`airline/routes`, `airline/routes/from`) | the routes page's `arrRoutes`; a map pin's per-airport JSON | in the door, nothing reads them yet — the destination seeding they enable is on hold |
| where the aeroplane is (`aircraft/whereabouts`, `lib/lookup/aircraft-whereabouts.ts`) | the registration's list: the last flight it DEPARTS on before `at` (our departure, or now) — landed / airborne / not yet left — and the one after; the inbound's ARRIVAL gate from the live flight, else the arrivals board | the duty band's line under the chain for the NEXT LEG STILL TO FLY (`inboundLeg` — on duty a later leg can be another tail; legs in FLOWN order, `sortFlights` is newest first), the duty panel, and the aircraft panel's **Now** section (on a tap); "9V-NCA · Landed 03:00Z · 30m ago · TR289 from DPS" — the inbound's arrival gate is said only while the leg's OWN departure gate is not yet published (it is drawn under the stop, and in the panel's Gates row; saying it twice was the owner's report), and then it comes first so a cut-short line keeps it; never stored; a departure within 20 min of `at` is our own flight pushing back, not the inbound |
| the missing sector (`seedDerivedLeg`, `seedFromNextFlight`) | what the aeroplane flies after the leg a Next Leg / Return was made from (`aircraft/whereabouts` at that leg's arrival) | fills the new leg's blanks — number, far end, scheduled times — only when that flight leaves from this leg's departure airport; may move the DERIVED leg's date a day on (an overnight return), only while it records no times |
| the pilot's airline (`useAirlineCode`: Settings › Logging › Airline, `logging_airline`, else the SELF card's company through the airline list) | the airline list (`lib/airlines/airlines.ts`, `/airlines`, kept 30 days in localStorage) | an EMPTY Flight # starts with it on focus (`DraftInput`'s `prefill`, committed only once something is typed — clearing it leaves the field empty; not on a simulator). A LETTER typed first replaces it and a digit is added to it (`afterPrefill`), so typing "TR288" out of habit or pasting it is not "TRTR288"; Lookup prefixes a digits-only number (`withAirlinePrefix`); By fleet starts with it. A crew card's company field lists airlines as it is typed and a pick writes the standard name |
| gates from the dashboard | the duty band's sector chain | the chain still opens `duty:<start ms>` (`DutyFlightsPanel`: each leg's Gates, the next leg's Inbound, Open flight) on the SAME cache as the band (`lookup:duty:` key), so either refreshes both. Measured at 360×780 with gates and the inbound line: no page scroll |
| the import cross-check (`aircraft-cross-check.ts`) | `flight/suggest` per touched flight, a week back to a day ahead, ≤ 24, nearest today first | a flight logged on another aeroplane than that day's SCHEDULED one gets an `aircraft_mismatch` NOTE (`aircraft-check:<flight>`, once; resolves itself when they agree) — never a change |

The flight number's list, the boards and the per-airport timetable all reach
only a few days ahead: a date further out gets usual times, not a schedule.

**An IATA code is not an airport for all time** (`lib/airports/code-changes.ts`).
VTZ moved from Visakhapatnam's old airport (VOVZ) to Bhogapuram (VOVI) at 00:01
IST on 17 Aug 2026, and the company reports name airports by IATA only, so the
question is always "which airport was this code WHEN THE FLIGHT FLEW":

| | Rule |
|---|---|
| the table | `IATA_REASSIGNMENTS` — code, from/to ICAO, the UTC instant, a source. A new move goes here AND its new airport into `airports.min.json` (bump `AIRPORT_DATA_VERSION`); the test checks both airports are bundled, in one zone |
| lookup | `getAirportByIata(iata, atMs?)` answers a moved code with the airport it meant at `atMs` (now when omitted) — and with nothing if that airport is not on the device, never the other row carrying the code |
| imports | all three resolve each END of a sector at its own instant (`flightInstantMs`, `pickAirportAt`); the enrichment chain fetches every airport a moved code has meant, never the bare code. Times are converted on the first answer, which is why both sides of a move must share a zone |
| stored flights | `repairReassignedAirports` (each launch, in the background — after a data bump it waits for the reseed) moves a flight holding one of the code's airports, the wrong one for its date, through `updateFlight`, with that airport's offset and its night / day-night TO-LDG recalculated (pins respected). A SIGNED or LOCKED flight is never changed: it gets a Discrepancies note (`airport-code:<flight>:<side>`, once) that resolves itself when the flight is right |
| an undated move | the chain asks the shared pool about every code it answered LOCALLY, in the same request, and a pool that gives another airport is an import WARNING (`codeConflicts`) — reported, never applied |

Offsets are taken at the flight's instant everywhere a report is read (the
eCrew executor and logbook parser, LogTen via `offsetAt`): today's offset
converted a summer-time flight an hour out. The bundled file is fetched at
`/airports.min.json?v=<version>` — the service worker serves the bare URL
stale-while-revalidate, which stamped the new version on the OLD file.

**Enrichment Pipeline:**
- Custom aircraft/airports are submitted fire-and-forget to `/api/submissions/aircraft` or `/api/submissions/airport`
- Server attempts real-time enrichment (FR24 for aircraft, geo-tz for airports)
- Failed enrichments are retried by `/api/enrichment/batch` (cron; a widening
  1/2/4/8/16/32-day backoff, because an unknown tail is usually an aeroplane not
  yet delivered — it rehydrates when FR24 lists it) —
  scheduled daily in `vercel.json`. Vercel Cron sends **GET** with
  `Authorization: Bearer $CRON_SECRET`; the route took POST only and there was
  no `vercel.json`, so for months nothing retried (9V-TNL sat `pending` from
  June). A re-submitted registration that never enriched is also looked up
  again inline, at most hourly (`dueForRetry`)
- Enriched data is shared across all users via batch lookup API

**Form UX Pattern:**
- User enters registration (aircraft) or ICAO code (airport)
- Debounced search (500ms) checks: local DB → FR24
- If found: auto-populates all fields, hides manual input fields (transparent to user)
- If not found: reveals manual input fields for user entry
- Duplicate detection prevents re-adding existing records

**Key Functions:**
- `addCustomAircraftToDatabase(record)` — writes to unified IndexedDB table
- `getAircraftByRegistrationFromDB(reg)` — O(1) lookup via registration map
- `batchGetAircraftByRegistrations(regs)` — bulk lookup for CSV imports
- `submitAircraftToServer()` / `submitAirportToServer()` — fire-and-forget enrichment
- `searchAircraftTypes(query, limit)` — ICAO DOC 8643 type code search
- `normalizeRegistration(reg)` (`lib/utils/string.ts`) — the **single canonical**
  registration key: uppercases and strips **all** non-alphanumeric characters.
  Used identically on the client (local matching) and server (the
  `registrationNormalized` dedup key). Do not reintroduce per-file copies.
- `recalculateFlightFields()` — respects `manualOverrides`, won't overwrite user's manual entries

### Report Import Pipeline (schedule + crew logbook)

The company issues two PDF/CSV reports — a **Personal Crew Schedule Report**
and a **Crew Logbook Report** — and both land through one entry point
(`components/import/unified-import-button.tsx`). Uploading both together
cross-hydrates them into one plan.

```
extractDocuments → parseScheduleCSV / parseLogbookV2 → crossHydrate
  → reconcileRoster (classify)  → review modal (consent) → executeRosterImport
```

**Matching is decided globally, never row-by-row**
(`lib/utils/roster/match-assign.ts`). Every plausible (sector, flight) pair is
scored `tier × 10000 + |Δout| + |Δin|` and claimed cheapest-first. The tier
keeps the precedence flight number → full route → arrival+reg → departure+reg;
the time distance compares actual-vs-actual AND scheduled-vs-scheduled and
takes whichever agrees better, so an unflown leg still pairs on its schedule.

**A flight number matches on its digits, leading zeros dropped, unless two
IATA designators disagree** (`sameFlightNumber`): `TR0288` is `TR288`, and a
logged `SQ288` (positioned on another carrier) is not the report's `TR288`
however well the day lines up. An ICAO callsign or a bare number names no
carrier and is let through (`flight-number-match.test.ts`).

> Do **not** go back to "first unclaimed flight on this route". The crew
> logbook report has **no flight-number column**, so on a day that repeats a
> route (SIN→PEN→SIN→PEN→SIN) the answer then depends purely on the order the
> two lists happen to be in — every leg paired with the wrong one and the
> import proposed swapping all their times. `repeat-route-day.test.ts` pins the
> real 12-Jul case, both list orders, and the scheduled-only variant.

**Who owns which field** (`lib/utils/roster/classification.ts`):

| | Fields | Behaviour |
|---|---|---|
| SAFE — company owns | OOOI (`outTime`/`offTime`/`onTime`/`inTime`), `scheduledOut`/`In`, `blockTime`, `flightTime`, crew names/ids, flight number, ICAO, timezones | applied without asking; the company's recorded times ARE the record of when the aircraft moved |
| CRITICAL — the pilot's account | `pilotFlying`, `pilotRole`, day/night takeoffs + landings, IATA, reg, type, role times | consulted, and the difference is kept on the record |
| `TRACKED_FIELDS` | `pilotFlying`, `pilotRole`, day/night TO/LDG | written as a `Discrepancy` whichever way the user decided — a licence submission is checked against these |

`detectEditReasons` runs **before** classification, so anything the user
authored (signature, remarks, manual overrides, edited-after-sync) routes to
`edited_conflict` regardless of which bucket the field is in.

**Decision memory** (`lib/utils/roster/import-decisions.ts`). `FlightLog.importDecisions`
records both directions per field — `declined` (a report value turned down) and
`replaced` (a user value an accepted change overwrote) — with a **90-day**
retention window (`IMPORT_DECISION_RETENTION_MS`), pruned on every write. The
reconciler filters a diff whose `field`+`to` matches a live `declined`, so
re-uploading the same report stops re-asking; a *different* proposed value
still surfaces. When a flight's only remaining differences are already-answered
ones the reconciler emits `skip_decided` carrying `RevertOption[]`, which the
review modal shows under "Earlier decisions".

**Report tracking** (`lib/utils/roster/report-tracking.ts`). Per-source
watermarks — `scheduleReportAt` / `logbookReportAt` — gate an older report from
regressing newer data. A cross-hydrated import contributes two streams and is
only skipped when BOTH are stale.

**Simulator sessions** (`lib/utils/roster/sim-sessions.ts`). Sim rows are
excluded from `sectors` and applied separately. Recognition is **structural**
(no route, no registration — what every version has always written) rather than
by `simSessionCode`, and matching accepts the code OR the start time, ±1 day for
the UTC-vs-local-base shift. Rows a previous build duplicated are collapsed on
the next import (earliest kept, rest deleted, counted in the summary).

> The old `date|simSessionCode` key only recognised sims written by a build that
> stored both fields, so a sim logged by an earlier build was invisible to the
> check and duplicated on **every** upload.

**Op kinds** (`ReconcilerOperation`): `create`, `skip_identical`,
`skip_decided`, `skip_stale_report`, `skip_non_airline`, `update_safe`,
`update_consult`, `update_conflict` (legacy), `edited_conflict`,
`delete_missing`. `plan-summary.ts` owns the default-acceptance set and the
summary counts — one definition, not a switch per call site.

### LogTen Pro Migration (`lib/utils/parsers/logten/`)

A pilot arriving from LogTen Pro brings up to three tab-separated exports —
**Flights**, **Aircraft**, **Address Book** — and they are cross-dependent, so
they are parsed in that dependency order and the earlier results feed the
later:

```
Address Book ─▶ crew, which the flight rows' PIC/SIC columns resolve against
Aircraft ────▶ the fleet, which supplies a type for a flight row that has none
Flights ─────▶ the logbook
```

Any subset works. `parseLogtenExport` plans, `executeLogtenImport` writes, and
`UnifiedImportButton` routes to them off `detectReportType` — one import
button, because a second one in that header grows the action group into the
centred nav pill.

**It does NOT go through `reconcileRoster`.** That reconciler is for the
recurring eCrew import: it forces flight numbers into the `TR…` house style,
files anything else as `skip_non_airline`, and arbitrates field ownership
between a pilot and their company. A migration is the opposite situation — a
one-time bulk load of a logbook the pilot already owns outright, possibly
across several carriers — so the only question per row is "do I already have
this flight?" and the ops are `create` / `skip_duplicate` / `update_fill`.
`update_fill` only ever writes fields the existing record leaves **blank**.

**Everything is addressed by NAME, never by column index** (`header-map.ts`).
The Flights tab is ~280 columns and the set depends on which fields the user
enabled, LogTen ships two naming styles (`flight_totalTime` in the Flights tab,
`Aircraft ID` elsewhere), and the header itself is dirty — several columns
arrive with a leading space. Every name reduces to a key (lowercase,
alphanumerics only) and a field is looked up through aliases in both styles.
Duplicate labels are real: the Aircraft export has **two** "Notes" columns, so
the second keeps the bare key suffixed (`notes#2`) rather than being lost.

**The clock-time zone is DETECTED, not assumed** (`time-reference.ts`). LogTen
writes no marker — it exports whatever the app was set to display — and reading
local times as UTC files a whole logbook hours out, with night time, day/night
landings and FDP all computed off the wrong instants. The file already holds
the evidence: it records the out/in times AND the block time it derived from
them, and on a sector between two DIFFERENT timezones only one reading
reproduces that block time. The whole file votes. A single-timezone operation
gives it nothing, so the verdict comes back `assumed` and the review dialog
puts a UTC/Local switch in front of the pilot before anything is written — the
sample export is entirely inside UTC+8 and lands exactly there. Converting also
moves the **date** when the out time wraps (03:40 at UTC+8 is 19:40 the
previous day), and the app keys a flight on the UTC date of its out time.

**The pilot's own figures are pinned, not recomputed.** Everything LogTen
populated — night, the role times, day/night takeoffs and landings — is written
with a matching `manualOverrides` flag, so `recalculateFlightFields` fills in
only what the file left blank. The file IS their existing legal record;
recomputing night time from sun position would quietly restate totals they have
already certified. (`preserveSourceValues`, on by default.) The day/night
TO/LDG override is set only for a NON-ZERO count — a blank is LogTen not
recording the split, where the sun calculation is a better answer than a hard
zero.

The OOOI mapping is one-to-one, because LogTen keeps the four times in four
columns the way the app does:

| LogTen | app |
|---|---|
| `flight_actualDepartureTime` | `outTime` |
| `flight_takeoffTime` | `offTime` |
| `flight_landingTime` | `onTime` |
| `flight_actualArrivalTime` | `inTime` |
| `flight_totalTime` | `blockTime` (out→in) |
| `flight_duration` | `flightTime` (off→on) |
| `flight_pic`/`sic`/`p1us`/`dualReceived`/`dualGiven` | the role times, and `pilotRole` |
| `flight_selectedApproach1-10` | `approaches[]` — `"1;ILS;20R;WSSS"`, count first |

The seat comes from the role TIME column, not a capacity flag: LogTen fills
exactly one per flight and it is the column a licence authority reads. A
**simulator is recognised structurally** (no registration, no route), the same
rule the rest of the app uses — LogTen's `flight_type` is an unlabelled enum
index and `flight_simulator` is *blank* on the sim row of a real export, so
neither is safe to key on. Its duration goes to `simulatedInstrumentTime` with
`blockTime` left at 00:00, and the executor skips the recalculation pass for
sims outright, or the recomputed block would put the session into flight-hour
totals.

Two smaller rules that came straight off the real files: LogTen keeps
placeholder aircraft whose registration is literally **"New"** (skipped, and
reported rather than silently dropped), and it zero-pads numeric crew ids
(`00009766`), which would never match the unpadded form the eCrew reports
carry.

**No row can take down the import.** `values.ts` never throws — a corrupt cell
degrades to a blank and the row-level parser decides whether that blank is
fatal — and the plan carries `skipped` / `warnings` / `errors` separately, so a
file with a few bad lines still imports the rest. Only a file-level failure (no
header, no rows, no pilot profile) is fatal.

**The aircraft loop closes from either end.** Both files' registrations go
through the SHARED enrichment chain (local reference DB → server batch → FR24)
in one call, before either file is parsed — the same chain the schedule and
crew-logbook imports use. Which file arrives first does not matter:

| | what happens | what closes it |
|---|---|---|
| **Flights first** | the chain types each tail; anything it can't answer for is listed in `untypedRegistrations` and its flights import UNTYPED | importing the Aircraft export **back-tags** them (`backTagFlights` — only flights with a blank type) |
| **Aircraft first** | the chain types the fleet; an unresolvable tail is taken wholesale from the file AND seeded into the **reference** DB (`seedReferenceDatabase`) | a later flight import now resolves it LOCALLY, first step of the chain |

**A RESOLVED lookup outranks the file, on both the type and the registration's
spelling.** If the chain answers for 9V-SKU it knows that tail is an A388, and
a LogTen table pairing it with an A21N is stale data worth correcting. The file
supplies whatever the chain could not answer for. The one case this reads wrong
is a registration RE-ISSUED to a different type during a career — the lookup
describes the airframe flying under that mark today, not the one logged in 2011
— and `preferFileType` is the escape hatch for it. The canonical SPELLING
follows the lookup either way: that is punctuation, not a claim about the
aeroplane.

That spelling matters as much as the code. A LogTen user writes a tail however
they like — `9VSKU`, `9vnca`, `9V NCA` — and a flight card reading "9VSKU,
A21N" beside an aircraft list reading "9V-SKU, A388" is two different
aeroplanes as far as anyone can tell.

**`batchGetAircraftByRegistrations` resolves a dashless input to a DASHED
stored key**, which is what makes any of that work. A `bulkGet` matches the
primary key exactly; trying the input plus a dashless copy of it covers "input
has a dash, stored has none" and NOT the reverse — and the reverse is the
common case for a migrated logbook. Misses now fall back to one pass over the
table's PRIMARY KEYS (Dexie walks those off the index without deserialising a
record), matched on `normalizeRegistration`. `matchRegistrationKeys` is the
pure half, so the rule is tested without IndexedDB.

**A soft-deleted reference aircraft must not answer a lookup — or a search.**
`searchAircraftFromDB` walked every row and showed a binned aircraft in the
aircraft page's search, where tapping it opened nothing (the list it is
selected from leaves it out). Neither the
single nor the batch lookup filtered `deletedAt`, so a deleted aircraft read as
a live local hit: it stayed invisible in the list AND the enrichment chain
never asked the network for it again, which made it impossible to re-import.

LogTen's per-airframe detail (serial number, operator, owner, year, notes) has
nowhere to go in the app's `Aircraft`, so the type carries five OPTIONAL,
non-indexed fields for it — no Dexie migration, and nothing is populated unless
a source supplies it. `normalizeAircraftFromServer` had to stop being an
explicit allowlist for them to survive a round trip (the same trap
`normalizeFlightFromServer` was rebuilt to avoid).

### The Pilot's Seat (`lib/utils/roster/pilot-role.ts`)

What a pilot logs follows from ONE fact about them — are they a captain — and
it is a USER SETTING: **Settings › Logging** (synced, so every device logs the
same way). The "This is me" crew card is where it lived before; each value the
settings leave unset (null) still falls back to the card
(`withLoggingPreferences`), and the card's own Logging section is now a link
to Settings. Everything that decides a role reads the card THROUGH the settings
— `getLoggingProfile()` for the stores, `withLoggingPreferences(card,
preferences.logging)` in the flight form:

| seat | monitoring | flying |
|---|---|---|
| captain | PIC | PIC |
| first officer | SIC | SIC, or PICUS (**When pilot flying, log as**) — never PICUS unless the pilot chose it |

A captain is PIC whoever has the controls; a first officer is never PIC.
PICUS is co-pilot duties performed as PIC under the PIC's supervision, and is
creditable only where the authority accepts the operator's supervision method
(EASA states also want each entry countersigned) — so it is the pilot's own
convention, never the default.

- New flights (`useCreateFlight`) start in the seat's role with the pilot
  written into that crew seat as "Self". With no seat on the card, the most
  recent real flight's role is the fallback.
- The flight form's **Pilot Flying** switch carries the role with it
  (`reconcilePilotRole`): PICUS falls back to SIC when monitoring, a plain SIC
  is promoted to the card's convention when flying, PIC never moves.
- Imports read the same card (`nonPicPfRoleOf`, `seatOf`). The old Settings ›
  Import Defaults section is gone; its stored value is only a fallback for a
  card that never set its own.
- The seat is stored as `defaultPIC`/`defaultSIC` on the SELF card only — on
  anyone else's card those toggles never did anything and are no longer shown.
  `seatOf` falls back to the card's `roles` for profiles created by an import.
- **The convention is DATED** (`pfRoleFrom`, **PICUS from** on the card). PICUS
  is creditable only from the pilot's check-out, so a leg flown before it is
  SIC whatever the card says today. Every caller resolves the convention FOR
  THE FLIGHT'S DATE (`nonPicPfRoleOf(card, fallback, date)` / `pfRoleOn`) —
  new flights, the PF switch, both imports.
- **A schedule report carries no PF/PM, and its sectors are created PF** —
  so the role follows the convention for the leg's date
  (`importedSectorRole`), never the seat alone. It took the seat alone, and
  every rostered leg of a first officer who logs PICUS came in "PF, P2". A
  re-import offers to put such a flight right, judging the role against the
  PF the flight already holds (the report has none to offer).
- **An import keeps PF and role a PAIR.** Audited against the owner's eCrew
  report, 13 flights carried a role that contradicted their own PF/PM: a PF/PM
  change turned down at one import was remembered and withheld at the next,
  but the role change that came WITH it was not, so it went through alone and
  left a PM leg logged PICUS. The reconciler now withholds the role half with
  the PF half, judges the role against the PF the flight KEEPS, and offers
  `settledRole`'s correction on a flight whose PF already agrees with the
  report (PM + PICUS, a flown SIC leg for a pilot who logs PICUS, PICUS before
  the check-out). A one-off PICUS by a pilot whose convention is SIC is theirs.

### Logbook Rules — what the hours are called (`lib/utils/logbook-rules.ts`)

The same hour is named differently by each authority — FAA "Dual given" is
CAAS "Instructor", FAA "SIC" is CAAS "P2" — so the pilot picks the rules they
log under (**Settings › Logging › Logbook rules**; synced, default CAAS) and
every screen that names a category reads ONE table, `TIME_CATEGORIES`:

| Column | What it holds |
|---|---|
| `field` | the STORED time field — changing the rules never changes a logged figure, only its name |
| `names` | per authority: the column `label`, the role `designation` where it differs (CAAS P/UT → the Dual column), a `note` that always shows (CAAS PIC U/S "Counts in P1 once the PIC certifies it"), and the `full` name. The flight form's TIME rows show the label and the `note` ONLY — the other authorities' names and the `full` definition put a second line under all thirteen rows, and the one rule that matters read as more of the same |
| `autoFill` | the Settings › Auto-fill switch that fills it — the switch list and the dashboard's totals map are both derived from the table |
| `recognisedBy` | the authorities whose logbook keeps it; the flight form offers any other only once it holds time (`showsCategory`), so nothing logged is ever hidden |

**CAAS is transcribed from SASP Part 1 Appendix B** (Issue 9, Amendment 8):
Case A PIC → the **P1** column; B co-pilot doing PIC duties under supervision
→ **PIC U/S**, entered in P1 subject to the PIC's certification; C co-pilot →
**P2**; G pilot under instruction → **P/UT**, in the **Dual** column; L a
student as sole occupant → P1 (so solo also counts in P1). "Instructor" and
"Multi-crew" are not in Appendix B and are unconfirmed. Appendix B's **SNY**
(Case F(iii) — other flying duties, e.g. a relief pilot out of the seat; not
counted toward licence experience) has no field yet.

**EASA is TODO** (`available: false`): its names are in the table but it is not
offered in Settings and never named in a helper until AMC1 FCL.050 has been
read from the source. FAA is from 14 CFR 61.51 search excerpts.

Readers: the flight form's TIME rows and role picker, Settings › Auto-fill,
the dashboard breakdown, the import review card. A category is added in the
table and nowhere else.

**Crew complement** (`lib/utils/crew-complement.ts`) — `minimumPilots(type)`
reads the ICAO designator the flight already carries: 2 for the transport and
large business types (a LIST, because wake category and engine type both have
exceptions — the CJ4 is single-pilot, the Dash 8 needs two), `null` = unknown,
and then the record's own crew decides. Two things turn on it:

| | Rule (`flight-evidence.ts`) |
|---|---|
| **Multi-pilot time** (`multiPilotTime`, schema 4) | `isMultiPilotFlight`: a two-pilot TYPE (every airline sector, even imported without its co-pilot), a co-pilot role, both seats named, or a relief pilot aboard. A flight stored before the field takes it by the same rule on server and client (`inferMultiPilotTime`; `SYNC_PROTOCOL` 3 re-pulls once) |
| **Solo** (`soloTime`, schema 5) | auto-fill is OPT-IN (`isSoloFlight`: PIC, not multi-pilot, nobody else recorded — a record cannot see passengers). Solo on a two-pilot type, or with another pilot aboard, is FLAGGED in the form (`soloConflict`), never silently zeroed, and the form offers no USE button for it on such a type |

**Simulator time is an EVENT, not a field.** A simulator entry keeps its
session length in `simulatedInstrumentTime`, the field a FLIGHT uses for hood
time; the entry type tells the two apart, so an export can separate training-
device hours from simulated-instrument flight time without a second field. The
form shows a simulator's TIME as one "Session" row.

**Night is not split by role.** A night-PIC (or night-anything) figure, where
an export needs one, is the role time × night ÷ block for that flight. It is a
derivation, not a field a pilot has to log.

**"USE x:xx" is not a lock** (`categoryState`, `lib/utils/flight-calculations.ts`).
An hour category is in one of three states, read off the record itself:

| | Stored as | Recalculation |
|---|---|---|
| `auto` | no override | its Auto-fill rule |
| `block` | override + a figure EQUAL to the block — what USE writes | follows the block when OUT/IN move |
| `pinned` | override + any other figure (typed into the row's duration picker) | left alone; a pinned ROLE time freezes the whole split |

No extra field: equality is what makes a reopened flight still read as "USE".
Every writer carries `block` categories along — the form's apply effect,
`recalculateFlightFields`, and `updateFlight` itself (`blockFollowersPatch`),
because an eCrew import rewrites the block as a company-owned field and a
category left at the old figure would then read as a pin. Only a `pinned`
category makes an import treat the flight as hand-edited (`detectEditReasons`).
A lock icon on the row marks `pinned`; nothing marks `block`.

The breakdown shows every category that HOLDS time (a hand-logged IFR hour
used to vanish when its Auto-fill switch was off). The role picker no longer
offers "Examiner": it was never a role a flight can hold.

**More than two crew.** `additionalCrew` (any number) is shown in the SEAT
rows' own structure (`AdditionalCrewRow`): the ROLE is the label on the left
and opens the role menu, the NAME is the value on the right (person icon,
chevron) and opens the crew picker for THAT row, and a swipe clears it. Both
halves are editable on a filled row as on an empty one. "Add Crew" adds the
row first; the role travels with the pick (`additionalCrewField(role, at?)` —
`additionalCrew:<role>` appends, `additionalCrew:<role>:<index>` replaces that
row). The empty row is the form's own state — `crewSlot` remembers the crew
count it was opened at, so it is DERIVED away when the pick lands, and an
abandoned row writes nothing. Rows are addressed by INDEX, not crew-card id:
an imported member may carry no id, and such a row could be neither re-roled
nor removed. Never the same person twice (`withAdditionalCrew`), a role per member; "Relief Pilot" is the augmented-crew role and
makes a flight multi-pilot by itself. `assignCrewToFlight` is the one way a
picker puts a crew card on a flight — choosing an existing card, or creating
one in the picker (which used to save the card and assign nobody). An eCrew
schedule import seats the COMMANDER ("CPT - PIC - …", `commander`) as PIC and
this pilot in their own seat, and lists every other CPT/FO as a relief pilot
on a CREATED flight (`deriveSectorCrew`). Taking the first CPT and FO blindly
dropped a second-listed first officer from their own flight. A re-import does
not add relief pilots to an EXISTING flight yet: the review modal's diff is a
string, and a list needs its own presentation.

### Entry Type (flight, simulator, positioning)

`FlightLog.entryType: "flight" | "simulator" | "positioning"` — a union rather
than another boolean per kind. Only a `flight` carries flight time
(`isOperatedFlight`).

**Positioning** (deadheading) is DUTY but no flight time. Its OUT/IN stay — the
FDP pipeline reads them, so the duty window covers it — but `positioningPatch`
zeroes every hour, count and PF, and every recalculation returns that patch
(pins included: there is no figure to own on a flight you did not operate).
`createDutyPeriodFromFlightGroup` leaves it out of the sector count, the sector
lengths and the flight minutes (Fifth Schedule para 8: not an operating
sector); the dashboard does not count it as a flight; the card shows its
OUT→IN as "pos" with a ticket icon; the form hides the role, landings and
approaches; and a report re-import never proposes PF, role, landings or hours
for it (`NOT_FOR_POSITIONING`), which would otherwise file tracked
discrepancies against a flight the pilot was carried on. Neither eCrew report
marks a positioning sector in the files seen so far, so it is set by hand. Rows written before it
exists carry only the legacy `isSimulator` flag, so **read through
`getEntryType()`** (`lib/utils/entry-type.ts`) and **write through
`entryTypePatch()`**, which sets both — the dashboard aggregate and the FDP
pipeline still branch on `isSimulator`.

A simulator carries its duration in `simulatedInstrumentTime`, NOT `blockTime`
(which stays `00:00`), so it never reaches flight-hour totals;
`entryDuration()` is what a card should display. The flight form's **Type** row
sits above the date and moves the duration across when the type changes.

### The Dashboard — TWO pages, one toggle

The dashboard is two screens behind a segmented control in the header, because
it was being asked two questions that want opposite layouts:

| | Answers | Shape |
|---|---|---|
| **Legal** (default) | am I current, what must I do, where am I in my duty | ONE SCREEN, NO SCROLL |
| **Summary** | what have I flown and how does it add up | period-scoped, scrolls |

Serving both from one layout is what turns a dashboard into a spreadsheet. A
pilot about to report wants an instrument they can read in two seconds; a pilot
reviewing a month wants depth and is happy to scroll for it. They get different
containers: the legal page is laid out TO the available height
(`px-panel pt-chrome pb-chrome` on a full-height flex column), the summary page
is an ordinary `PageContainer`.

`useDashboardView` is a MODULE STORE read through `useSyncExternalStore` — the
same shape as `useDBReady`/`useIsDesktop` — persisted to `localStorage` and
hydrated inside `subscribe` (which React calls in an effect), so there is no
setState-in-effect and no first render with the wrong page.

**The period controls belong to the summary page only.** The calendar button and
the expanding period pills are meaningless on the legal page, and the action bar
is the one thing that can push a button under the centred nav pill — so they are
not rendered there at all.

#### The legal page is ONE CONTINUOUS SURFACE

Not a stack of cards. Six glass cards with their own borders, radii and 12px
margins spend roughly 120px of a phone's height on separation alone, which is
the difference between this fitting and not. Sections are hairline `divide-y`
rules inside one surface — what an EFB page does, and why it can be dense
without being noisy.

Measured, with zero page scroll and zero internal overflow: **390×844 phone,
360×780 phone, and a 1180 desktop.** The surface is `max-h-full`, NOT `h-full` —
stretching it makes the one `flex-1` section absorb every spare pixel, which
left ~200px of empty grid under the last requirement on a tall phone.

The timeline redesign that replaced the ring gauge is **strictly shorter** than
what was measured (duty band ~152px → ~146px; the annunciator lost 2px of
padding), so the fit holds by construction. Any change that ADDS a row to the
duty band has to be re-measured on a 360×780 phone before it lands.

Four bands, in the order a pilot asks. There was a fifth — a header strip
carrying the date, a live clock and the phase word — and it is gone: a pilot has
a watch, and the annunciator below already carries the state.

```
⚠ CAUTION                                               ← master annunciator
  Rest short by 3:00                                    ← what to DO (the imperative)
  Tightest T/O 90d · 8d left                            ← the governing constraint (or "Also …")
OFF DUTY                            Last WSSS-VVNB-WSSS ← the duty band's eyebrow
  ▬▬▬▬▬▬▬▬▬▬▬▬▬▮░░░░░░▓▓▓▓▓                            ← ONE picture, a scale in TIME
  09:26          9:24            21:50                    (▮ = report, ▓ = rest still owed)
  REST FROM 16 AUG  SHORT 3:00   REPORT 17 AUG
  Next duty · FDP 10:35 of 12:15
  ●━━━━●━━━━○   WSSS   VVNB   WSSS                      ← the chain: this duty, or the next
CURRENCY                                                ← days that EXPIRE, urgent first
  ┌ ⚠ 8d ──────────┐ ┌ ✓ 118d ────────┐                  a GRID: figure over caption,
  │ T/O + LDG 90D  │ │ MEDICAL        │                  tinted only when flagged
  │ ▓▓▓▓▓▓░░░░░░   │ │                │
  └────────────────┘ └────────────────┘
LIMITS                                                  ← hours that REFILL, paired
  Duty  14d [▓▓▓ 74 ░░] 90h   28d [▓▓ 121 ░░] 180h
```

#### The FDP maximum is NEVER hardcoded

This is the one number on that screen where a wrong answer could put someone
over a limit. Under CAAS Reg 14 (Fifth Schedule) the maximum daily FDP moves
with report time, sector count, crew complement, acclimatisation and the
long-sector adjustment — a fixed "13:00" is wrong for most duties.

`DutyPeriod` **already carries** `maxFdpMinutes` and the `fdpTableUsed` that
produced it, computed by `calculateMaxFDP` when the duty period was built.
`duty-status.ts` READS that number; it does not invent one, and the panel prints
the table beside it so the figure can be checked rather than trusted. A duty
carrying no computed maximum shows a dash and "No FDP limit computed" — a
default is a number somebody might fly to.

**There is deliberately no 7-day duty figure.** CAAS imposes 14-day and 28-day
duty caps (Reg 12) and 28-day/12-month flight caps (Reg 107). Printing a 7-day
limit the regulation does not contain is worse than printing none.

#### Adaptive: the panel changes with the duty phase

`deriveDutyStatus` classifies `off` / `on_duty` / `post_duty` from the duty
periods' absolute UTC windows (with the past-midnight wrap), and the duty band
answers a different question in each:

| Phase | Leads with |
|---|---|
| `on_duty` | elapsed, FDP remaining against this duty's max, the meter |
| `post_duty` (≤3h after debrief) | the duty just flown, and time to next report |
| `off` | not on duty, and time to next report |

When two windows contain the instant, the LATER-starting one wins (a merged
overnight and a sector inside it; the pilot is in the inner one).

#### A PART-FLOWN duty is still a duty — read the plan, not just the record

This is the subtlest thing on the page and it was wrong. `mergeDutyPeriods`
prefers the LOGBOOK for any date that is not in the future, which is right for
the rolling and cumulative calculations — flown hours are the truth. It is wrong
for "am I still on duty": mid-duty the logbook holds only the sectors already
flown, so a two-sector day with sector one in the book produced a duty that
"ended" on arrival, and the panel fell straight through to a rest countdown
while the pilot was in the cruise on sector two. A four-sector day did it three
times.

So `deriveDutyStatus` takes the PLAN alongside the merged duty periods, and
where a plan duty overlaps a logbook duty and runs LATER, the duty is still in
progress. There are TWO sources of a plan and a pilot may have either or both:

| Source | Where it comes from |
|---|---|
| `FDPResult.scheduleDutyPeriods` | a roster import (`scheduleEntries`) |
| `FDPResult.plannedDutyPeriods` | **the flight rows themselves** (`buildPlannedDuties`) |

The second one is the load-bearing case and it was missed first time round.
`computeFDPResult` filters to `isFlownFlight` before building duty periods — so
unflown placeholders cannot inflate the cumulative totals, which is right — but
that also means a sector sitting in the logbook as `scheduledOut`/`scheduledIn`
with no OOOI contributes NOTHING. On a two-sector day with sector one flown and
no roster imported, there was no plan anywhere: the panel read "Roster Clear"
and counted down rest between sectors. `buildPlannedDuties` rebuilds the day
from the flight rows with each sector falling back to its scheduled times, and
it is used for duty shape and FDP only, never for cumulative limits.

The effective duty then takes:

| From the PLAN | From the RECORD |
|---|---|
| debrief, `sectorCount`, `route` | `flightMinutes` (what has actually been flown) |
| `maxFdpMinutes`, `fdpTableUsed` | `flightIds` (which legs are on blocks) |

The maximum comes from the plan because **Reg 14 sets the FDP maximum by the
sectors PLANNED, not the sectors flown so far** — a one-sector logbook duty
carries a one-sector maximum, and flying to that number would be flying to the
wrong limit. The sector chain comes from the plan for the same reason: it is
what makes a four-sector day show four legs with one complete, instead of one
leg and a finished duty.

A plan duty with NO logbook counterpart at all is also picked up, which is
every duty's first hour — the pilot has reported and nothing has landed yet.

**The duties AHEAD join the pipeline from the flight rows**
(`upcomingPlannedDuties`): every planned duty none of whose sectors has flown
and whose report is still to come, marked `isFuture`. Rostered flights are
scheduled LOGBOOK rows (`scheduleEntries` holds non-flight duties only), and
the pipeline builds duties from flown flights, so nothing past today reached
it: the FDP page read "Next · None scheduled" over a week of rostered
sectors, and the forecast, the chart's projection and para 4's look-ahead saw
no duty ahead. Future duties never reach the cumulative limits (those read
`!isFuture`). A date an older import put a schedule FLIGHT duty on keeps that
one.

**A PART-flown duty takes its plan in the pipeline itself**
(`completePartFlownDuties`). It was left to the dashboard's own plan — so on
the FDP page, the Quick Check and para 5, the duty ended at the first arrival:
the owner's WSSS–WBKK–WSSS on 7 Nov 26, between the sectors, drew one leg,
started a rest at BKI with a one-sector FDP maximum (13:00 for 12:15), and with
the next duty a week away read "18h at base after 9 days away" — a para 5(5)
violation on a turnaround. The record's duty takes the plan's shape (report,
debrief, sectors, route, maximum, flight ids — the timeline draws the rest as
scheduled) and keeps the record's flight minutes.

**The pipeline is ONE pure function, `runFDPPipeline`**
(`lib/utils/roster/fdp-pipeline.ts`): flights + roster + `nowMs` in, the whole
`FDPResult` out. `useFDPData` only caches it. It lived inside the hook and the
scenario suites assembled their own copy, which is how the part-flown gap got
past them; `fdp-pipeline.test.ts` runs the real one on the owner's day.

#### The FDP ends at the last ON-BLOCKS, not at the debrief

A duty period runs to being free of all duties, so its window carries para
7(2)'s 30 minutes of post-flight checks. The FDP does not. Keying the panel off
the duty window left it reading "Sector 2 of 2 · 2:58 FDP left" for half an
hour after the aeroplane was parked and both sectors logged.

`fdpEndOf` closes the active window at the last arrival once EVERY sector of
the duty is on blocks. Until then the duty is still running however far past
its planned debrief it goes — an unlogged sector is not a finished one, which
is what keeps a delayed duty from falling out of the panel early. That was
written here long before the code did it: `fdpEndOf` returned the PLANNED end,
so a late last leg still airborne read "Duty complete · Rest until …". It now
runs to now, capped at report + the FDP maximum + the commander's 3 hours
(para 13) so a sector never logged cannot hold the duty open forever.

#### What the duty band says, and what it does not

The band is ONE INSTRUMENT reading a different scale per phase — eyebrow,
timeline, three captions, footnote, chain — not four layouts. `DutyBand` decides
the whole thing once into a `view` object; the JSX below it is flat.

| Phase | The question | The bar runs from … to | Caret |
|---|---|---|---|
| on duty | how much FDP is left | FDP window open → its Reg 14 maximum | — |
| off duty, duty ahead | will the rest reach the report | rest commenced → the later of legal / report | the REPORT |
| off duty, nothing ahead | when may I go again | rest commenced → legal | — |
| standby | how long am I committed for | window start → window end | — |

| | eyebrow (right) | the three captions | footnote | chain |
|---|---|---|---|---|
| on duty | `Table A · Max 12:15` | reported / flight / **FDP left** | — | THIS duty |
| off duty | `Last WSSS-VVNB` | rest from + date / **rest, min** / report + date | next duty's FDP of max | the NEXT duty |
| standby | activated or not | from / **left** / until | the rest clock, still running | the next duty |

**The second row is the one that needed a picture.** The off-duty question is a
COMPARISON between two instants on one axis — when the rest becomes legal and
when the next duty reports — and a ring has nowhere to put the second one. On a
line they are two marks, and a report landing inside the rest still owed is a
red band you see before reading a word. That is why the ring is gone.

**The gauges' hero number went with them.** `DutyGauge`/`RestGauge` printed the
rest countdown inside the ring while the annunciator printed it as the hero and
the lines printed "N to go" — three copies. The annunciator owns the one hero
line now, and it is `nextAction.headline`, which is the CONTEXTUAL form ("Rest
short by 3:00", "Rest until 04:36") rather than a bare countdown. Do not put a
raw countdown back in the annunciator.

Three readouts were removed earlier for the same reason and stay removed:

- **Elapsed** — a bare figure with no denominator, next to an FDP line that
  carries `of 12:15` and a bar drawing the same ratio.
- **"N to go"** beside "Legal from" — see above.
- **The last duty's LENGTH.** How long yesterday ran says nothing about whether
  today is legal. Its ROUTE is worth a glance (the eyebrow) and its END TIME is
  (the first caption); its duration is not.

**`RAMP.info` is not on the status ramp, deliberately.** A standby window
filling up is a magnitude, not a verdict — amber there would teach the reader
that the colour means the same thing as on a requirement cell, where it means
whether they can legally fly. `idle` is "there is no limit to draw".

**Next FDP** is what the next duty ASKS of you — its FLIGHT duty period, report
to last on-blocks, against its own Reg 14 maximum. Measured to the DEBRIEF it
would carry para 7(2)'s 30 minutes of post-flight checks and overstate the very
figure the maximum is compared against, so `DutyPeriod.fdpEndTime` records the
last on-blocks and `plannedFdpMinutes` is measured to it.

**Rest is worked BACKWARDS from the next duty.** "Legal from 04:36" on its own
says little: what a rest period has to be depends on the duty AHEAD as much as
the one behind — para 4 asks for 24 hours inclusive of a local night before a
duty that touches the window of circadian low, and 3(1)(c)/(d) scale it with the
duty just flown. So the comparison shown is the rest AVAILABLE before that duty
against what THAT duty needs. "Legal from" survives only for the case with no
next duty, where there is nothing to work backwards from.

**Every point in time goes through `formatInstant`** (`lib/utils/tz-format.ts`),
which joins the display settings that govern a clock: `useZuluTime`,
`timeFormat` and `clockSeparator`. The page cannot disagree with the rest of the
app about what time it is — **including the annunciator**, whose headlines name
clocks ("Rest until 04:36", "Report 21:50", "On standby to 18:00"). Those are
built in `pilot-status.ts`, which is PURE, so the formatter is **injected**:
`buildPilotStatus({ formatClock })`, wired by `usePilotStatus(recency, now,
display)`. It used to build its own `Intl.DateTimeFormat` in device-local
24-hour with a colon, so a Zulu-configured pilot read one convention in the hero
line and another two lines below it.

**Nothing is shown to the second.** The tick aligns to the minute boundary and
holds there — a 1Hz clock re-rendered the whole panel sixty times for every
change a reader could see, and seconds on a rest clock with hours to run are
motion for its own sake.

**A STANDBY gets the off-duty card, not its own.** It is a duty, so it must
never read as off duty — but the question it raises is the same one off duty
raises, "am I legal and for what", so it keeps the rest clock running beneath
it as the band's footnote. Its own window IS what the bar draws — the standby is
the thing in progress — but on `RAMP.info` rather than the status ramp, because
how full a standby window is says nothing about whether the pilot is legal.

#### Annunciator, governing constraint, next action

`pilot-status.ts` joins the standing requirements with the duty phase. Three
states on the ECAM vocabulary the reader already has — `CURRENT` / `CAUTION` /
`ACTION REQUIRED`, each with its own icon, never colour alone. An `unknown`
requirement is a caution, not a fourth colour. **An exceeded FDP outranks every
standing requirement** — it is the only thing on the page happening right now
rather than being true today. Outstanding REST also raises an otherwise-clear
pilot to CAUTION: rest lives in the duty state, so it is not one of the
requirements the verdict is drawn from and the annunciator has to fold it in.
Not while ON DUTY: the rest clock then counts the rest owed AFTER the duty in
progress, nothing to act on yet, and it used to lead the panel mid-duty ("Rest
until 20:05Z" over a duty with a sector still to fly).

The state also tints the surface (`TONE.glow`) — a soft wash bled into the top
of the panel, so it takes on the mood of its own state before a word is read.

- **The governing constraint, not a count.** "12 / 12 current" is noise: a pilot
  does not need telling about the eleven that are fine. When something is
  flagged this is the most pressing flagged requirement; when nothing is, it is
  **the nearest EXPIRY**. It must NOT fall back to the fullest rolling limit —
  that was the first version's rule and it reported "Flight 1y 604 / 1000h",
  41% used with roughly six months of headroom, as the tightest constraint on an
  otherwise clear pilot. A limit REFILLS; a currency EXPIRES. That is why only
  `currency` requirements carry `daysUntil`.
- **The second line never repeats the headline** (`PilotStatus.also`). When
  the headline IS the governing requirement's remedy ("3 takeoffs required"),
  "Tightest 90-Day Recency 0/3" under it and a cell reading 0/3 below was one
  fact three times — while a second problem (an expired document) showed only
  as a cell to be found. The line then reads "Also DG expired — renew · +1
  More", most pressing first; with one problem it names the requirement
  without its figure; "Tightest …" is for a headline about something else
  (rest, the duty, a clear pilot).
- **The next action states the REMEDY, not the reading** — "2 landings
  required", not "landings 1 / 3". Phrased in `legality.ts` where the shortfall
  is actually in hand (`Requirement.action`). Triage order: something wrong with
  the duty in progress → rest → the binding requirement → the next report →
  nothing required.

#### An EMPTY logbook is not a lapsed pilot

With nothing logged, 0 / 3 recency raised ACTION REQUIRED on the very first
screen a new user saw. Recency is not ASSESSED then (`logbookEmpty` in
`buildLegalityModel` leaves the cell out), and a clear verdict becomes the
NEUTRAL `getting_started` state — "NO FLIGHTS YET · Add your first flights" —
off the status ramp like an `unknown` cell, because nothing has passed either.
Anything that can be judged still is: an expired document on a fresh install
is ACTION REQUIRED. `logbookEmpty` is only true once the flight read has
LANDED, or a pilot with thousands would see it flash while it loads.

#### A FAILED read is not a clear one

The other half of that rule. When the FDP pipeline throws (`useFDPData`
returns `failed: true`) or the flight read errors, the panel used to see empty
duty periods and no flights and read **CURRENT** — the most dangerous wrong
answer on the page. `buildLegalityModel` takes `unavailable: ("duty" |
"logbook")[]` and adds an `unknown` requirement for each ("Duty limits
unavailable — check manually"), which the annunciator reads as CAUTION. A
logbook read that errored is also never `logbookEmpty`.

#### Nothing on this page navigates by default

A cell opens its detail in the DETAIL panel (`RequirementDetailPanel`, as
`req:<id>`) — the owner's main / detail rule — beside the page on a tablet and
as the overlay on a phone. Either way the dashboard stays where it was: no
route change, nothing to navigate back to. The deep link lives INSIDE the
panel, a deliberate second step rather than the accidental result of a tap.
The detail used to unfold under the currency grid, inside the one surface that
has to fit a phone's height.

#### CURRENCY and LIMITS are separate bands

They are two different kinds of thing and sorting them into one urgency-ordered
grid is what made the first version unreadable:

| Band | Question | Unit | Behaviour | Form |
|---|---|---|---|---|
| Currency | am I qualified and recent | DAYS | expires | a GRID of cells |
| Limits | how much have I used | HOURS | refills | a BAR per window |

They take the shape their content asks for. A currency is a name and a number
of days — one small fact, so a set of them reads as a grid at a glance. A limit
is a fraction of something, which is a bar. Forcing one form on both is what the
separation exists to avoid.

- **Recency is ONE requirement, not two.** Takeoffs and landings are two halves
  of one question, and as separate urgency-sorted cells they did not even end up
  beside each other. The cell answers with the binding half; expanding shows
  both counts and the lapse date.
- **A currency cell is a FIGURE over its CAPTION** — the duty band's `Scale`
  vocabulary, so the two bands read the same way instead of each inventing an
  arrangement. Two-up on a phone, three at 26rem, four at 44rem: this is the one
  `flexible` band, so every row it does not spend is headroom on a short phone
  (measured: ~92px against the old column of rows' ~104px, and far more legible).
- **Only a FLAGGED cell is tinted.** The ramp means met / close / not met, so
  tinting the met ones green too paints the whole band and leaves the one thing
  needing attention nothing to stand out against. The icon still carries the
  state — colour is never the only carrier.
- **Beside the page, the panel opens the cell that matters by itself.** On a
  tablet with nothing chosen, the legal page selects the most pressing
  currency cell (flagged first, else the nearest expiry) programmatically
  (`explicit: false`, as Settings does) — the panel said "Select a
  requirement" beside a page that already knew which one. A phone opens
  nothing by itself.
- **A requirement's "To Do" is a REMEDY or it is not shown**
  (`RequirementDetailPanel`): "SEP expires in 5d" under "Now 5d" over
  "Expires 15 Nov 26" was the figure three times. "DG expired — renew" and
  "2 landings required" stay.
- **ONE cell is open at a time, in the detail panel**, with a ring left on the
  cell it belongs to where the panel is beside it. The open requirement's ID is
  held (the selection), not the requirement, so the model rebuilding every
  minute refreshes the panel rather than closing it.
- **Limits are PAIRED by what they limit** — Duty over its 14d and 28d windows,
  then Flight over 28d and 1y. That is how the regulation is written and how a
  pilot holds it; four independent rows sorted by urgency scattered the pairs.
- **A limit with room in it is NEUTRAL** (`LIMIT_WITH_ROOM`). All four bars
  were status green, 3% used and 60% used alike — the met cells' rule broken
  one band down. A bar is grey until its state is caution (amber) or fail
  (red), and the icon arrives with the colour.
- **Rest is NOT a currency.** It is a property of the duty just flown, so it
  lives in the duty band (`DutyStatus.rest`). Among a column of expiry dates a
  live countdown read as a different kind of thing — because it is one.

#### The duty band and the sector chain

The band shows the timeline, its three captions, and a chain of stops
(`deriveSectorLegs`) — filled dot on blocks, ringed dot for the leg being
flown, hollow still to come, with the airport codes beneath.

**The chain shows THIS duty on duty, and the NEXT duty otherwise.** Off duty the
reader is looking ahead, and a route squeezed into a label is four small words
where a chain is a picture. The last duty stays a line above it: context, not
the question being asked. A duty is up to
four sectors across several airports, and "where am I in the pattern" is what a
generic recent-flights list could never answer: it showed history, not this
duty. That list is gone.

**The bar's tone is STATED by the caller, never derived from how full it is.** A
nearly full FDP bar is a warning; a nearly full REST bar is good news. Deriving
the colour from the fraction painted a fully-rested pilot amber.

**The rolling limits are NOT repeated in the duty band.** They were printed
there and again in the limits band — the duplication the rework removed.

#### The live clock and hydration

Everything the 1Hz tick drives — the header clock, the rest countdown, the duty
figures — is marked `suppressHydrationWarning`, **on every text-bearing node,
because the attribute does not inherit.** The offset name is the one that
actually bites: Node's ICU renders `GMT` where the browser renders `GMT+0` for
the same zone, so it mismatches in production even when the clock value agrees.
The tick is gated on `usePageActive` — the dashboard is keep-alive, so an
ungated interval re-renders this panel every second for the rest of the session
while the user is somewhere else.

`usePilotStatus` buckets `now` to the MINUTE before rebuilding the model: the
model changes state on minute boundaries, so rebuilding it 60 times a minute
computes an identical answer 59 times, while the seconds are read straight off
the clock by the component.

### The Summary Page

Three blocks, one column, in the order the questions get asked:

| | Block | Answers |
|---|---|---|
| 1 | `PeriodSummary` | what the selected period came to |
| 2 | `PeriodFlights` | which flights those were, and what each one was |
| 3 | `BreakdownPanel` | how the hours split by role and by fleet |

**ONE COLUMN AT EVERY WIDTH.** The blocks stack in that order on a 390px phone
and in the same order on a 1400px desktop: nothing moves, nothing is reordered.
What a wider screen buys is DENSITY INSIDE each block — the breakdown goes
stacked → side by side.

Every one of those steps is a **container query, never a viewport breakpoint**.
The page renders inside a resizable split panel, so the window's width says
nothing about the room a block actually has; a panel dragged to 360px is a phone
and lays out like one.

#### No repetition — what was removed and where it went

The old dashboard printed several things twice. Each now has exactly one home:

| | Was | Is |
|---|---|---|
| 90-day recency | a chip in the T/O card **and** the alerts bell | ONE requirement cell, legal page |
| FDP utilisation | the limits stack **and** the bell | the limits band only — the duty band's copy was removed |
| Rest until legal | a pill in the limits stack **and** the bell | the duty band's timeline; the annunciator states the imperative, not a second copy of the figure |
| Currency expiries | the bell only | document requirement cells |
| Night / Sim hours | the hero **and** again as rings in the auto-fill grid | the period summary only (`SHOWN_ELSEWHERE`) |
| Recent T/O–LDG events | its own list under the flight list | gone — it was the flight list |

The bell (`AlertsDropdown`) is therefore scoped to **import notes only** — the
one alert class neither page otherwise shows, and not a legality question.

#### Charts: only where there is something to plot

- The hero is a **figure, not a ring**. The ring it replaced was metered against
  a hardcoded 100-hour maximum, so 48 hours in a week and 48 hours in a year drew
  the same arc. A ratio needs a real denominator; period block hours have none.
  It uses **proportional figures** — `tabular-nums` gives every digit the width
  of a zero, which reads loose at display size. Tabular is for columns, and for
  the legal page's CLOCKS, which would otherwise shift sideways every tick.
- **Day/night IS drawn** — it partitions the block time, so it has a
  denominator. Two fills with a **2px surface gap** between them; no stroke is
  drawn around either, and the two keys beside it are the legend (identity is
  never colour alone).
- **The engine split is drawn only when there is a split** (`showEngineSplit`,
  ≥2 non-zero classes). An airline pilot flies one class, and a single-series
  "part-to-whole" bar is a full-width fill at 100% under a one-item legend,
  restating the hero figure.
- **The status ramp is RESERVED.** Requirement cells use green/amber/red because
  the colour means met/close/not-met. Role and type meters are magnitudes —
  forty hours of SIC is neither good nor bad — so they use ONE hue
  (`MagnitudeRow`, primary on a lighter step of itself). Painting them with the
  status ramp would teach the reader that the colour means the same thing there
  as on the legal page, where it means whether they can legally fly.

#### A flight row opens the flight in the detail panel

The list exists because the pilot is reading the period as a whole, so a row
never NAVIGATES — it opens the flight (`FlightForm`) in the detail panel, the
way a flight opens anywhere else, with the period still in place beside it or
under the overlay. It used to unfold eight fields under itself; the panel has
the whole record. The dashboard page owns that half of the panel and the
clearing; the legal page writes its own `req:` selections.

`periodFlights` is ordered by **`sortFlights`**, the one comparator — sorting on
the date alone left same-day sectors in table order, so they could read in a
different order here than in the logbook. `SortableFlight`'s `scheduledOut` is
optional so a projection of a flown flight can use it.

### Smoothness — the Oct 2026 performance pass

Measured with Playwright + CDP on a 390×844 touch viewport at a **4× CPU
throttle** with **1200 flights**: rAF frame gaps, long tasks and event timing
(INP) per interaction, CPU profiles mapped through source maps
(`PROFILE_BUILD=1 pnpm build` ships them), and a React commit hook to see which
commits land inside an event.

| | Before | After |
|---|---|---|
| idle on the logbook | 29 frames in 3s, every frame ~106ms | 60fps |
| fling the logbook (4 flings) | 52/52 frames over 50ms | 1 |
| swipe a card open | every frame over 50ms | 0 |
| cold load → first card | 3.8s | 2.8s |
| open a flight (tap → paint) | INP 1568ms | 96ms |
| Dashboard, first open | the page froze ~38s | ~0.5s longest task |
| Summary ⇄ Legal toggle | 2.0–2.4s task, INP ~2.9s | ~140ms task |
| calendar open / close | INP 790 / 580ms | ~350 / 310ms |
| tab switches | INP 750–830ms | 130–250ms |

What it took, in order of size:

- **The glass's specular drift is gone.** A registered `@property` animated on
  every `.GlassContainer` restyled each glass surface's whole subtree every
  frame, forever — and it never moved the glint (`--glass-rim` resolves its
  `var()` on `:root`). The rim is now static at the angle it always showed.
- **Whole-timeline calculations are single passes**: the FDP timeline's
  rolling windows (`generateTimelineData`), the dashboard's plan/record overlap
  (`indexWindows`), acclimatisation (`acclimatisedOffsetsAtEachDuty`). Each is
  pinned to the old per-item definition by a randomized equivalence test.
- **No day-by-day FDP timeline is built at all** — the FDP page's timeline reads the rolling limits at an instant over what it draws (`rolling-at.ts`).
- **`SwipeableCard` rows arm on first contact** — no drag feature, no action
  panel, no `dragControls` until a pointer or focus reaches the row.
- **Opening a detail renders as a transition**, with the `?selected=` history
  write moved one task out of the tap (`writeUrlAfterTap`).
- **No forced layouts in commits or mount effects** (keep-alive stack, scroll
  indicator, remarks textarea, glass ripple), and nav links pass
  `scroll: false`.
- **Formatters are hoisted** out of per-cell and per-row loops.

A second round measured the interactions the first one had not:

| | Before | After |
|---|---|---|
| sidebar open / close (first of a session) | 637 / 698ms of long tasks, 12 janky frames | 230 / 240ms |
| add a flight (new install) | 829ms of long tasks, a 643ms frame | ~480ms, ~200–300ms frame |
| airports page load / fling during the seed | 874ms / 16 janky frames | 447ms / 1 |
| Dashboard first open | 1503ms of long tasks | ~730ms |
| Roster first visit | 923ms | ~450–700ms |

- **The sidebar no longer prefetches as it opens.** Its links pass
  `prefetch={false}`; every nav route is warmed once at idle instead
  (`prefetchNavRoutesWhenIdle`, one route per idle period, 4s after boot).
  Opening the sidebar used to fire ~40 requests and evaluate every section's
  page chunk during the 300ms morph.
- **The flight form looks up its two airports by key** (`useAirportByIcao`)
  instead of loading all ~29k rows (`useAirportDatabase`) on the first open of
  every cold start. `primeFlightCache` starts the lookups on the tap.
- **The airport seed runs in a worker** (`airport-seed.worker.ts`): fetch,
  the 5.7MB `JSON.parse`, the mapping and every chunked write. The page only
  hears progress and the end. `writeAirportRows` is the one implementation both
  sides call; with no worker it runs on the page as before.
- **`hhmmToMinutes` reads `H:MM` off the character codes** — it runs inside
  every flight sort and duty loop, and `split` allocated per call.
- **No Radix Accordion/Collapsible for content that mounts OPEN** — it measures
  with `getBoundingClientRect` in a layout effect. The signature section is a
  plain disclosure (a grid-rows transition, nothing to measure).

A third round counted COMMITS per navigation (a commit hook that only descends
into subtrees whose children changed — a bailed-out fiber keeps the flags of
the last commit that rendered it, so counting flags alone over-reports), which
found the work that RECURS rather than the work that is merely large:

| | Before | After |
|---|---|---|
| FDP page, first 3s | ~120 commits, one per frame, 430–520 components each | ~37, none per frame |
| a sidebar tap that lands on a page mid-move | 312ms forced style recalc in the blob's effect | none |
| Dashboard first open (same machine, A/B) | 1734ms of long tasks | 1141ms |
| Airports first open (A/B) | 2306ms | 1795ms |
| a hidden airports page during a new install's seed | a re-render per 250-row chunk | none |

- **Recharts did not animate** the FDP chart's series (`isAnimationActive={false}`):
  its animation is a JS rAF loop committing through React every frame, on
  mount and on every zoom or pan step. (The chart has since been replaced by
  the hand-drawn timeline and the dependency removed, Nov 2026.)
- **The gravity blob never reads style back** — an interrupted move's position
  is computed from its own samples and the animation's `currentTime`.
- **The legal page reads recency with `ninetyDayRecency`**, not the period
  aggregate, which built a totals breakdown and a detail row per flight ever
  logged to supply that one figure. `usePilotStatus` memoises the duty and
  legality halves SEPARATELY, so currencies landing do not rebuild the duty model.
- **A calibrated row height is remembered per list** (`useCalibratedRowHeight`'s
  key, localStorage), so a visit after the first needs no re-measure — on the
  airports list that is a pass over ~29k rows.

A fourth round traced STYLE work (Chrome's invalidation tracking says WHY each
element was restyled) and the forced layouts hidden in libraries:

| | Before | After |
|---|---|---|
| a tap on a nav tab | ~170-element restyle ×2 (45–60ms each at 4×), INP 160–200ms | none, INP 56–88ms |
| a kept-alive tab switch | ~1,400-element restyle (155–171ms) | only the arriving page's |
| opening the sidebar | 239–408ms of long tasks | 118–188ms |
| opening a flight | 1533ms busy (210ms of it framer's `measureScroll`) | 1090ms |
| a key in the flight form | ~140ms per key, a forced layout per key | INP 56–104ms |

- **Glass writes its press properties on the SPOTLIGHT, not the root**
  (`.GlassSpotlight`, `glassSpotlight()`). Custom properties inherit: written on
  the root, each tap and each frame of a finger moving over the glass restyled
  the whole nav.
- **Kept-alive pages are `content-visibility: hidden` when hidden**, as well as
  `visibility: hidden`. `visibility` is inherited, so flipping it restyled both
  pages' entire subtrees; a skipped subtree is not restyled at all, and its
  scroll offsets are kept (measured: the logbook returns at the same
  `scrollTop` with the same rows).
- **No `transition-all` anywhere.** It includes `visibility`, so every element
  carrying it inside a kept-alive page started a transition — and was
  restyled every frame — on each tab switch; it also makes every style change
  check every animatable property, Tailwind's ~87 registered ones included.
- **A swipe row arms on a sideways move**, not on pointerdown or on focus, and
  disarms once settled shut (`SwipeableCard`). Armed, it carries framer's drag
  feature and the projection node that comes with it, whose every render reads
  the document's scroll.
- **Virtualisers size themselves from a ResizeObserver**
  (`observeRectAfterLayout`, `viewportRect`): TanStack's default reads
  `offsetWidth`/`offsetHeight` in the layout phase of the commit that mounts the
  list.
- **The flight form's text fields answer the key** (`useDraftText`,
  `DraftInput`, `RemarksField`): a local draft, committed to the form in a
  transition. Remarks grow by a CSS mirror, not a `scrollHeight` read.

Still open, measured: opening a flight still runs ~400ms of long tasks at 4×,
but in yielding slices after the tap has painted. The rest is the form's ~300
fibers mounting, mostly framer `motion` and Radix. The first Dashboard visit
runs the FDP pipeline (~250ms of that 4× figure is `createDutyPeriodsFromFlights`
and the pilot-status model). Back-from-flight is a `popstate`, which React
renders synchronously by design.

### Ambient: the app is already where the pilot is (Nov 2026)

Three places where the app knew the answer and still made the pilot find it:

- **The logbook OPENS AT NOW** (`logbookNowIndex`, `lib/utils/logbook-now.ts`).
  The list is newest first, so every rostered flight sits ABOVE the last one
  flown: with a month ahead it opened on a flight three weeks away and the one
  being logged today was thirty rows down. On its first rows of a mount it
  scrolls so the NEXT flight to fly (the earliest unflown one dated today or
  later; a leg with OUT and no IN counts) is at the top, what was just flown
  beneath it, the rest of the roster a scroll up. Once per mount, never over
  a selection (`revealFlight` owns that), index 0 — as before — when nothing
  is ahead. It waits for the calibrated row height, so the offset is exact.
- **The flight form points at the next time to stamp** (`nextStamp`). On a
  flight dated within a day of today, the first of OUT / OFF / ON / IN still
  blank carries the PRIMARY NOW; the others stay outline. Four identical NOW
  buttons were four things to choose between at the moment the pilot has the
  least attention to spare. Its accessible name says so ("Out now, next").
- **The tablet's dashboard panel opens the cell that matters** (see
  "CURRENCY and LIMITS").
- **A past sector with no times is a GAP, and every page says so**
  (`isUnloggedPast`, `lib/utils/logbook-now.ts`). A flight whose UTC ARRIVAL
  day has ended (an overnight sector keeps until its own arrival day is over)
  with no OUT/IN is not "scheduled" any more: the logbook card drops the
  accent and reads "not logged" in amber where the block time sits, the
  calendar draws it amber, and the legal page carries a
  `Not Logged` CAUTION requirement (`LegalityInput.unlogged`, the last 90
  days, oldest first) whose remedy is "Log TR491 (7 Nov)" and whose panel
  opens the flight. An unflown sector counts toward nothing, so a missing one
  quietly understates recency and the limits — it drew in the accent, as if
  still ahead. Simulators are never flagged (a session may record no times).

**Decluttered in the same pass:** a comparison card no longer explains itself
in a sentence under every row ("Your entry is on record…") — the held side is
lit; only an accepted card's days-left line stays. The Summary's "Sim" figure
shows only for a period that had a session. The light theme's
`--status-warning` is L 0.5 (from 0.56) so amber TEXT clears 4.5:1 on a
caution cell's tint, and a caution cell's figure reads `text-status-warning`.

### Hardware: keys and a tick (`lib/utils/shortcuts.ts`, `lib/utils/haptics.ts`)

| Key | Does | Where |
|---|---|---|
| `1`–`4` | the nav's tabs, in the pilot's own order (`useHardwareNav`) | everywhere |
| `/` | opens search (focuses it when already open) | logbook |
| `N` | new flight | logbook |
| `↑` `↓` | the flight above / below the open one | logbook, split layout, focus on the list's side |

- **ONE gate, `isShortcut`**: no modifier held, not in a field / wheel /
  editable, no dialog or menu open, not already handled. A new shortcut goes
  through it and into the table in `shortcuts.ts`.
- A keep-alive page listens only while it is the ACTIVE route.
- The arrows stand down when focus is inside the open flight — there they
  scroll the panel and turn a wheel.
- **`haptic(weight)`** is the one way to vibrate: `tick` (6ms — a nav tab, a
  menu choice), `tap` (10 — NOW), `thud` (18 — a delete, from
  `showUndoToast`, where every delete ends). Android has `navigator.vibrate`
  and iOS does not; nothing looks or behaves differently without it, so it is
  not a platform branch. Only ever inside the gesture that caused it. (The
  older direct `navigator.vibrate` calls — the year rail, the countdown — are
  as they were.)

### The Logbook's Virtualized List

`components/flight-list.tsx` uses `@tanstack/react-virtual` with dynamic
measurement, and there is one non-obvious rule holding it together: **every
flight card must be the same height.**

When a measured row turns out taller or shorter than `estimateSize`, the
virtualizer keeps the view stable by programmatically scrolling by the
difference — and a programmatic scroll **cancels an in-progress momentum
scroll** on touch. Jumping into the middle of the list and then scrolling UP
walks through rows that have never been measured, so the correction fired on
almost every row: the list stopped dead and needed another swipe, over and
over.

Three things keep the delta at zero:

- **The gap between two cards is `ROW_GAP_PX` (4px)**, the same as every
  other card list's `pt-1`. It was 8, which read as separate items rather than
  a list. It is the row wrapper's bottom padding, and the list's bottom spacer
  subtracts it, so the last card still rests on the shared line.
- The two optional rows in `flight-card-body` reserve their line (`min-h-[1.25em]`,
  which is `leading-tight` at their font size) so a flight with no aircraft or
  no crew is not a shorter card. **Do not drop those** — a variable row height
  brings the corrections straight back.
- `estimateSize` is **calibrated ONCE** from the first row that lays out (it was
  104 against a real 110), and after that nothing is measured at all. Not
  measuring is the point: the virtualizer can never discover a size it did not
  expect, so it can never correct the scroll offset, and the list's total height
  stops changing as you scroll (measured: a constant 13376px, where it used to
  creep upward as rows were measured). One-shot for a second reason too —
  feeding every row's measurement back into the estimate is a `setState` in a
  ref callback, and two rows disagreeing by a fraction of a pixel ping-pong it
  until React tears the page down with "maximum update depth exceeded".
- `getItemKey` keys the size cache by **flight id**, not index — keyed by index
  the cached heights get misattributed the moment the list changes, so a delete
  or re-sort hands row N whatever used to be there.

Measured after the fix: jumping to the middle and scrolling up 40 steps
produces **zero** scroll corrections.

**The airports, aircraft, crew and roster lists follow the same rules**, through
ONE hook — `useCalibratedRowHeight` (`hooks/use-calibrated-row.ts`), which the
logbook uses too. The three reference lists measured every row
(`ref={virtualizer.measureElement}`), and on the airports list (~29k rows) a
four-flick fling spent ~370ms at 4× in the virtualizer: each new size rebuilds
the measurement cache for EVERY row. Their cards are two truncated lines — the
crew card's second line is a no-break space when empty, the aircraft card's
description truncates instead of wrapping — so one measurement is exact.

**`getItemKey` must be a STABLE function** (`useCallback` on the list). The
virtualizer memoises its measurements on `getItemKey`'s identity, so an inline
arrow is a full pass over the list on every render — and the page re-renders
on every scroll-driven range change. Measured on the airports fling: the page's
render 108ms → 15ms inclusive.

### The month calendar is BARS — one calendar everywhere (Nov 2026)

The owner's model was a desktop calendar app: a grid of day cells with what
each day IS laid over it as bars. `LogbookCalendar` draws that for the logbook,
the roster and the dashboard alike, on the same glass as before; the layout is
`lib/utils/roster/calendar-bars.ts` (pure, `calendar-bars.test.ts`), the data
`useCalendarSpans` (the logbook's flights + the roster's duties, in the display
zone).

| | Drawn as |
|---|---|
| a flight inside one day | that day's cell, full width, ONE line: "248 WMKP" — no airline designator (`shortFlightNumber`) |
| out and straight back | ONE bar, "248/9 WMKP", named for the turnaround (`isReturnOf`: the very next flight, the reverse route, the same airline, within 8h) — a four-sector day of two returns is two bars, not four and a "+1" |
| a flight or timed duty across midnight | from the MIDDLE of its first day to the MIDDLE of its last — half of each cell |
| all-day duties on consecutive days with one code | ONE bar ("Paternal Leave", "LOFF"); leave reads its description, other duties their code |
| a bar leaving a week row | continues on the next row, its cut ends square |

- **SIX week rows, always, and compact** (`WEEK_ROWS`; a row is a 12px day
  line + three 12px lanes + 1px — 49px). A calendar that grew and shrank a row
  as the months turned moved the list under it, which the owner called
  disruptive; at 62px a row a phone showed two and a half flight cards under
  it. Measured at 390×844 with no status-bar inset: the panel is 342px and 4.1
  cards show under it (3.5 at 360×780). The header row's controls are 28px
  tall, their hit areas grown to 36px by a pseudo-element.
- **THREE lanes per day, one line each — or TWO lines where there is room**
  — the owner's reference fits three items a day and ten characters ("TRxxx
  WARR") on a line. Inter is wide: those ten characters are ~53–58px of 9px
  type and a phone's day is ~46–51px, so a label is CONDENSED horizontally by
  exactly what it needs (`lib/utils/text-fit.ts`: canvas `measureText`, cached
  per label, `scaleX` with a floor of 0.7, re-measured once the web font
  loads) rather than set in a second typeface. A flight whose label would be
  condensed past 0.85 takes a SECOND line instead ("456/7" over "WMKP") —
  but only where the lane under it is EMPTY across its whole range
  (`layoutWeek`'s `wantsTwoLines`; the lanes are packed one line each first,
  so taking a line can never push another item out of sight). Where neither
  fits, the number alone. Measured: no label clipped at 390, 360 or a 1180
  two-month layout. What a day has past three lanes is counted beside its
  number ("+1"). Clipped at the floor, never ellipsed — "TR56…" loses the
  digit that says which flight.
- **A day keeps or drops its one-line airports TOGETHER.** Decided per bar, a
  triangle read "100", "101 WMKP", "102 WSSS" — one label a hair wider than the
  next. A two-line bar is not part of that decision.
- **A GLASS calendar, not a calendar on glass — and what is written on it is
  SOLID.** Every item is a bar (`barTone`, `DUTY_BAR`, `HUE`) whose hue is
  MIXED into `--on-glass` (`color-mix`), so it looks like the tint it was but
  nothing behind the glass shows through it: a flight in the accent — FILLED
  once flown, light with accent text still to fly — amber not logged, teal a
  simulator, a duty its type's hue. Another month's bars are the same hue at
  half strength, never `opacity` (that let the glass through). A round of
  bare coloured text and solid -700 duty bars was rejected by the owner:
  neighbours in one lane ran together. Bars leave a 3px gap (`BAR_INSET_PX`).
- **REST days are ONE hue** (green): a day off and every leave — annual,
  sick, parental — on the calendar and on the list's duty cards alike
  (`isRestDay`, `lib/utils/roster/duty-runs.ts`). LOFF grey beside leave green
  read as two kinds of day.
- **Another month's days are SHADED, not painted** — a translucent darkening
  (`bg-black/[0.07]`, `/30` dark) the glass shows through; a solid fill read
  as a slab under the calendar. They are TAPPABLE: the calendar moves to that
  month (a pair two months, unless it is the other pane) and the day is
  chosen.
- **Day numbers are grey; TODAY's is a solid ACCENT BADGE** — the calendar's
  ONE solid accent mark, as on the platform's own calendars (Nov 2026: a lit
  cell and a bold number were the range's tint and easy to miss). **The
  chosen day is a NEUTRAL fill** (`--on-glass-fill`) **with an inverted
  badge** (ink on the face): it was an accent ring, the colour every flight
  still to fly is drawn in, so the day tapped read as one more of them. Only
  today is badged in the accent — a range's ends are bold accent numbers, or
  today inside a range read as a third end. "Today" follows the clock
  (`useDayKey`), so a calendar left open overnight moves it.
- **The grid is ONE tab stop per month** (the chosen day, else today, else the
  1st) and the ARROWS move between days, a week up or down
  (`onGridKeyDown`); past the month's edge the calendar moves with the focus.
  Every day a tab stop put 42 presses (84 with two months) between the header
  and the list. The focus outline sits INSIDE the day
  (`outline-offset: -3px`): outside it, the row's paint containment cut it off.
- **Today is on both calendars.** The dashboard's moves to the month that
  holds today and chooses nothing (a tap there is one end of a range).
- **Two months are a fixed odd|even pair on every page** (`pairStart`,
  `lib/layout/panel-mode.ts`). The dashboard anchored on the period's end as it
  was, so a December end showed Dec|Jan and a step moved it out of phase; it
  snaps now, except while the wheels are up (the month being chosen is the
  left pane) — closing them snaps it, on the logbook as on the dashboard (the
  logbook left a wheel's February as Feb|Mar, and every step after it out of
  phase).
- **The wheels take a touch WebKit sends as non-cancelable.** The library
  started a drag only on a cancelable `touchstart` (and settled only on a
  cancelable `touchend`), and on the owner's iPhone the calendar's wheels did
  not move at all — iOS delivers a touch as non-cancelable when it has not
  routed that region's listeners synchronously. The patch drags whatever the
  flag says and `[data-rwp]` carries `touch-action: none`, so the page cannot
  pan under the drag either way.
- **The grid runs to the glass's edges but for its RIM** (`RIM_CLEAR_PX`,
  2px on the sides a pane reaches and the bottom) — a dual pane's right half
  ruled off from its left — and its bottom corners follow the glass's
  (`cornerRadius` less the clearance), so a lit corner cell follows the
  material's curve. Flush to the edge, a duty bar running off a week row, a
  range's fill or the chosen day's ring sat over the rim (a ~2px ring painted
  UNDER the contents) and the calendar lost its edge there.
- **The day's width is read in a ResizeObserver** (`data-cal-week` /7), never
  in a commit, and each week row is `contain: layout paint`.
- **Bars take no taps.** A tap is the DAY's, which the page scrolls to.
- **The header is the MONTH on the left** — "November 2026", the month bold
  and the year light, the control that opens the month/year wheels — **and
  the tools on the right**: Today and the **Duties** menu.
- **Duties is ONE control with three states** (`useDutiesView`, a per-device
  module store): Hidden / On Calendar (the default) / Calendar and List. The
  combinations are not equal — the month with its roster while the list shows
  flights alone is the common case; duty cards in the list with the
  calendar's duties hidden is one nobody asks for — so two independent
  switches (the round before) offered a useless state and made the common
  case two taps. A page with no list beside it (the dashboard) offers Hidden /
  On Calendar. Simulator sessions are logbook entries and show in every
  state.

### The roster IS the logbook, with its duties on (Nov 2026)

The roster drew the logbook's flights anyway, and a flight could be added on
one page and a duty only on the other — so there is ONE page, `/logbook`. Its
list (`FlightList`) takes the roster's duties as cards among the flights
(`buildLogbookRows`, `lib/utils/logbook-rows.ts`) when the calendar's
Duties menu says "Calendar and List" (`useListDuties`). There is no duties
button in the logbook's header any more: the one control lives where duties
are looked at.

| | Rule |
|---|---|
| order | one newest-first list: a duty sorts as a flight would — UTC date, then report time against the flight's out time, a whole-day duty last in its day; on a tie the flight first. A flight's place never depends on whether duties are shown |
| the card | `DutyCardBody`: the flight card's four lines and its HEIGHT (the list positions every row at one calibrated height — measured 102px both): date column, report — length — release (UTC, as the flight cards), the code with its icon, the description, "Called out HH:MMZ" for an activated standby. Told apart by the duty type's colour on the date and code and a stripe down its leading edge |
| runs | consecutive whole-day duties with the same kind, code and description are ONE card ("3 days … to 14 NOV"), at its last day; a swipe bins the whole run and Undo brings it back. The calendar draws a run as ONE bar by the SAME rule (`groupDutyRuns`, `lib/utils/roster/duty-runs.ts`): a day off or leave is the whole day whatever window it carries, a same-day duplicate folds in, the description is whitespace-folded |
| a run is a PERIOD | it opens as one (`dutyRunOf`): From / To move its ends, its fields change every day of it, and its DAYS are listed under it — tap a day to change only that day (`duty:day:<id>`, `dutyDayKey`), swipe one to remove only that day. A new duty can be entered over several days at once |
| selection | a duty is `duty:<id>` (`dutyRowKey`) — its period —, one day of it `duty:day:<id>`, a new one `duty:new:<date>`; the shell renders `LogbookDutyPanel` for any of them, as it renders `FlightForm` for a flight id |
| + | with duties hidden, a new flight in one tap; otherwise a menu — Flight or Duty (on the calendar's chosen day, else today; nothing is written until saved) |
| search, ↑↓, calendar | search terms match a duty's code, description and kind; the arrows step through rows of both kinds; a calendar day lands on the first row COVERING it (`scrollToFirst`, `rowCoversDate`) |
| `/roster` | a redirect to `/logbook?duties=1` that carries a selection across; `?duties=1` (the dashboard's duty links) turns the duties on and drops itself |

**The roster still stores ONE ENTRY PER DAY** (`lib/utils/duty-period.ts`),
and a period is how the pilot sees and edits those days, not a different
record. The company report lists each day on its own row; a re-import matches
each day by date + code (`bulkUpsertScheduleEntries`); each imported day has a
derived id (`duty:<date>:<code>`) so two devices importing one report land on
one record; and paragraph 5 counts days off one at a time. A period save is a
PLAN over its days (`planDutyPeriod`): a day it keeps is patched only where it
differs, a day it lost is binned (soft), a day it gained is created — or, when
the same duty (type + code) already sits on that day, adopted rather than
doubled. One consequence to know: a re-import still re-creates a day the
report carries that the pilot changed to another code, because the report is
the authority on whether its duty exists.

Roster is in no nav, tab picker or keep-alive list; a stored "roster" tab is
folded into Logbook (`normaliseNavTabs`, `lib/utils/nav-tabs.ts`). FDP and
Discrepancies light the Logbook tab.

### ONE Calendar Panel (`components/calendar-panel.tsx`)

The logbook and the dashboard were already rendering the same
`LogbookCalendar`; what made them look like two different calendars was
everything AROUND it. `CalendarPanel` owns that wrapper now, and a page
supplies only what genuinely differs — the logbook picks a single date, the
dashboard picks a range.

| | was (dashboard) | is (both) |
|---|---|---|
| open | spring-in floating card | collapsing height on `PANEL_MOTION` |
| width | `max-w-md` | the full panel width |
| radius | 24 | 20 |
| material | its own glass | transparent inside the panel's glass |
| dual month | never | when the layout allows |
| month picker | a second "MMM YYYY" label in the ACTION BAR | the calendar's own header (`onHeaderPress`) |

That last row is the one worth stating twice: the action-bar month label is
exactly what the logbook removed for saying the same thing twice, and it was
what grew the left action group into the centred nav pill. The dashboard still
had it.

The calendar stays MOUNTED and collapsed to `height: 0` so its natural height
is always measurable, and `onNaturalHeight` reports it — which is what the
logbook's list spacer reserves, and the dashboard's summary too
(`DashboardCalendarSpacer`). **Both pages PUSH their content; neither floats
the calendar over it.** The dashboard's used to float, and the period's hero
figure read through the calendar's glass between the day numbers.

**A range fills its DAYS** — square cells in the accent (`--on-glass-accent`),
the ends the selected-thing fill (`--on-glass-active`) with bold accent
numbers. It was the soft tint (today's too), and the dashboard's chosen period
read no stronger than one lit day. The
per-week-row capsules it used to be drawn as went with the edge-to-edge grid:
every other lit day (today, the selected one, another month's) is a whole cell
between the day rules, and a capsule inside them read as a different control.
The **absorb** logic stays in the logbook
(`handleCalendarHeight`): only the ResizeObserver moved.

### The Logbook's Floating Panels (search + calendar)

The search block and the calendar both live in ONE absolutely-positioned stack
at `--chrome-top`, and the list reserves their combined height in its
`topSpacerHeight`. Two things make that work:

- **`overflow-anchor: none` on the list scroller.** Growing the spacer is how
  the panels push the list down. Browsers' scroll ANCHORING exists to stop
  exactly that: when content above the viewport grows it bumps `scrollTop` by
  the same amount so the view doesn't move. The result was that opening the
  calendar pushed the list only when it happened to be scrolled to the very
  top, and the compensating adjustment was reported as a downward scroll —
  which is what hid the nav pill. With anchoring off the push is identical at
  every scroll position (measured: 358px at scrollTop 0, 600 and 1500, with
  `scrollTop` unchanged).
- **The list is PUSHED on a transform, not by an animated height**
  (`useFlipPush`, `hooks/use-flip-push.ts`). The spacer takes its new height
  in ONE layout; the content after it starts where it visually was and slides
  home on a WAAPI transform, the delta read in a ResizeObserver callback
  (after layout, before paint — no flash, no forced layout). Animating the
  spacer's height re-laid out and repainted the whole list every frame — half
  the calendar's cost: measured at 4×, calendar open 9 → 3 frames over 33ms,
  close 4 → 1, paint 329 → 154ms. The dashboard's summary spacer does the
  same. `absorbSpacerDelta`'s no-animation case passes `animate: false`.
- **`PANEL_MOTION` — one clock.** The calendar's collapse and the list's push
  run the same 300ms on `MORPH_EASE`. They used to be a
  framer spring and a CSS transition of a different duration, which read as
  two stages: the panel opening, then the list catching up. The calendar is
  therefore always MOUNTED and collapsed to `height: 0` (rather than
  conditionally rendered), so its natural height is always measurable and the
  collapse is a plain px transition the spacer can match exactly.

**The calendar follows the list by the row at least HALF on screen**
(`FlightList`'s `handleScroll`: the first row whose card midpoint is at or
below the line the rows pass under — the scroll offset less `topGapPx`, the
open space above the first card). It took the first row with ANY pixel left,
so a card all but gone under the calendar still named the day, and it ignored
that gap. The day changes as the next card takes over that half, in both
directions.

**Search is a token field, stowed by default.** A header button opens it
between the action buttons and the calendar, and it collapses on the same
`PANEL_MOTION`, so whichever panel is opening the list is pushed by one
movement. Typing filters live; pressing Enter pins the text as a CHIP so the
next term stacks on it, and every chip must match (AND) — `TR647` then `WSSS`
is that flight number *and* that airport. Backspace on an empty field takes
the last chip back, and stowing clears the terms, because a hidden filter
quietly narrowing the logbook is the kind of thing you don't notice for ten
minutes.

The category tabs (Flight / Aircraft / Airport / Crew) are **gone**. They were
a precondition rather than a refinement — with none active `filteredFlights`
ignored the query completely — and once a term matches any field, stacking
terms expresses everything the categories did without the mode.

### The Logbook Calendar's Two Widths

The main panel has exactly **two** widths and the divider between the panels is
a **toggle**, not a drag handle (`ResizableHandle`'s `toggle` prop). A free drag
always ended snapped to one of the two anyway, and on the way there the calendar
grew continuously and flipped its layout mid-gesture, which read as the panel
breaking rather than resizing. `minSize` is a PERCENT, so it has to stay low
enough that 360px is reachable — at 30 it floored the panel at 420px on a
1400px container and single-month was never actually hit; the real floor is the
CSS `min-width`.

**The widths live in `lib/layout/panel-widths.ts`, not in the components.**
They cannot be picked independently:

| | | Why |
|---|---|---|
| `SINGLE_MONTH_PX` | 360 | **A panel is a phone.** One calendar month, and the common Android/iPhone logical width — so a panel is always laying out the same tree the mobile view does. |
| `DETAIL_MIN_PX` | 360 | Same rule for the detail pane. |
| `DUAL_MONTH_PX` | 600 | Two months at 300px each — 7 columns of ~42px, about where iOS's own two-up month view sits. |
| `SPLIT_MIN_PX` | 720 | Below this there is no split; it is also the `md:` breakpoint. |

600 rather than 620 because of **iPad Air 5 landscape with the sidebar open**,
which is the tightest case the owner actually uses:

```
1180 − 199 (sidebar + margins) − 1 (divider) = 980 available
600 (two months) + 360 (detail)              = 960   → 20px spare
```

At 620 that sum was *exactly* 980 — it fit with zero slack, so any rounding took
the dual-month toggle away on that device. The 20px is the whole point.

The nav pill is **not** part of this budget. The header's action groups are
anchored to the VIEWPORT edges (main actions left, detail actions right, with
the centred pill between them), not to the panels, so the panel split cannot
move the pill onto a button. Measured at 1180: main actions 16→240, pill
367→814. What *can* collide is a page whose action bar EXPANDS — the dashboard's
period pills — and that is a per-page question, not a sizing one.

**A dual pane is `MONTH_PANE_PX` (284), a single month `SINGLE_PANE_PX`
(336)** in the split layout — the dual panel minus the gutter, halved, minus a
pane's padding; and the single panel minus the same. They used to be one
width because the cells were SQUARE, so a month's width was its height and a
wider single month made the width toggle resize the calendar under the flight
list. The bar grid's rows are a fixed height, so that reason is gone: the two
modes are the same height at any width, and a single month on a tablet now
has the phone's ~48px days instead of the pane's ~40 (the owner's "desktop
differs from mobile"). On a phone the calendar is uncapped.

The pane width is only half of it: the calendar also carries exactly ONE header
row (the date selector) in both modes. When the caption lived on each pane
instead, a single month came out 12px shorter than a pair.

**The mode itself comes from the LAYOUT, not from a measurement**
(`lib/layout/panel-mode.ts`). The page used to derive `dualMonth` from its own
ResizeObserver, which necessarily lands a frame or two after the panel resized —
and in those frames the calendar rendered the OUTGOING mode at the INCOMING
width. That is the flash on the collapse. The layout publishes the answer in the
same callback that resizes the panel, so the switch happens in one commit
(measured across the whole collapse: the calendar samples a constant 290px).

A phone has no dual mode to match, so `paneMaxWidth` is left at the wider
default there and the calendar uses the width it has. Without ANY cap a single
month stretched to fill the wide panel — 7 columns of 84px, the grid going from
313px tall to 519px — for the frames between the panel resizing and the
dual-month switch catching up, which flashed a giant calendar.

In **dual-month** mode the two panes are a FIXED pair: odd month on the left,
even on the right (Jan|Feb, Mar|Apr, …), anchored by `pairStart()`. The pair
holds while the top flight card is in either pane and jumps a WHOLE pair when
it leaves — never one month at a time, which is what made the old carousel feel
arbitrary. A swipe or wheel step therefore moves **two** months in dual mode
(`stepMonths`); stepping by one would swap which side each month lands on and
put the pairing out of phase.

**ONE date selector for the whole calendar**, above the grid(s), and it is what
opens the month/year picker. The action bar used to carry an expanding month
label as well, which said the same thing twice and was the thing that grew the
left action group into the centred nav pill; per-PANE captions were the same
mistake at a smaller scale — with two panes that is two captions saying half a
thing each. One header row also keeps single and dual the same HEIGHT for free.

**The month/year picker is two WHEELS, inside the day grid's own box.** Month
and year, the app's wheel (`@ncdai/react-wheel-picker`, as the date and time
pickers) on a capsule strip of `--on-glass-fill` (`wheel-fill-glass`) — what
iOS's inline date picker turns its grid into when its month is tapped. It
replaced a 4×3 grid of month capsules under a year stepper, which the owner
rejected twice: a year away was a tap per year, and it read as a web form.

- It is LIVE: each settled spin moves the calendar (and the logbook's list)
  through `onMonthSelect`, and the picker stays open. The date selector, its
  chevron flipped, is what closes it.
- On a phone it replaces the grid (in FLOW but hidden, so the box keeps its
  height). In the DUAL layout it takes the RIGHT pane and the left pane keeps
  drawing the month being chosen — the owner's layout, now without the clip:
  the wheel's rows (`WHEEL_ITEM_PX` 34 → ~218px) are what keep it inside a
  dual pane's ~255px grid. Measured at 1180: wheels 106–324 inside a panel of
  52–342.
- The years run 70 back and 5 ahead of today and the viewed year.
- It mounts only while open: a wheel is ninety rows of 3D-transformed text.

**Nothing in the header reaches a floating panel hanging from it.** The
calendar and the search field sit at `--chrome-top`, which is where the
header's band and its tap target END (see `ChromeFade`). They used to reach
past it — a 16px fade tail and a tap strip under the buttons — so the header
had to step aside for an open panel (a hook, `useFloatingPanelUnderHeader`, a
mask cut to the panel's shape); with the band ending at the bar there is
nothing to step aside, and the hook and the mask are gone.

### Chrome Overlays (`components/ui/chrome-overlays.tsx`)

- **`ChromeFade`** — THE floating-header treatment, rendered directly by the
  main shell header and the mobile detail overlay header in
  `desktop-layout.tsx` (no more inline copies): a native-style bar of
  progressive **blur + darken** (one masked blur layer under a veil).

  **ONE band: the blur, the tap-to-top target and the bar end at the same
  line, `--chrome-top`** — 4px below the 44px controls as they are 4px below
  the top of the bar, so the action buttons sit in the middle of it (the
  owner's ask, Nov 2026). It used to run past the bar: a fade tail (41px,
  then 16) and a separate tap strip under the buttons (`--chrome-tap`, 20px,
  4px further than the blur), so neither edge said where the header ended and
  the tap area read as too large. Tapping any bare part of the bar — or the
  strip over the status bar — scrolls that panel to the top; the phone
  overlay's bar does the same for the record.

  **`--chrome-clear`** (the bar + `--content-top-gap`) is where the
  quick-scroll rail parks a row — the same place a list's first card sits at
  its top.

  **Every page starts `--content-top-gap` (16px) under the band** — a
  page's large title (`PageContainer`, `DetailFormPanel`: `pt-4`), the
  logbook's first card (`LIST_TOP_GAP`), the legal dashboard's surface, the
  flight form's first section. The logbook and the dashboard were 20px, so
  the logbook opened visibly lower than the tab beside it. Measured: every
  main and detail panel's first content at 68px (390 and 1180).

  **The header is `inert` while the phone's sidebar is up**
  (`setOverlaySidebarOpen` / `useIsOverlaySidebarOpen`,
  `lib/layout/panel-mode.ts`). The bottom bar's morph keeps its own open state,
  so the shell could not see it, and the header sits above the sidebar's
  backdrop in z-order: a tap on the header behind an open sidebar scrolled the
  list to the top or pressed an action button. Inert, the tap reaches the
  backdrop and closes the sidebar.
  The gradient is anchored to a fixed 52px ramp so taller chrome
  keeps the same boundary instead of stretching until content shows through the
  title. Because the veil is `--background` it darkens on the dark theme and
  lightens on the light one with no branch.

  **The weights are set for an INSTALLED iOS PWA, not for a browser.** Apple
  already applies its own `black-translucent` treatment over the status-bar
  strip, so whatever this paints STACKS on top of it. Matching the reference
  headers by eye in a browser therefore overshoots badly once installed: at
  veil **88%** / blur **22px** — which looked right in a tab — the owner's
  verdict on device was that you could no longer tell *what* was under the bar,
  only that something was. **66% at the anchored edge is that reference MINUS
  what iOS contributes.** Do not re-tune these from a desktop screenshot alone.

  **Judge the blur at the TOP of the band, not the bottom.** The three layers
  overlap there and nowhere else, and sequential blurs compose as the
  root-sum-square — so the peak is not the largest radius but √(Σr²), and
  reading the largest radius instead is what kept this being set too high
  through three rounds: **12.2px** at 2/5/11, then still **6.0px** at
  2/3.2/4.6, each time with the row level with the action buttons judged "a
  little too much" while everything above it — where the stack peaks AND iOS
  applies its own — was unreadable.

  At **0.6 / 1 / 1.4** the peak is **1.8px** and the bottom of the band is
  0.6px — a tenth of where this started, and deliberately almost nothing. The
  VEIL is what makes the band read as chrome; the blur's only job is to take
  the crispness off an edge so it does not look touchable. Every round that
  judged the blur by how much it HID was tuning the wrong layer.

  The owner chose blur at the TOP and darken-only at the BOTTOM
  (`components/bottom-edge-blur.tsx` — a short home-indicator fade, iOS
  standalone only): at the bottom band's height a blur reads as smearing.
  The anchored top band also makes an iOS rubber-band read as bouncing from
  under the action buttons rather than the screen edge.
- **`ScrollIndicator`** (`components/ui/scroll-indicator.tsx`) — the app's own
  scroll indicator, because iOS draws its own across the scroller's whole box
  (from the screen edge, over the status bar) and CSS has no
  `scrollIndicatorInsets`. Mounted as a scroller's FIRST CHILD, but only the
  zero-height sticky MARKER lives there; the thumb itself is a
  `position: fixed` element appended to `document.body`, placed against the
  scroller's box and inset to `--chrome-top` … `--nav-bottom-offset`.
  At either end it compresses against the track instead of riding the
  rubber-band.

  **That box is measured as the thumb appears, and FOLLOWED per frame while a
  transition runs outside the scroller.** A cached copy plus a ResizeObserver
  looks sufficient and is not:
  opening the sidebar SLIDES the main panel across without changing its width
  (measured: `0..360` → `199..559`), so nothing resizes and no observer fires.
  The thumb stayed at the closed layout's right edge — 199px inside the list,
  drawing a grey rule down the middle of the flight cards, and still tracking
  the scroll, which is what made it read as a stray line rather than a
  misplaced scrollbar.

  Re-reading on scroll frames alone still leaves a visible flash, because the
  morph takes ~300ms during which there is no scroll at all — so `follow()` is
  a rAF that tracks the box while a `transitionrun` OUTSIDE the scroller is
  unfinished (the push is a transition on the sidebar BESIDE the panel, not on
  an ancestor of it) and the thumb is up. It used to follow for the thumb's
  whole visible window, which put a rect read in a rAF on every frame of every
  fling, while the list was mounting rows: 103ms of `getBoundingClientRect` in
  four flings at 4×, 24ms now. Measured across the morph, sampled every 45ms:
  the thumb is at the scroller's right edge in every frame.
- **`MODAL_SCRIM`** — `bg-black/15 dark:bg-black/50`. A flat `bg-black/50` is
  invisible over a dark app and turns the light theme (white panels, glass
  sidebar) into grey mush. Used by every dialog overlay, the nav sidebar
  backdrop and the date/time pickers.
- **`RadialBlurBackdrop`** — heaviest around the dialog, clearing toward the
  screen edges.

On a **translucent** surface (the glass sidebar) a painted scrim would flatten
the material — mask the content out instead.

### Destructive Actions: No Confirmation, but Recoverable

Deleting is **one tap**. There is no dialog, no press-and-hold, and no armed
countdown — the undo is `Recently Deleted`, which holds the row for 30 days.

That is a better trade than the countdown it replaced. A timed arm charged you
ten seconds every time you deleted something on purpose, and gave you nothing
at all once the ten seconds were up; a holding area costs nothing on the way
out and is still there tomorrow.

**A locked flight opens its context preview on tap**, not nothing. It cannot be
edited, but a dead tap gave no feedback and no way to READ the entry short of
unlocking it; the preview shows the full detail and carries Unlock in its
action row.

**Every delete says so, with an Undo** (`lib/utils/undo-toast.ts`, rendered by
`UndoToastHost` in the app layout). A row that simply vanished gave no sign the
tap had landed or where the thing went, and a holding area nobody knows about
is not much of an undo. For `UNDO_TOAST_MS` (5s) "TR600 deleted · Undo" sits
above the bottom nav; Undo runs the same `restore*` Recently Deleted uses, plus
the page's own refresh. It is NOT a confirmation — the delete has already
happened — so it does not reopen the countdown question. A new delete path
calls `showUndoToast` after the soft delete succeeds.

**The one exception is "Sign out of all devices"** (`app/(app)/account/page.tsx`),
which still uses `CountdownConfirmButton`. It is not a delete: nothing is
recoverable afterwards because there is nothing to recover — the only undo is
signing back in on each device, so the pause before it fires is the whole
safety net.

`SwipeableCard`'s `holdToConfirm` / `holdDuration` / `cancelLabel` props and the
`lib/utils/pending-actions.ts` registry behind them are still in place for that
one caller. Do not wire them to a delete again.

### Camera OCR (`lib/ocr/oooi-extractor.ts`)

Two screenshot layouts are understood, plus a plain-text fallback. All three
run and the **best-scoring read wins** — a crop can look like either layout, and
`validateTimes` (OUT < OFF < ON < IN, plausible taxi/flight durations, computed
vs reported block) scores a nonsense parse near zero.

| Source | Shape | Extractor |
|---|---|---|
| Airbus MCDU AOC VOYAGE RPT | two columns, each alternating label / value | `extractFromColumns`, `extractFromLayout` |
| EFB flight-record **Time Summary** | one labelled row per event, PLANNED and ACTUAL columns | `extractFromTimeSummary` |

Time Summary maps Off Block / Takeoff / Landing / On Block → OUT / OFF / ON /
IN from the ACTUAL column, plus the planned times and the `3h50m` durations.
Two traps it handles explicitly: the yellow **delta** (`+00:05`) sits right
next to each value and parses as a perfectly good time (tokens starting `+`/`-`
are excluded), and the actual cell carries a **date** (`27 Jul 01:25`) that may
arrive as one OCR box or three.

The flight number is deliberately NOT read from the Time Summary header — it is
the ICAO callsign (`TGW216`) where the logbook uses IATA (`TR216`).

**The MCDU report is read PER COLUMN** (`extractFromColumns`). Each label finds
its value on its OWN side of the screen, below it and above that side's next
label. Reading it as rows — a label row, then the row under it — only works
while every slot is filled, and a blank (`----`) is not read at all, so the two
columns drift out of step: on a real photo the left door time and the right
TAXI label came back as one line and IN was lost; with OUT and IN blank, a lone
FLIGHT value had no row partner. A box can hold more than one token
(`1232 0942` — the old library joined boxes, and detection can still merge
two close values), so a token's x is estimated from its character position
within the line's box. The row reader stays as a candidate; the best score still wins.

#### The engine is OURS (`lib/ocr/engine/`)

The same two PP-OCRv4 models the `@gutenye` packages ship, with their numerics
(BGR, value/255, the 0.03 detection threshold, CTC greedy decode, reads below
0.5 mean confidence dropped) — but not their plumbing. `core.ts` is written
once for both runtimes; `node.ts` (onnxruntime-node + sharp) and `browser.ts`
(onnxruntime-web + the browser's own image decoder) only supply the sessions
and the pixels.

- **The keypad is DETECTED but never READ.** Recognition is the expensive half
  and scales with the number of boxes, and on an MCDU photo about half of them
  are keys. Boxes are recognised top to bottom and reading stops at the
  screen's last line (`MCDU_STOP`: `<AOC MENU` / `RETURN TO` / `SEND*` /
  `PRINT*`) — measured, 20–24 of 37–70 boxes. That is the "crop to the screen"
  without guessing where the screen is: a photo with no such line (a cropped
  shot, the EFB Time Summary) is simply read in full.
- **Detection runs at 800** (`DEFAULT_DET_SIDE`) while the boxes are cut from
  the full 1024 image, so recognition loses no detail. All seven photos read
  identically at 640, 800 and 1024.
- **Recognition is BATCHED** (`DEFAULT_BATCH` 4 — measured best; 8+ pads every
  line to the widest and gets slower). A batch may read past the stop line;
  those reads are dropped.
- **No OpenCV.** The library cut boxes out with opencv.js — 10MB the phone
  parsed before its first photo — for what, on level text, is a flood fill
  over a typed array (`boxesFromProbabilityMap`).
- **Lines come back one per box, in reading order, NOT joined into rows** —
  the extractors group rows themselves.
- **Both runtimes are PRIMED on warm-up** (`primeServerModels` /
  `primeBrowserModels`): a session's first run allocates its buffers and starts
  its threads, which was most of a second of the first photo's time. Priming at
  the real input shapes was measured and buys nothing over the small blanks.
- **Int8 models were tried and rejected.** Dynamic quantization (after folding
  the graph's `Constant` weights into initializers so the quantizer can see
  them) made recognition SLOWER in onnxruntime-web (734 vs 446ms) and read 0/7
  photos correctly; the int8 detector was slower too. The fp32 models stay.
- **A blank slot's dashes are dropped before the extractors see them**
  (`dropDashReads`). On the device engine, reading the ORIGINAL 12MP photo,
  photo 3's empty IN (`----`) came back as "1000" — at 0.64 confidence, in a
  box under half the median line height. Every real time across all seven
  photos and every engine reads at 0.88+ and ~0.6+ of the median height, so a
  digit-bearing read below 0.75 confidence or 0.55 of the median is a dash.

#### The DEVICE reads first, the server is the backstop (`lib/ocr/ocr-service.ts`)

The server path was ~10s on a Pixel 10 in Singapore: resize and re-encode on
the phone, an upload, a function in US-East (`iad1`) that may be cold, a
MongoDB session lookup, the download. The device engine has none of that and
reads the same photo in ~1.5s once warm (4-core desktop Chromium; ~3.4s with
the CPU throttled 3×). So:

| | |
|---|---|
| camera button pressed | `warmOCR` loads and primes the DEVICE models (not the server) |
| photo arrives | `readOnDevice` |
| device not done after `HEDGE_MS` (4s) | the server is asked too; the first answer wins |
| device throws | the server is asked at once, and `deviceFailed` sends every later photo server-first (iOS before 16.4 has no WASM SIMD) |
| offline | the device's answer, or its error |

`ocr-routing.test.ts` pins that order.

- **The engine runs in a WORKER** (`engine/ocr.worker.ts`, driven by
  `engine/device.ts`), so the page's main thread is not one of ONNX Runtime's
  compute threads and stays free for the UI. A worker that will not start or
  dies falls back to the same engine on the page. `warmBrowserOCR` (idle, 3s
  after boot, online) starts the worker, which fetches its own chunk and ONNX
  Runtime's JavaScript so the service worker holds them for an offline photo.
- **Threads = min(4, cores − 1)**, leaving a core for the UI. On a 4-core host
  four engine threads against the page's rendering ran recognition ~3× slower
  than the idle benchmark.
- **Nothing on the page animates while a photo is read.** The glass's ambient
  drift used to be paused for it (`html[data-busy]`); the drift is now gone
  altogether (see "Smoothness" below), so there is nothing to hold. The import
  button's spinner went for the same reason: the processing dialog covers it.

#### Speed — where the time went, and the rules that keep it fast

Measured on the seven real photos (`lib/ocr/__tests__/fixtures/mcdu/`):

| | Was | Is |
|---|---|---|
| Server OCR in production | **never ran**: file tracing dropped `@gutenye/ocr-node`, so every photo was uploaded, refused, then read in the browser from cold | runs |
| Server, 12MP photo | 19.4s (detection at 3072×4080) | ~0.43s (1024 image, detection at 800, keypad skipped; 4 cores) |
| Upload | the photo at 2048px, 0.5–2MB | 150–220KB |
| Browser engine runtime | 24MB JSEP build + 10MB opencv.js | 11.9MB WASM-only, no OpenCV |
| Browser threads | 1 | up to 4 (cross-origin isolated) |
| Browser, photo → form filled, cold / camera-menu warmed (4-core desktop Chromium) | 11.1s / 6.6s | 2.5–5.1s / ~1.5s (3× CPU throttle: ~3.4s warm) |
| Online on a phone | the server path, ~10s on a Pixel 10 | the device path, as above |
| After the read | a fixed 600ms pause | straight into the form |

- **Detection runs at whatever resolution it is handed.** `OCR_MAX_SIDE`
  (1024) caps it on the client AND again in the route (an old client still
  sends 2048).
- **Resize on PIXELS, not bytes.** `compressImage` skipped anything under 1MB,
  and a 12MP JPEG can be.
- **Only the UPLOAD is re-encoded.** The service compresses inside
  `processWithServerOCR`; the browser engine decodes the original straight to
  `OCR_MAX_SIDE` (`createImageBitmap` + one canvas draw), with no JPEG
  round trip in between.
- **The engine is woken when the camera button is PRESSED** (`warmOCR`, on pointerdown — the OS photo sheet follows): the device
  models load and run once while the pilot is still taking the photo. Only once
  the device has failed is the server's health check called instead, which
  boots the function and primes its models.
- **A failed server is skipped for five minutes** — each attempt costs an upload
  and a round trip before the fallback even starts. A 401 does not count. The
  server request carries a 20s timeout over the BODY as well.
- **The browser runtime is at STABLE URLs**, `/models/ort-wasm-simd-threaded.{wasm,mjs}`,
  copied from the installed `onnxruntime-web` by `scripts/copy-ort-wasm.mjs` on
  every `pnpm dev`/`pnpm build` (not committed — they must match the JS loading
  them) and precached by the service worker beside the models. The `.mjs` is
  the Emscripten glue AND the script every engine thread starts from, which is
  why the alias is the NON-bundled `ort.wasm.min.mjs`: the bundle inlines the
  glue and starts its threads from its own webpack-hashed URL, which nothing
  can precache, so a threaded engine could not have started offline.
- **Multi-threaded in the browser** (`ocrThreadCount`: up to 4, one core left for the UI). WASM threads
  need SharedArrayBuffer, which needs `crossOriginIsolated`, which needs
  `Cross-Origin-Opener-Policy: same-origin` + `Cross-Origin-Embedder-Policy:
  require-corp` on every response (`next.config.mjs` `headers()`). Everything
  the app loads is same-origin except Google Fonts, fetched in CORS mode
  (`crossOrigin="anonymous"`), which `require-corp` accepts. `credentialless`
  would be laxer but Safari lacks it. A page served from a cache predating the
  headers simply runs single-threaded.
- **The server uses every core** (`intraOpNumThreads: availableParallelism()`).

### Component Architecture

- Root layout is server-rendered; app content uses `"use client"`
- Context providers: Auth, Sync, Theme (root level), ScrollNavbar (app level)
- `KeepAlivePages` wraps page content in `app/(app)/layout.tsx`, keeping heavy list pages mounted across navigations (see below)
- Desktop uses split-panel layout (sidebar + detail panel via `react-resizable-panels`)
- Mobile uses bottom navbar with swipeable interactions
- Responsive switching via `useIsDesktop()` hook

### Swipe-to-Reveal Rows (`components/swipeable-card.tsx`)

`SwipeableCard` is the single reusable swipe-to-reveal primitive used app-wide
(flight/crew/aircraft lists, the flight form's field rows, and the crew/aircraft
detail rows). Built on **framer-motion** (motion values → no per-frame React
re-renders).

- **Armed on first contact.** An unarmed row has no drag feature, no
  `dragControls` and no action panel — a row is mostly read, and the flight
  form's ~50 of them mounting all that on the tap that opened it was ~800ms at
  a 4× throttle. The first pointerdown (or focus) arms it and is handed to
  `dragControls.start` in a layout effect, so that same touch swipes. The
  content's `x` motion value is bound only while armed (`UNARMED_STYLE`): a
  bound value is a framer frame-loop render for every row as it mounts, and a
  fling mounts a dozen a frame (up to 47ms of a frame at 4×, gone).
- **Gesture:** `drag="x"` with `dragDirectionLock` + `touchAction: "pan-y"` — a
  vertical gesture scrolls the list natively and never fights the horizontal
  swipe. Release settles to open/closed with a spring (`SPRING`); a fast flick
  opens via velocity.
- **Actions** (`SwipeAction[]`): `onClick` receives the BUTTON's own box, so an
  action that opens something can anchor it to itself (the flight card's `…`),
  and `keepOpen` leaves the panel up afterwards — for an action that reveals
  more actions, the row they belong to has to stay put beneath them. Rendered
  as **separate CAPSULES on the action surface** (`.control-surface`; a
  destructive one red) that
  **scale/pop in** (spring, staggered, trailing first) and fill the row height.
  Buttons rest at `opacity 0` when closed so nothing peeks at the edge. The
  trailing button sits **flush** with the card's right edge; the left gap comes
  from `openWidth` via `justify-end` (the panel has no padding, so it collapses
  to true 0 width when closed). `icon` is optional (label-only actions like
  "Clear" are allowed). Destructive **delete/logout** actions are **icon-only**
  app-wide — omit `label` and set `ariaLabel` for accessibility (don't reintroduce
  visible "Delete"/"Revoke" text).
- **Confirm-by-countdown** (`holdToConfirm`, `holdDuration`, `cancelLabel` —
  names kept for the call sites): a tap does **not** fire the action, it ARMS
  it. The panel closes and a **confirm overlay** covers the row — the content
  behind is greyscaled + slightly blurred + black-tinted ("the past"), a
  progress border (`HoldProgressBorder`) traces the **card** from 12 o'clock
  clockwise as the time runs out, and a centred pill reads `Cancel delete 9`.
  Left alone it fires; the pill cancels. Dragging is disabled while the overlay
  is up. See "Destructive Actions: Countdown, not Hold" above for the timer
  ownership rules — they are the load-bearing part.
- **Variants:** `variant="card"` (default — standalone rounded card) and
  `variant="row"` (inline divider row inside a grouped `FormSection`). A
  swiped `row` **morphs** into a rounded, lifted card (`bg-secondary`).
- **Dividers** (`separated` prop): inset `.row-divider` pseudo-element (see
  `globals.css`) aligned to the row's `px-4` text, **not** full width. On morph,
  the dividers directly above and below the swiped row fade out via
  `[data-swipe-active]` + `:has(+ …)` rules. The pseudo-element uses `z-index:2`
  so it shows above the `z-[1]` swipeable content (otherwise wrapped/editable
  rows would hide it).
- **Tap vs drag:** a capture-phase guard swallows the click synthesised at the
  end of a drag and closes an open row instead of navigating. On a clean tap with
  no `onClick`, the card focuses a blended inline `input`/`textarea` inside it
  (those inputs are `pointer-events:none` via the `[data-swipe-row] input` rule,
  so a swipe can start over them).
- **Multi-card:** opening/tapping one card closes others via the
  `swipe-card-close-others` window event.
- **No full-swipe:** there is intentionally **no** "swipe past N% to auto-trigger
  the primary action" behaviour — it was removed. Actions fire only on button tap.

### Motion Primitives & Navigation Animation

- **`components/ui/countdown-confirm-button.tsx`** (`CountdownConfirmButton`) —
  the shared confirm control, used by the swipe confirm overlay and the account
  page's "Sign out of all devices". Built on `hooks/use-countdown-confirm.ts` (a
  `MotionValue` progress 0→1 via rAF, with the whole-second label guarded so it
  re-renders at 1Hz rather than per frame). Accepts an external `progress`
  MotionValue so a surrounding surface can advance in lock-step, and
  `showBorder={false}` when that surface owns the border (the swipe overlay puts
  the border on the card, not the pill).
- **`components/ui/hold-progress-border.tsx`** (`HoldProgressBorder` +
  `topCenterRoundedRectPath`) — an SVG rounded-rect stroke that draws from **12
  o'clock clockwise** (custom path; a `<rect>` starts at a corner), thickening,
  glowing and intensifying with `progress`. Uses a per-instance (`useId`)
  gradient stroke. Sized to its positioned parent via a ResizeObserver.
- **`components/ui/border-glide.tsx`** (`BorderGlide`) — a glowing segment that
  **glides around** the rounded border (a "border beam"), used on the TOTP login
  OTP group while verifying. The full-border "confirmed" glow stays via the
  `.totp-success` box-shadow.
- **Nav highlight** (`GravityIndicator` in `components/nav-pill.tsx`) — the
  active-tab/item highlight (pill bar + bottom nav + sidebar). It SLIDES to
  its tab: one eased move (`slideTrack`, ease-out over `SLIDE_MS` 300), sampled
  into WAAPI `transform` keyframes with linear easing, and no shape at all. It
  was a soft body — two damped oscillators, one for the travel and one for a
  stretch-and-squash that rang down after landing — and the owner read it on
  device as springy rather than as a tab bar's light highlight (Nov 2026).
  The shape child, its oscillator and the squash are gone.

  In the SIDEBAR it is placed **instantly**. The list is a scroller whose
  metrics re-measure as a route settles and as the panel finishes morphing,
  and every re-measure was another chance for a move to re-fire and read as a
  double flash; a vertical list also gives the travel nothing to say.

  The effect **re-fires only for a new destination** (`animatedToRef`) and, if
  it interrupts a move in flight, resumes from where the highlight IS —
  computed from the move's own samples and the animation's `currentTime`,
  never read back with `getComputedStyle` (that was a whole-page style
  recalculation on a navigation's commit). `rects` is re-measured by a
  ResizeObserver as a route settles, so without the first guard a second move
  to the same place started mid-flight, and without the second a tap during a
  move snapped it back to the previous tab first. `transform` is deliberately
  absent from the box's CSS `transition` list — the WAAPI move owns it — and
  only `width`/`height` ease, on the slide's own clock. `instant` places it
  with NO animation while the sidebar is still morphing and under the drag
  lens, where it tracks the tab UNDER THE LENS so it is already there when the
  lens fades. Tab metrics are measured in **content coordinates** (correct
  inside the scrollable sidebar). Do not move it with a JS-ticked spring: it
  hitches when a heavy page mounts.
- **Nav morph** (`useMorphPhase` + `DesktopPillMorph`/`MobilePillMorph` +
  `morphTransition`) — the pill ↔ sidebar morph is a single `opening`/`closing`
  transition whose two geometry groups (**position+width** and **height**)
  **overlap** via per-property CSS `transition-delay` (no phase stall, no
  "stuck"). ONE lead for both directions (`MORPH_DUR` / `MORPH_LEAD`), so the
  two are exact mirrors and the top pill and the bottom pill perform the same
  motion:
  - **closing** (sidebar→pill) collapses height first (delay 0) — the top pill
    upward, the bottom pill downward, since one is top-anchored and the other
    bottom-anchored — then, at **~80% collapsed** (still visibly a panel),
    moves position+width into the pill, finishing the last fifth of the
    collapse on the way.
  - **opening** (pill→sidebar) is that played backwards: position+width first
    (delay 0), then height.
  The lead is sized so the second group starts while the first still has ~20%
  to run — with `MORPH_EASE`, 80% of the travel is done at ~50% of the
  duration, hence **LEAD ≈ 0.5 × DUR**. The whole morph takes **~300ms**
  (200 + 100). Note that the ORIGINAL was also ~375ms and felt wrong: the lead
  there was near-full, so the collapse was over before anything moved and the
  morph read as two snaps back to back. It is the overlap, not the length, that
  makes it fluid — a full second was fluid but slow to sit through. (The leads
  used to differ too — 160 opening / 185 closing — which made the two
  directions feel like different animations.)
  `MORPH_EASE` was retuned with them: the old fast-launch curve put the
  collapse 94% home in the first HALF of its duration, which is a snap followed
  by a crawl at any of these lengths.

  **The mobile backdrop is a PROGRESSIVE DARKEN, in one element.** It rides the
  morph's clock (`TOTAL`, `MORPH_EASE`) so the veil arrives with the panel, and
  it is a single layer: the flat scrim is its `background-color` (from
  `MODAL_SCRIM`) and `SIDEBAR_BACKDROP_RAMP` is its `background-image`, heaviest
  against the sidebar's edge and gone by 58% of the screen. It also takes the
  dismissing tap.

  It used to be three stacked `backdrop-filter` layers (4 / 10 / 20px, each
  narrower than the last) forming a real ramp of radii — optically the right
  construction, and unaffordable. A backdrop-filter is a readback plus a blur,
  re-rasterised whenever the backdrop or the geometry changes, and these fired
  during the one 300ms window where the panel beside them is animating `left`,
  `width` and `height`. A gradient is one paint and a composited opacity. The
  depth cue moves from "how blurred" to "how dark" — which is what the bottom
  edge treatment has always used, and what most native apps use during an
  active transition. Desktop has no backdrop at all — its sidebar sits
  alongside the content rather than over it.

  **The phone's bottom bar is 12px inside a flight card's edges, up to
  25rem** — `MOBILE_PILL_WIDTH`, `min(calc(100% - 2 * var(--panel-gutter) -
  1.5rem), 25rem)`, 60px tall (`MOBILE_PILL_HEIGHT`, a 56px tab inside —
  2px of bar round the highlight, `GROUP_ITEM`'s rule; the bar was raised
  from 52 on the owner's read on device, Nov 2026), so it keeps one
  proportion to the screen on every phone (it used to hug its tabs, ~330px
  whatever the width; then edge to edge at 56px, which the owner read as too
  big: 342×60 on a 390 phone now) without becoming a slab across an
  iPad in portrait (400px there). A
  `min()`/`calc` interpolates against the sidebar's px width, so the morph
  needs no measurement there.

  **The DESKTOP pill's width is MEASURED (`usePillWidth`), never `auto`.** `width` rides
  in the position group so the pill resizes *while* it moves, and CSS cannot
  interpolate a length to `auto` — with `width: auto` as the pill endpoint the
  width snapped on the morph's first frame, so the pill visibly resized to its
  final size before it had moved anywhere ("collapse and resize, then move").
  A px value at BOTH ends is the whole fix. It is taken off the element itself
  while it is still `auto`, in the ResizeObserver's first callback (no
  `setState` in an effect body), and only while the nav is settled as a pill —
  measuring in sidebar shape stores 191 as the pill width. The stored value is
  released back to `auto` for a frame when the tab set or the viewport changes.

  `useMorphPhase` advances on a timer (`DUR + max(lead)` fallback) **and** on the
  *delayed* property's `transitionEnd` (keyed to `propertyName` so the delayed
  group isn't cut) — the latter settles the phase the instant the morph finishes
  so the nav is interactive immediately. The **pill** content (horizontal tabs)
  is hidden until fully settled (it squishes mid-morph); the **sidebar** content
  (vertical list) rides `isSidebarShape`, stays **visible + interactive for the
  whole open span** (it merely clips like a drawer — no dead window that drops
  taps), and its **opacity is timed to the height** (`contentTransition` mirrors
  the height group's delay/duration) so the reveal and the growth are **one
  motion** — not the list fading in while the glass is still resizing (which read
  as two separate motions, "opens up while the glass expands down").
- **The sidebar's sections** (`components/nav-sections.tsx`, the owner's
  structure, Nov 2026): Dashboard and Logbook at the top, then DATABASE
  (Aircraft, Airports, Crew), DUTY & COMPLIANCE (Currencies, FDP,
  Discrepancies) and SYSTEM (Account, Settings, Bin). A section whose one row
  carries its own name draws no heading (`heading: false`) — LOGBOOK over
  Logbook is one word twice, with a chevron hiding one row. A row's
  `description` ("Master fleet records") is its tooltip. Headings are ONE
  line (11px caps, tight tracking): at 12px wide-tracked caps "Duty &
  Compliance" wrapped onto two centred lines in the 191px panel. Every nav
  destination is `navHrefs`, which the idle prefetch walks.
- **Sidebar list** (`SidebarNav` in `components/nav-pill.tsx`) — the toggle +
  sync strip **floats over** the nav (`pointer-events-none` on the bar, the two
  controls re-enabled) so the list scrolls underneath it; the nav reserves the
  strip's height as `paddingTop` and masks its content out over that band, so
  the list dissolves under the icons. A **mask**, not a painted scrim — the
  panel is translucent glass. The scroller is `overflow-y-scroll` with its
  content one pixel taller (`min-h-[calc(100%+1px)]`), so even a short list has
  somewhere to go and the rubber-band gesture is always available; without it a
  full-but-not-overflowing nav is inert to a drag, which reads as stuck.

  The strip is ONE component (`SidebarTopStrip`) used by both morphs, and it
  **captures taps**: it used to be `pointer-events-none` so only the two
  controls were hit-testable, which meant a nav item dissolving underneath the
  icons could still be tapped — you aimed at nothing and landed on Airports.
  `.SidebarTopBlur` frosts whatever passes under it, masked so the blur is
  strongest at the top and gone by the bottom of the band. One element, one
  filter list — a true multi-stop progressive blur means stacking several
  masked blur layers, and over the glass panel that is the construct that made
  the material render differently on iOS and Android. (The sidebar's BACKDROP
  does stack — see `SIDEBAR_BACKDROP_BLUR` below — but that stack is pure
  blur over the page, with no material underneath to diverge.)

  **Both morphs use this arrangement** — `DesktopPillMorph` AND
  `MobilePillMorph`. The mobile one used to lay the strip out as an ordinary
  flex row above the nav, so the scroll-under existed only on desktop; on a
  phone the list simply stopped at the icons. If you touch one, touch both.

  The mask is a plain ramp (`transparent 0 → black topInset`), and the gravity
  blob sits INSIDE the scroller so this one mask covers it too. The blob used
  to live in a separate non-scrolling overlay translated by `-scrollTop` from a
  scroll listener — which is a main-thread reaction to a scroll that already
  happened, so the blob visibly trailed the items by a frame. Inside the
  scroller it moves on the compositor, 1:1 and in the same frame. Do not put it
  back in an overlay to protect the overshoot spring from clipping: the top
  band is masked out anyway, so there is nothing there to see. The ramp also
  has no dead zone at the top — holding fully transparent for the first third
  made the band under the icons simply blank, which reads as the list stopping
  rather than running beneath.
- **No long-press link menu on the nav.** Every `[data-nav-link]` (pill tabs and
  sidebar items alike) cancels `contextmenu`, which is the gate both Chrome and
  modern Safari check before showing "Open in new tab / Copy link address" or
  the iOS link preview. On the pill the press-and-hold IS the drag lens's
  gesture, so the menu interrupted it outright. `-webkit-touch-callout: none`
  in `globals.css` stays for older WebKit, which suppresses the callout without
  firing the event at all — a prefixed property that is inert elsewhere, not a
  platform branch.
- **Nav drag lens** (`PillBarContent` in `components/nav-pill.tsx`, `.PillDragLens*`
  in `globals.css`) — an iPadOS-tab-bar-style **hold-and-slide** over the pill
  tabs. A plain tap still navigates (10px slop before it activates; a
  capture-phase guard swallows the drag's synthesised click). Rendered through a
  **portal** to `document.body` (fixed-position, so it can overhang the pill,
  which clips its own overflow). While a drag is active the real gravity blob is
  hidden (`hidden` prop) and only the tab under the lens pre-highlights.
  - **Shape:** a horizontal **stadium** (`LENS_PAD_X` keeps it wider than tall
    over narrow tabs) that **overhangs** the pill top/bottom (`LENS_OVERHANG`).
    **Clamped** to the first/last tab centres so it never leaves the tab strip;
    finger travel *past* an end tab becomes `overshoot`.
  - **Refraction (`-refract`):** a CLIPPED COPY of the whole glass pill, laid
    exactly over the real one and **squeezed on ONE axis** about the LENS
    CENTRE — `scaleY(LENS_SQUASH)` — so inside the lens the control is
    **shorter, not smaller**. The row inside the copy is counter-scaled by
    `1/LENS_SQUASH`, so the labels keep their true size and shape and nothing
    moves horizontally (the copy stays aligned with the original and the lens
    edge reads as continuous). Engine-independent by construction: composited
    transforms, no filter, nothing to rasterise. The copy is re-cloned when the
    lens crosses to another tab so its pre-highlight matches.
    A uniform `scale(0.82)` came first and shrank the text too — that reads as
    a minifying lens held above the bar, not as glass resting on it. How far
    the squeeze can go is set by the CONTENT: the counter-scaled row must still
    fit the copy's box (the pill's true height), and the mobile pill's 44px tab
    item in a 56px bar caps it at ~0.84. At 0.72 the icons and labels were
    clipped away by the copy's own edge.
  - **The layer COVERS the pill it duplicates** — `-refract` carries the page's
    own background, or you see the original and the copy at once and it reads
    as a ghost. A blur can't do that job: the lens is portalled to `<body>` and
    carries its own `scale`, so it forms a backdrop root and **its
    `backdrop-filter` never samples the pill at all** — verified, `blur(10px)`
    there leaves the label underneath perfectly sharp.
    A version that CUT the pill instead (a mask on `.GlassContainer` driven per
    frame, so the live page showed through around the squeezed copy) was built
    and rejected on the look. If it is ever revisited: the cut has to stay
    inside the lens's stadium at the pill's top/bottom edge or it takes bites
    out of the bar, the copy needs the exact complementary mask so the two
    crossfade, and `data-lens-hole` must be stripped from the CLONE (cloneNode
    copies the attribute and the inline offsets, so the copy came through with
    the same band missing).
  - `.PillDragLens-refractCopy` paints its own face and hairline: a
    backdrop-filter inside a clipped, transformed layer has almost nothing to
    sample, so the cloned glass alone came out barely 10% lighter than the
    scrim and the pill's outline vanished inside the lens.
    The copy also carries the pill's **live press transform** (read off
    `style.transform`, which framer wrote this frame — no style flush). Without
    it the copy sits at the pill's resting size while the original is bloomed
    ~4.5% larger, and the labels visibly double at the lens edge.
  - **Material:** `.PillDragLens-glass` on every platform — layered shadows for
    the convex bulge plus an inner thickness vignette that fakes the pinch, and
    a chromatic-dispersion `.PillDragLens-rim` for the liquid fringe. The
    Chromium-only real-refraction layer went with the rest of the SVG glass: it
    rebuilt and PNG-encoded a displacement map every time the finger crossed to
    another tab, which is main-thread work in the middle of a gesture.
  - **Liquid edge bounce:** `overshoot` past an end tab compresses the lens into
    the wall (`squishX`↓ `squishY`↑) and strains it toward the finger (`nudgeX`)
    via **very underdamped** framer `useSpring`s (`SQUISH_SPRING`); leaving the
    edge / releasing lets them wobble back. The deform is written to the lens
    `transform` **imperatively** (its React className stays constant so drag
    re-renders can't strip it); the pop-in uses the separate CSS `scale`
    property, so the two never fight.
  - **Drop-splat settle — compositor only.** On release the lens rides the
    standalone CSS `translate` (a transition, **no-overshoot ease** — it must
    never spring left/right) and `scale` (a **keyframe** animation,
    `pill-lens-splat`). The shape has to be keyframed: a transition can only
    overshoot both axes together, which reads as the blob growing past its size
    and coming back. Squash-and-stretch needs the axes to go OPPOSITE ways —
    wide+flat on impact (timed to land with the translate), then narrow+tall on
    the rebound, then neutral. `scale` is a composited property, so the
    keyframes run on the compositor exactly as the transition did.

    **It is a SETTLE, not an impact.** The deformation is ±5% (measured about
    the landing target: x 0.992–1.053, y 0.958–1.009) over 560ms, where it was
    ±14/16% over 420ms. At that amplitude the landing announced itself — the
    blob visibly splatted and bounced, which is a different EVENT from the one
    before it (a bead of glass sliding along the bar). A settle is the same
    motion ending, so the shape only has to acknowledge the arrival. The axes
    still go opposite ways and the rebound stays a third of the squash so it
    comes to rest rather than oscillating.

    **The lens DISSOLVES onto the real blob; it does not become one.** It used
    to paint its own copy of the highlight (`.PillDragLens-blob`) and crossfade
    the glass to it — and that fill sat ON TOP of the tab, so the landing
    flashed a solid pill with no icon and no label in it before the real blob
    appeared underneath. (It was also the wrong colour for a while: a stale
    `foreground/10` left over from before the blob became
    `--on-glass-active`, so the lens landed grey and then turned orange — two
    arrivals.) That layer is gone.

    Instead the REAL blob is revealed on release — `hidden` is now only true
    while the finger is DRAGGING — and it fades up over 0.34s at the
    destination, *behind* the row, where a highlight belongs. The glass then
    fades off it (delayed ~0.22s so the bead stays glass for the whole travel).
    Because the lens is translucent throughout, the icon and label are never
    covered. Measured through a landing: blob 0.00 → 0.96 by 250ms while the
    glass is still 0.92, glass down to 0.03 by 485ms, lens unmounted at 647ms.

    A timer (must outlast the scale's rebound — 620ms against the 560ms
    animation) unmounts the lens.

    There is no arrival wobble on the handoff any more, and the `settleKey`
    prop that drove it is gone. It existed to cover the hard cut when the
    opaque copy was swapped for the real blob; with the crossfade there is no
    cut, and a wobble after everything has come to rest reads as a second
    arrival.
    This used to be framer `animate()` on `left`/`top`/`width`/`height` and it
    **janked**, for two independent reasons. JS springs tick on the MAIN
    thread, and the release also fires `router.push` — so the landing competed
    with a route mount and stalled (the same reason the gravity blob is a CSS
    transition). And animating left/top/width/height is a layout pass plus a
    re-rastered `backdrop-filter` every frame on a box that is changing size.
    Four things keep it cheap now: nothing touches layout, `--settle` drops the
    glass's `backdrop-filter` outright (it is fading out anyway), the refracted
    clone is NOT re-cloned on release (`lensPhase` changes then too, so the
    clone effect is gated on `"drag"`, or a deep clone of the whole pill runs
    on the landing's first frame), and `--settle` **removes** `-rim` rather
    than fading it — `mix-blend-mode` cannot be composited on its own, so a
    blended child anywhere in the subtree keeps the WHOLE lens off the
    compositor and the landing re-rasterises every frame.
    The clone is also stripped of the pill's FIVE `backdrop-filter`s (and its
    ambient specular keyframe) when it is taken. Inside a clipped, transformed
    layer they have almost nothing to sample — which is why `-refractCopy`
    paints its own face at all — but they re-sample every frame the lens moves
    and they block layerisation. That is the single biggest cost the lens used
    to carry, during the drag as well as the landing.
    Do **not** put the settle back on a bouncy geometry spring (that was the
    left/right springing that got removed), and do not put it back on JS.

### The Action Surface — one look for everything you press

**A thing you press is a CAPSULE (or circle) on the control surface; a thing
you read is a rounded RECTANGLE on the card surface.** It used to depend on
where you were: glass capsules in the header, `bg-secondary` rounded squares
in the swipe panel, the `…` cascade and the context preview, bordered
`rounded-md` boxes for `Button`, accent-coloured LIST ROWS for panel actions.
In the context preview the action row was the same flat slab as the flight
card above it, so the owner could not tell the actions from the card.

| Where | Is |
|---|---|
| floating chrome over moving content (header, nav) | the real glass (`GlassContainer`) |
| everything else you press — swipe actions, the preview's actions, `Button` (`outline` / `secondary`), panel actions (`ActionRow`), error and notice buttons | `.control-surface` — a FLAT capsule on `--control`, the palette's third layer: no rim, no shadow, no `backdrop-filter` |
| the primary act among several (Restore, Reload) | `.control-surface-primary` — the selected-thing fill |
| delete / sign out | `.control-surface-destructive` |

- **THREE LAYERS, told apart by TONE (Nov 2026):** the ground
  (`--background`), the CARD on it (`--card`), and the CONTROL on the card
  (`--control`) — each a generated step from the one under it, in every
  palette (`palette.test.ts` pins card/ground ≥ 0.03 and control/card ≥ 0.06
  in oklch L). They measured 1.05:1 card-on-ground and 1.01:1 button-on-card
  in the light theme — white on white — so a masked conic rim and a drop
  shadow on every button and card were all that told them apart: the noise the
  owner asked to cut. Light is iOS's grouped look (white cards on a 0.962
  ground, grey controls below both). Cards carry a hairline border and NO
  shadow; the dashboard's blocks are solid `bg-card` (they were `bg-card/70`
  with a shadow, which belonged to no layer). The rim and the glass shadow
  stay only where a surface really FLOATS: `-float`, `.menu-surface`, the
  glass chrome. Measured at 4× on the logbook: the rim and the card shadows
  cost nothing either way — this is about legibility, not paint.
- **Two placements, two modifiers.** `.control-surface-inset` — set INTO a
  surface that clips (the swipe panel: the row has to clip, its content slides
  out of it) — drops the shadow, which the row's edge cut off into a grey band
  with a straight bottom on the light theme. `.control-surface-float` — over
  LIVE content (the context preview's actions, the `…` cascade) — is the
  glass's own translucent face: `--glass-base` + `--glass-veil` over the
  `.GlassBlur` filter list, ONE backdrop-filter on a 64px box. Painted opaque
  there, the circles stayed stark white while the header glass above them took
  on the dimmed list, which read as a different material. A `-float` control
  must FADE ITSELF: under an ancestor whose opacity animates (a backdrop root)
  its blur samples nothing until the fade ends and then snaps on.
- The shadow is the glass's own (`--glass-shadow`), not a hard black one.
- The surface lives in `@layer components`, so a call site's utilities still
  win. Unlayered it beat every Tailwind class, and the login page's outline
  button over the photo silently took the opaque face.
- `Button` is a capsule in every variant, and `sm` is `h-9`. `default` IS the
  primary surface and `destructive` the red one — the default used to be a
  solid accent pill, so there were two primaries for one job (Save Signature /
  Check Legality / Install beside Restore / Reload). `ghost` and `link` carry no
  surface, for a control with its own look (the login page's buttons on the
  photo). A dialog's buttons are `outline` + default, never a ghost inside a
  `GlassContainer` — glass over a flat dialog came out a near-black disc.
- The swipe buttons' pop spring is CAPPED at scale 1: they fill the row's
  height, so its ~10% overshoot sliced their tops and bottoms off at the
  panel's clip on every reveal.
- A panel's actions are `ActionRow` capsules in an `ActionStack`, under the
  content — not rows inside a `FormSection`.
- Kept as they are, on purpose: rows of a grouped list that OPEN something
  (settings sections, a time row) — they are navigation, not actions — and
  segmented tabs.

### Header controls — one capsule per role (`glass-icon-button.tsx`)

| Role | Controls | Capsule |
|---|---|---|
| Page switch | Legal / Summary | its own segmented capsule, FIRST |
| View | search, calendar, date range, period | one group |
| Tools | import, Quick Check, alerts, read-from-photo | one group |
| Create | + | ALONE, and LAST |
| Detail commits | Cancel, Save, Edit; Back | one capsule EACH |

It was decided page by page: the logbook put import with search and the
calendar, the roster put it with Add, the currencies page had Refresh and Add
as two loose buttons — so a grouping never meant anything. There is no
Refresh on any page any more (see Things to Avoid).

### Unified Settings/Form Layout

Flight, crew, and aircraft detail/forms share one visual system so they look
identical:

- **`components/ui/form-section.tsx`** — `FormSection` renders the grouped card
  (`rounded-xl bg-card border`) with an optional uppercase section header. Rows
  go directly inside and bring their own `px-4` (so dividers/actions span the
  full card width).
- **`components/ui/settings-row.tsx`** — shared `SettingsRow` / `ToggleRow` /
  `ReadOnlyRow` (`px-4 py-3.5`, inset `row-divider`). Editable `SettingsRow`s are
  swipe-to-clear (wrapped in `SwipeableCard variant="row" separated`). Inline
  inputs are styled to **blend** like the flight form's "Flight #" field —
  `border-0 bg-transparent dark:bg-transparent shadow-none rounded-none
  md:text-base` (no box, same font size in edit mode).
- **Crew dedupe:** `hooks/use-crew-form.tsx` (`useCrewForm`) owns all crew form
  state + persistence; `components/crew-form-body.tsx` (`CrewFormBody`) is the
  shared presentational body. `components/crew-detail-panel.tsx` (desktop panel,
  glass actions) and `app/(app)/crew/[id]/page.tsx` (full page, incl. "new"
  mode) are thin chrome wrappers around them — navigation is delegated via the
  hook's `onSaved` callback.
- The flight form (`components/flight-form.tsx`) keeps its own inline row
  primitives and complex auto-save/calculation logic, but its `SwipeableRow`
  wraps the shared `SwipeableCard` and its rows use the same `.row-divider`.

### Readability and Touch Targets

**Accessibility is measured, not assumed** — axe-core over every route plus an
open flight, both themes (Nov 2026: zero violations). What it took:

- **Pinch-zoom is allowed** (WCAG 1.4.4) — the viewport no longer sets
  `maximumScale: 1` / `userScalable: false`. Every text field is ≥16px on a
  phone so iOS never zooms on focus, `<html>` carries `touch-action:
  manipulation` so a double-tap does not zoom, and the FDP chart keeps its own
  pinch (`touch-action: pan-x pan-y`).
- **Red text is not red fill** — `text-destructive` reads `--destructive-text`
  (4.5:1 on a card and on the red-tinted notices); `--destructive` is the fill
  under a light label. The pending badge sits on `--status-pending-fill`.
- **The accent clears 4.5:1 on a control and on a tint of itself** (the
  generator checks `--control` and an accent tint as well as the cards).
- **No button inside a button.** A row that holds its own controls (a time
  row's clocks and NOW, an hour row's USE, a crew card's star) is a plain tap
  target, and a control inside it — the UTC clock, the label, the name block —
  is the keyboard's way to the same action.
- **A modal the app draws itself takes focus IN and gives it BACK**
  (`useDialogFocus`, `hooks/use-dialog-focus.ts`) — the date and time
  wheels (onto the first wheel, which takes the arrow keys), `RegionSheet`
  (onto its close button, never a field: that would raise a phone's
  keyboard), the context preview and the signature pad. They carried
  `role="dialog"`/`aria-modal` but left focus on the row behind, Tab walked
  the page underneath, and closing dropped it on `<body>`. Focus moves a
  frame after the open paints, Tab wraps inside, and focus in a layer the
  dialog opened (an option menu, portalled above it) is left to that layer.
  NOT `inert` on the page behind: toggling it restyles the keep-alive stack
  (~1,400 elements) on the frame the dialog opens.
- **Placeholder and secondary text is `text-muted-foreground`, never a
  fraction of it** — the wheels' unselected rows and the date/time rows'
  `--:--` were `/50` (2.4:1); a struck-through old value keeps the muted
  colour and dims only its line.
- **Every focusable thing shows focus** — a zero-specificity `:focus-visible`
  ring in the base layer for anything that draws none of its own.

- **Every control a thumb has to hit is at least 36px** (`h-9`). Where a row
  must keep a fixed height (the virtualised lists' favourite star, a search
  chip), grow the HIT AREA with an `after:` pseudo-element on the
  `relative` control instead of the box — the logbook depends on every card
  being one height.
- **Labels are Title Case** — a row's label, an option, a section title, a
  tab, a button: "Pilot Flying", "New Flights Start As", "Add Duty", with
  short articles and prepositions lower inside ("Add a Duty", "Nothing to
  Compare"). Helper text under a label and a question in a dialog are
  sentences. Helper text is ONE short line where it can be ("Prefixes flight
  numbers: 288 → TR288.") — the label already names the thing.
- **A switch's ROW is the control** (`ToggleRow` is a `<label>` for its
  switch, in Settings and the flight form alike): only the 32×18 switch took a
  tap. The switch is 24×40 with a track you can see OFF (`foreground/15`, `/25`
  dark) — at `--input` it was ΔL ≈ 0.01 on a dark card, a white knob floating
  at the row's end.
- **Settings › Display asks two questions, one row each** — Clock (24-hour
  14:30 / 1430, or 12-hour) and Durations (2:30 / 02:30). The stored fields
  split them differently (`timeFormat` holds the 12-hour clock AND padded
  durations, `clockSeparator` the colon), so the rows are derived: a 12-hour
  clock has no padded durations in that model, and Durations says so.
- **A flight selected from ELSEWHERE is brought into view in the logbook
  list** (`revealFlight`, once per selection) — a note's Open flight or a deep
  link lit a row the tablet's list had not scrolled to.
- **A picker says it is one.** The flight form's Aircraft / From / To / crew
  rows open the Aircraft, Airports and Crew pages in select mode; they looked
  exactly like the tabs, with the tab's title and no way back but the system
  gesture. In select mode the title is the question ("Choose Aircraft",
  "Choose Departure", "Choose PIC", "Choose Relief Pilot") and Back to the
  flight leads the header.
- **NOW is for a time that HAPPENS** (Report, OUT, OFF, ON, IN) — not for
  Scheduled Out / In, which are published, not stamped — **and only on a
  flight dated within a day of today** (`isWithinADayOfToday`, on the UTC
  date the flight is keyed on; ±1 covers a duty across midnight and a local
  day that is not the UTC one). Five NOW buttons stood down a flight from
  last March, each offering to stamp this minute onto it. Five NOW buttons ran
  down an empty form. An empty row with no NOW shows its one `--:--`, not a
  second one under the zone's name.
- **Every new record names itself the same way**: New Aircraft is a
  `DetailFormPanel` like New Duty and New Currency (it was a bare scroller with
  no title), and New Airport carries the same title (`NewAirportPanel` —
  its actions are the form's own, so it is not a `DetailFormPanel`), and a helper line says something only once there is something to
  say ("Not found online…" read over an empty field).
- **A short code field is sized to its code** (`SettingsRow`'s `maxLength`):
  a text input claims ~200px, which squeezed the Airline row's helper text
  into a narrower column than every other row's.
- **A licence-record choice is readable on BOTH sides.** `OptionPair` and the
  import card's role chooser were 8–11px with the unselected side at 45%
  opacity — the value a pilot may want back was the one they could not read.
  Values are `text-xs`/`text-sm`, captions `text-[10px]`, the unselected side
  plain `text-muted-foreground`.
- **A flight-form row that opens something is a button** (`pressableRow`:
  `role="button"`, `tabIndex`, Enter/Space, an accessible name), so the form
  can be driven from a keyboard. A row with its own inner button (NOW, USE)
  stops that button's keydown from bubbling to the row.
- **A time row edits EITHER clock.** The UTC column (and the rest of the
  row) opens the picker in UTC; the local column opens it in the airport's
  time (`TimePicker`'s `frame`). The picker always takes and returns UTC
  (`utcToLocal` / `localToUTC`, exact inverses at every offset, half hours
  included) and shows the other clock live under NOW, so each checks the
  other. Clock only — the flight's date is not moved by a local edit, the same
  as a UTC edit. `formatTimezoneOffset` names a half-hour zone `UTC+5:30`.
- **A time row's local column falls back to the offset the flight STORES**
  until the airport lookup lands. Defaulting to 0 while it was pending — every
  open on a new install, while the airport table seeds — drew the local column
  as a second copy of UTC, and a local edit made then was stored as if it
  were UTC.
- **The form's overrides are STATE, and they follow the row.** Saves and every
  recalculation read the `manualOverrides` state, never the copy on the form
  data — so anything that changes a pin (the entry-type switch, a pin made on
  another device and pulled) must change the state. Written only to the copy,
  a simulator switched to a flight kept its 00:00 night pin, and a pulled pin
  was recomputed and sent back over on the next OUT/IN edit.
- **Remarks is an inline auto-growing textarea**, not a `prompt()` — a native
  prompt is a one-line box with no preview of what is already there.
- **A choice among a few is the app's own MENU** (`ChoicePicker` +
  `OptionMenu`, `components/ui/option-menu.tsx`) — every `SelectRow`
  (Settings, the duty and currency forms), the flight form's Pilot Role, an
  approach's type, an additional crew member's role, the signer. A native
  `<select>` laid over the row opened a different control on every device
  (the wheel on iOS, a sheet on Android, a plain list on a desktop) and like
  nothing else in the app; a Radix Select before that was a web dropdown in a
  corner. The menu hangs off its control on the glass face (`.menu-surface`),
  one 44px row per option with a check on the chosen one, flips upward when
  there is no room below, takes the dismissing tap on a scrim, closes on
  back/Escape (`useBackDismiss`) and applies the choice as the dismissal's
  follow-up. The trigger is the WHOLE row, and its accessible name carries the
  value ("Pilot role: P2"). A record holding a value the list lacks (LogTen's
  "VISUAL" approach) keeps it as an option rather than showing nothing.
- **The camera button offers Take Photo / Choose Photo** (`PhotoSourceMenu`,
  the app's menu face) over TWO inputs — one with `capture="environment"`, one
  without. A single input with no `capture` was meant to bring up the OS sheet
  with both, and on iOS it does, but Android 14+ answers `image/*` with its
  Photo Picker, which has no camera: the pilot could only choose a photo. Each
  row is a `<label>` for its input, so the picker opens as the tap's own
  default action — iOS opens a file input only inside the gesture, and a
  choice applied after `OptionMenu`'s history round trip is outside it.
- **No `alert()` for a form error** — an inline `role="alert"` line in the
  dialog, cleared when it closes. And no browser `confirm`/`alert` anywhere:
  a question that must be answered goes through `appConfirm` / `appAlert`
  (`lib/utils/app-alert.ts`, rendered by `AppAlertHost` in the ROOT layout so
  the login page has it too). The browser's dialogs carry the site's ADDRESS
  as their title in an installed PWA, block the page while open, and were
  asking the most consequential questions in the app (unsynced edits lost on
  sign-out, another account's data on sign-in). A destructive question starts
  focused on the safe answer.
- **A date or time in a form is the app's wheel picker** (`DateRow` / `TimeRow`, the flight form's
  `DatePicker`), never `<input type="date">` — that is the browser's control,
  boxed "mm/dd/yyyy" in the browser's locale beside lists reading "Mar 14,
  2027". The picker's years span the window around today AND the year being
  edited (`pastYears`/`futureYears`); a fixed ±5 had no row for a migrated
  2011 flight or a 2034 passport. Back, the default is a whole career (70
  years) — a pilot back-filling a paper logbook could not enter a flight from
  twenty years ago at all.
- **A flight field is named through `flightFieldLabel`** (`lib/utils/field-labels.ts`)
  wherever a pilot reads it — the resolve sheet, the comparison cards, the
  import card (hour categories ask `TIME_CATEGORIES` first). Each surface kept
  its own short list, so anything off it reached the screen as "outTime".
  The FDP Quick Check's date/report/debrief are wheel-picker fields too; its
  times are UTC and the field says so.
- **Every input has a label bound to it** (`htmlFor`/`id`, `useId` where a
  component can appear twice), and the login callsign carries
  `autoComplete="username"` with auto-capitalise and autocorrect off (the
  server matches callsigns case-insensitively).
- **A flight that is not there SAYS so.** The flight form's live query returns
  `null` (not `undefined`) once it has answered "no such row", so a missing
  flight reads "Flight not found" and a binned one "This flight is in Recently
  Deleted" with a way there — instead of an empty panel forever.

### KeepAlive Navigation

Four heavy pages are kept mounted across navigations for instant tab-switching and scroll preservation:

**Persistent pages** (`components/keep-alive-pages.tsx`):
- `/` (dashboard), `/logbook`, `/aircraft`, `/airports`, `/crew` — the primary tabs (the roster is the logbook with its duties on), lazy-imported via `React.lazy()`, mounted on first visit, never unmounted. The one list lives in `components/keep-alive-routes.ts`; `PERSISTENT_PAGES` is typed against it
- All other pages (currencies, discrepancies, settings, account, …) unmount normally via Next.js `children`

**How it works:**
- `KeepAlivePages` wraps `children` in `app/(app)/layout.tsx`
- Persistent pages are stacked with `position: absolute; inset: 0` inside a relative container
- Active page: `visibility: visible`, `pointer-events: auto`, `z-index: 1`
- Inactive pages: `visibility: hidden`, `pointer-events: none`, `z-index: 0`
- `bg-background` on each container prevents one-frame overlap flash during transitions
- Focus management: blurs any focused element inside a hidden page on route change

**Why `visibility:hidden` not `display:none`:**
`display:none` removes elements from layout, resetting `scrollTop` to 0 and breaking `@tanstack/react-virtual` measurements. `visibility:hidden` keeps elements in the layout tree, preserving scroll positions and container dimensions.

**Why not cache Next.js `children`:**
Next.js wraps pages in internal `LayoutRouter` components that unmount contents on navigation — caching the element tree doesn't prevent remounting.

**`usePageActive(routeKey, onActivated?)` hook** (`hooks/use-page-active.tsx`):
- Each persistent page calls this to detect when it becomes the active route
- Returns `isActive` boolean
- Fires `onActivated()` callback only on inactive→active transitions (not initial mount)
- Used to re-sync detail panel content when returning to a page
- **The active route is a STORE read through `useSyncExternalStore`, not a value
  in context.** As a context value it re-rendered every consumer on every
  navigation — six permanently mounted pages, of which at most two have an
  answer that changed. The snapshot is the BOOLEAN `isActive`, so the
  comparison happens inside the subscription and React skips the four pages
  still answering `false`. Same shape as `useDBReady`/`useIsDesktop`. The
  provider publishes on COMMIT (an effect), because a store read during render
  must return what React last rendered with or `useSyncExternalStore` tears
- The two together are also what makes the SIDEBAR toggle cheap. `AppShellContent`
  reads `useSidebar()` and renders `KeepAlivePages` as its children, so opening
  the sidebar re-rendered the shell and, through it, all six pages — Recharts
  trees and the virtualised logbook included — on the first frames of the 300ms
  pill↔sidebar morph. That is now the shell, `KeepAlivePages` and six wrapper
  `div`s.
- **`KeepAlivePage` is `memo`ized on its route key.** The stack recreated
  `<PageComponent />` on every navigation, and a new element is a re-render
  however unchanged the props are — so the context fix alone would not have
  helped. The wrapper `div` still re-renders (its visibility and z-index really
  do change); the page inside it does not
- **A hidden page HOLDS its data** (`useHeldWhileHidden`, inside
  `KeepAlivePageScope`). `useFlights`, `useScheduleEntries`, `useCurrencies`,
  `useAircraft` and `usePersonnel` return the value they had when their page
  was LEFT while it sits behind another tab, and the live value again the
  moment it is shown. Every retained page reads the same hooks, so adding a
  flight on the logbook used to re-run the hidden dashboard's whole legality
  model — FDP pipeline, duty status, recency — inside the tap (measured at 4×
  on 1,200 flights: ~2.07s of main-thread work → ~0.86s). Outside a keep-alive
  page (the detail panel, the shell, ordinary routes) it is the identity. Hold
  SWR's RAW `data`, never `data ?? []`: a fresh default per render never equals
  the held value and the render-phase update loops — the hooks return a shared
  `NONE` for "no data yet" for the same reason

**Detail panel integration** (`hooks/use-detail-panel.tsx`):
- The keep-alive route set lives in ONE registry — `components/keep-alive-routes.ts`
  (`KEEPALIVE_ROUTES`, with a `hasDetailPanel` flag per route). `keep-alive-pages.tsx`
  types its `PERSISTENT_PAGES` map against it (compile-checked) and
  `use-detail-panel.tsx` derives `KEEPALIVE_DETAIL_ROUTES` from it — do not
  reintroduce parallel hand-maintained route lists (they drifted once already)
- **The provider's route-change reset never clears the ARRIVING page's
  content.** It is a PARENT effect, so it runs after the arriving page's own
  mount effect has set that page's panel — and used to wipe it: re-entering
  Settings showed "Select an item to view details" over a remembered section.
  `setDetailContent` records which base set the content (`contentOwnerRef`,
  read from a ref the provider updates in a layout effect, so it is current
  before any passive effect), and the reset skips content the new route owns
- **Leaving a page that is NOT kept alive demotes its selection** to a
  remembered one (`explicitBases[prev] = false`). It unmounts, so nothing
  re-syncs `?selected=` for it on return; an overlay reopened from the
  explicit flag alone had no history entry, and on a phone the next back
  gesture left the page instead of closing the section. Desktop still fills
  its panel from the remembered selection; the phone opens on the list
- `DetailPanelProvider` does NOT clear `detailContent` when navigating between two
  keep-alive routes that own detail content; routes without a detail panel
  (the dashboard) always clear it
- Each persistent page re-syncs its detail panel via its `usePageActive` callback (`syncDetailPanel`)
- Selections stored in `sessionStorage` for restoration across full page reloads
- `setSelectedId(id, { explicit: false })` is for **programmatic** selections
  (e.g. settings auto-selecting a section to fill the desktop panel): it skips
  the `?selected=` URL write and the explicit-selection flag, both of which
  would auto-open the full-screen mobile overlay when the viewport crosses
  below 720px (iPad Split View / resize). Only real user taps use the default
  explicit path
- **A detail opened FROM ANOTHER PAGE goes back to that page** (`backFromDetail`,
  the phone overlay's Back). The crew card's "Seat and logged role" opens
  `/settings?selected=logging`, a note's Open flight `/logbook?selected=<id>`;
  Back used to close the detail onto THAT page's list — Settings, the logbook —
  a parent the pilot never visited. The provider marks a base arrived at with
  `?selected=` already in the URL from a top-level page (`arrivedBaseRef`; a
  redirect route like `/flights/<id>` is not one, and may be the session's
  first entry), and its Back is `router.back()`, clearing that page's
  selection so a kept-alive tab does not reopen the record later. Only the
  Back button: a programmatic close (a delete, a cancel) stays on the page
- **System back undoes the last move.** OPENING a detail — meaning `?selected=`
  is not already in the URL — PUSHES it (`history.pushState`, see below); the param going away again is
  what closes it. "Is a detail open" must be read off the URL, NOT off the
  stored selection: a section remembers its last selection in state and
  sessionStorage while the detail is closed, so keying off that made the first
  tap after a reload look like switching items. And the re-sync effect below
  must stand down while a write is in flight (`pendingUrlWriteRef`) — it runs
  on the state change from the same tap, before the router has updated the
  params, so it wrote `?selected=` again with `replace` and landed on top of
  the `push`, erasing the entry.
  That is what makes Android's edge-swipe (and the browser Back button) return
  from an open flight to the logbook instead of skipping the section entirely —
  it used to `replace`, which writes no history entry at all. Switching between
  items still `replace`s (a push per tap would turn Back into a tour of
  everything you looked at), and the in-app close calls `router.back()` when we
  own the current entry, so it is consumed rather than left as a dead press.
  Two guards make it safe: leaving the section is not treated as a close (it
  drops `?selected=` too, and acting on that wiped the section just arrived
  at), and the "re-sync `?selected=` into the URL" effect bails while a
  back-clear is in flight — it runs in the same commit and would otherwise put
  the param straight back and refuse to close

**Provider hierarchy:**
```
AppLayout → PreferencesProvider → SidebarProvider → DetailPanelProvider
  → PageActionsProvider → DashboardPeriodProvider → AppShell → KeepAlivePages
    ├── /, /logbook, /aircraft, /airports, /crew (lazy, persistent)
    └── children (other routes, normal unmount)
```

**Every provider above `KeepAlivePages` must give a MEMOIZED value**, because
its subtree is all six keep-alive pages at once — a fresh `{...}` per render
re-renders every one of them. `PageActionsProvider` goes further and is **two**
contexts: the registered action nodes (which change on every tab switch, and
are read only by the shell's header) and the SETTERS (which never change, and
are all the register hooks need). Held together, one page registering its
buttons re-rendered the other five.

### Settings are the USER's; only the look is the device's (`lib/settings/user-settings.ts`)

Preferences used to be one IndexedDB row per DEVICE, so signing in on a new
phone meant every setting at its default, and the logbook was read and logged
differently on each device. Now they are a synced collection, **`settings`** —
one record per user, id `"settings"` — through the same engine as everything
else. Only the theme, the palette and a custom palette stay on the device
(`DEVICE_DISPLAY_KEYS`, in the `"device"` preferences row, which signing out
does NOT clear: the next person is looking at the same screen).

| | Rule | Why |
|---|---|---|
| shape | FLAT — one field per preference (`display_timeFormat`, `autoFill_night`, `duty_minutesBeforeOut`, `logging_pfRole`, `favoriteAircraft`) | the engine merges per field; a `display` OBJECT would let one device's clock-format change send its whole group back and revert another device's |
| sparse | an unset key is `null` on the server and absent on the client, and reads as the default (`resolveSettings`) | a default written down is indistinguishable from a choice |
| writes | only keys whose value MOVED (`settingsPatch`), always as an UPDATE patch from the row's base — base 0 with no row (`writeSettings`); the server inserts it if the account has none | a new device at its defaults states nothing, so it cannot overwrite the account |
| keys | derived from each group's DEFAULT object (`GROUPS`) — add a preference to a default and it is a synced field | one place to add one |
| upgrade | `migrateLegacyPreferences` carries the old per-device row up ONCE, after a complete pull (`knownSeq`), seeding only non-default choices the account lacks, then deletes it | two upgraded devices merge instead of the second overwriting the first |

`getUserPreferences()` still returns the one familiar shape (synced settings +
the device's look); `saveUserPreferences()` splits a save between the two. The
provider reloads the synced half on `onDataChanged`, so a change on one device
reaches the others' screens, and skips that while its own save is pending.

### One way to write a day (`lib/utils/date.ts`)

Every date a pilot reads is **`Fri, 27 Nov 26`** — weekday, day, month, two-
digit year (the owner's choice, Nov 2026) — through `formatDay` (a stored
"YYYY-MM-DD"), `formatDayAt` (an instant, on the calendar of a zone or the
device) or `formatStamp` (when something happened: `Fri, 27 Nov 26 14:05`). Half
the app read "Nov 27" and half "27 Nov": the flight form, the roster, the FDP
page, the dashboard and the Bin each built their own `Intl.DateTimeFormat`, in
`en-US` or `en-GB` or the device's locale.

- Where a context makes a part redundant or there is no room, a part is
  DROPPED, never reordered: `27 Nov` on a chart axis or a caption, `Fri, 27 Nov`
  in the Quick Check (it looks days ahead), `16 Oct – 6 Nov 26` never — a range
  inside one year carries no year, across two each end carries its own
  (`formatDayRange`: `1 Nov – 30 Nov 26`, `28 Dec 26 – 3 Jan 27`).
- The parts are put together by hand, not by a locale: `en-GB` and `en-US`
  disagree on order and comma, and Node's ICU and a browser's can disagree with
  each other, which is a hydration mismatch.
- The logbook card's stacked `27 / NOV 26` and the calendar's month labels are
  the same order already and stay as they are.

**A rest's length reads the same everywhere** (`formatRestSpan`,
`duty-status.ts`): `10:42` under 100 hours, `21d 6h` from there. The dashboard
printed `510:13` where the FDP page printed `21d 6h` — and the FDP chart's own
rest label and rest detail then still wrote `200:05/12:00`; they go through it
too (with the pilot's duration format under 100 hours), and a rest that long
drops the `/minimum` it passed days ago. On the dashboard's duty band the
middle cell is captioned `Min 12:00`, not `Of 12:00` (a span beside a
requirement is not a fraction of it), and the first cell is ONE clock:
`08:05Z` over `REST FROM 2 NOV`, not over a second clock (`ENDED 07:05Z`).

**The four rolling limits have one name each**: Duty 14d, Duty 28d, Flight 28d,
Flight 12m — on the dashboard's limits band, the FDP page's tabs and the Quick
Check alike (they were "1y", "12M Flight" and "12mo Flight"). The dashboard's
figure and the FDP page's may differ by hours: the dashboard counts whole UTC
days, the timeline the continuous 24-hour windows ending at its pointer (see
"Rolling windows are whole UTC DAYS" and "The FDP page").

### Display Preferences

`DisplayPreferences` (`types/db/stores.types.ts`) drives formatting app-wide.
Two of them are easy to conflate:

- **`timeFormat`** — how a **duration** is written (`2:30` / `02:30` / 12h).
  `formatHHMMDisplay`.
- **`clockSeparator`** — how a **clock time** is punctuated: `02:30` vs `0230`.
  `formatClockDisplay`.

A duration always keeps its colon regardless of the setting, because `400`
cannot be read as four hours. Anything showing a point in time (out/off/on/in,
the sun timeline, the flight form's time rows) must go through
`formatClockDisplay` so one setting governs the whole app.

`airportIdentifier` (`icao` / `iata` / `both`) goes through
`getAirportDisplayCode` — which needs BOTH codes populated on whatever it is
given, or it silently falls back to the other one.

### Palettes (`lib/theme/`)

The colour is DATA, and the pilot chooses it: six presets (**Graphite** —
the default — **Horizon**, **Night Ops**, **Classic**, **Evergreen**, **Dusk**)
plus **Custom**, all in Settings › Appearance beside the light/dark/system mode.
The two are orthogonal: a palette has a light and a dark half.

**ONE generator.** A palette is a `PaletteSeed` — accent hue + vividness, the
hue the greys lean toward + how far, and how deep the dark ground is
(`dim`/`deep`/`black`). `generatePalette(seed, mode)` builds every surface and
text token from it. Presets are named seeds and Custom is a seed the pilot
edits, so none of them can come out unreadable: the generator moves the
accent's lightness until it clears 4.5:1 on every surface it lands on, keeps
muted text at 4.5:1 and body text at 7:1, and pulls out-of-gamut colours in
by CHROMA rather than letting the browser clip a channel.
`palette.test.ts` pins all of that for every preset in both modes AND for a
sweep of custom seeds across the whole hue circle at every depth.

| What a palette owns | What it does not |
|---|---|
| background, cards, popovers, secondary/muted/input/border, the sidebar, foregrounds, `--primary`, `--ring`, `--chart-1` | the status ramp (met/close/caution/not met mean the same in every palette), `--destructive`, the other chart series |
| | the glass: `--on-glass` / `--on-glass-active-fg` are DERIVED from `--card` / `--primary` with `color-mix`, so they follow any palette |

**Every dark half is night-adapted**: a ground at or below L 0.17 and text a
dimmed off-white (never `#fff`) — a large bright field is what costs a pilot
their dark adaptation. Night Ops is the extreme: a `black` ground and a red
accent.

**Offline by construction — nothing is fetched.** `applyPalette`
(`lib/theme/apply.ts`) writes the generated CSS into ONE
`<style id="oooi-palette">` and into localStorage; `PALETTE_BOOT_SCRIPT`,
inlined in the root layout's `<head>`, puts it back before the first paint on
the next launch, so a cold start shows the chosen palette rather than
flashing Graphite. localStorage holds the RESULT (CSS + the grounds' hex), so
the boot script needs no generator. The preference itself (`display.palette`,
`display.customPalette`) lives in the preferences row in IndexedDB, per
device.

- **The stylesheet wins on SPECIFICITY, not order** — `html:root` /
  `html.dark` against globals.css's `:root` / `.dark` — so it does not matter
  where the `<style>` lands.
- **globals.css carries the DEFAULT palette, generated.** The two blocks
  marked `palette:light` / `palette:dark` are Graphite exactly as the
  generator builds it, and `palette.test.ts` fails if they drift: they are what
  renders before a palette is applied, so a mismatch is a first frame in a
  different colour. Change a colour in the generator or a seed, then
  regenerate those blocks — never hand-edit them.
- **The provider applies the palette only once preferences have LOADED.**
  Before that the boot script has already painted the last palette; applying
  the in-memory default over it flashed Graphite on every launch.
- **The custom editor previews LIVE on the whole app** — rAF-batched
  `applyPalette` while a slider moves — and commits to the preference 400ms
  after it settles. Committing per step re-rendered every consumer of the
  preferences context at slider rate.
- **The status bar follows the mode actually on screen, live.** The boot
  script creates the ONE `<meta name="theme-color">` and keeps it on the
  current mode's ground through a MutationObserver on `<html>`'s class
  (`DEFAULT_GROUND` before any palette is stored; `syncThemeColor` re-runs it
  for a new palette). Two bugs it replaces: the tag came from the layout's
  `viewport.themeColor`, and Next put that static pair (keyed to the OS's
  dark/light) back on every client navigation, so a light-theme pilot on a
  dark-mode phone got a dark bar on every page after the first; and the sync
  ran in the preferences provider's effect on `resolvedTheme`, which runs
  BEFORE next-themes' own effect sets the class, so it read the old mode and
  the bar only changed on the next launch. `public/manifest.json` and
  `public/offline.html` still carry Graphite's values. (An installed iOS app
  ignores theme-color: `black-translucent` draws white status-bar text over
  the page, read once at launch.)
- **A preferences row with no mode in it is NOT "dark".** The provider takes
  the mode next-themes is actually showing; holding the in-memory default meant
  the first unrelated setting saved (choosing a palette, say) wrote "dark" into
  the row and the next launch flipped a light-mode pilot to dark.

Scheduled (unflown) flights are drawn in the accent (`text-primary` on the
logbook card and the calendar bar): planned is the accent, whatever it is. The
text says it; the card carries no accent BORDER as well (the owner: a flight
still to fly does not need one). Their SECONDARY text
(month, aircraft, flight number) is `.text-primary-muted`, the accent mixed
toward `--muted-foreground` — never the accent at a fraction of its opacity,
which let the card through at 3.6:1.

### State Management

| State Type | Mechanism |
|---|---|
| Persistent user data | Dexie (IndexedDB) |
| Server cache | SWR with Dexie fetcher |
| Auth & sync status | React Context API |
| Transient UI state | React useState |
| URL-driven state | URL search params |

## Naming Conventions

| Kind | Convention | Example |
|---|---|---|
| Components | PascalCase | `FlightList`, `DutyEntryCard` |
| Hooks | camelCase with `use` prefix | `useFlights`, `useDBReady` |
| Functions | camelCase | `addFlight`, `fetchFlights` |
| Types/Interfaces | PascalCase | `FlightLog`, `Aircraft` |
| Constants | SCREAMING_SNAKE_CASE | `CACHE_VERSION`, `PRECACHE_ASSETS` |
| Component files | kebab-case `.tsx` | `flight-list.tsx`, `duty-entry-card.tsx` |
| Hook files | camelCase `.ts` | `useFlights.ts`, `use-db.ts` |
| Store files | kebab-case `.store.ts` | `flights.store.ts` |
| Type files | kebab-case `.types.ts` | `flight.types.ts` |

## Import Aliases

Configured in `tsconfig.json`:

```typescript
@/*            → ./*           // General alias
@/types/*      → ./types/*     // Type definitions
@/lib/*        → ./lib/*       // Utilities & services
@/hooks/*      → ./hooks/*     // Custom hooks
@/components/* → ./components/* // React components
@/config/*     → ./config/*    // Configuration
```

Always use these aliases instead of relative paths.

## Key Patterns

### Data Hooks

Data hooks in `hooks/data/` use SWR backed by Dexie:

```typescript
// Pattern: hook reads from Dexie, mutations write to Dexie + enqueue sync
const { flights, isLoading } = useFlights();
```

**`useDBReady` is a MODULE STORE**, read through `useSyncExternalStore` — the
same shape as `useIsDesktop`, and for the same reason. It used to be a
`useState(false)` plus an effect in every consumer, so every page that reads
data rendered once as "not ready" and again as ready, *even when the database
had been open since the first page*. That first render is what put a skeleton
on screen for a frame on every mount of every list, and five of them mount at
once. With one process-wide answer a page mounting after init has it on its
FIRST render and paints its data straight away. Its snapshot object is cached
and rebuilt only on a real transition (`useSyncExternalStore` compares by
identity and will loop forever on a fresh object).

### Forms

Forms use lightweight custom hooks (`hooks/use-crew-form.tsx`, `useDraft` for a draft over a live record) rather than a form library. Validation is hand-rolled where needed. There is no React Hook Form or Zod dependency.

### API Routes

Server-side routes in `app/api/` follow Next.js App Router conventions with `route.ts` files exporting HTTP method handlers (`GET`, `POST`, `DELETE`).

Notable route groups:

| Route | Method | Auth | Purpose |
|---|---|---|---|
| `/api/lookup/<route>` | GET | Yes (session or `x-lookup-secret`) | The gateway Worker's normalized routes (`airport` — the timezone as the source gave it, blank on its position-only tiers), EDGE (`lib/lookup/client.ts`; Node code: `lookupFromEdge`) |
| `/api/lookup/aircraft/candidates?q=` | GET | Yes | Every aircraft the text could be, each marked `exact` — the Worker's `/search`, then `aircraft/flights` for a whole registration search did not list; `exact=1` for that registration or 404 |
| `/api/lookup/airport/candidates?q=` | GET | Yes | Every airport a partial code (or a name) could be — the Worker's `/search` |
| `/api/lookup/flight/suggest?number=&date=` | GET | Yes | A flight number on a UTC date: that day's schedule (`basis: "scheduled"`) or its usual times (`"usual"`); `out=HH:MM` picks between two the same day |
| `/api/lookup/flight/gates?number=&date=` | GET | Yes | That flight's gates, terminals and belt — the tracked flight, else the airport boards; "" until published |
| `/api/lookup/airline/{fleet,routes,routes/from}?iata=` | GET | Yes | The Worker's airline routes passed through: fleet by type, every airport pair, one airport's destinations with flight numbers |
| `/api/lookup-test/<route>` | GET | No (OFF in production unless `LOOKUP_TEST_ROUTE=1`; a preview is behind Vercel's deployment protection) | The operator's test door, EDGE: every `/api/lookup` route without the sign-in, plus the Worker's `/probe` (`probe?explore=1`) run from where the APP runs — never `/raw` |
| `/api/lookup/pool/aircraft` | POST | No | The shared aircraft pool — enriched submissions, MongoDB (Node) |
| `/api/lookup/pool/airport` | POST | No | The shared airport pool — enriched submissions, MongoDB (Node) |
| `/api/submissions/aircraft` | POST | Yes | Submit custom aircraft for enrichment |
| `/api/submissions/airport` | POST | Yes | Submit custom airport for enrichment |
| `/api/enrichment/batch` | POST | CRON_SECRET (required) | Background enrichment of pending submissions; fails closed if `CRON_SECRET` is unset |
| `/api/timezone?lat=&lng=` | GET | No | Coordinate → IANA timezone via geo-tz |
| `/api/account/step-up` | GET | Yes | Issue a user-bound single-use WebAuthn challenge for step-up |
| `/api/account/totp/reveal` | POST | Yes (passkey step-up) | Reveal the TOTP seed + otpauth URI to re-add an authenticator |
| `/api/account/callsign` | PUT | Yes (passkey step-up **or** TOTP) | Change callsign |
| `/api/account/sessions` | GET/DELETE | Yes | List sessions (with device `userAgent`); revoke one (incl. current) or all |

### Console Logging

Debug logs use prefixed format: `[v0]`, `[Auth]`, `[SW]`, `[UserDB]`, `[Sync]`, etc.

## Configuration Notes

- **Webpack** is used explicitly (`--webpack` flag), not Turbopack
- **TypeScript build errors are ignored** (`ignoreBuildErrors: true` in next.config.mjs)
- **ESLint errors are ignored during build** (`eslint.ignoreDuringBuilds: true`) — lint runs only via `pnpm lint`, never blocking a Vercel deploy (mirrors the TS setting)
- **8GB heap** allocated for builds due to OCR model processing
- **shadcn/ui** uses the New York style with CSS variables and RSC support
- **Tailwind CSS v4** via `@tailwindcss/postcss` PostCSS plugin
- **Dark mode** is class-based via `next-themes`
- **`console.log`/`console.debug` are stripped from production bundles**
  (`compiler.removeConsole`, keeping `error`/`warn`) — don't rely on `console.log`
  side effects, and use `console.error`/`console.warn` for anything that must
  surface in production
- **FDP pipeline results are memoized at module level** (`hooks/data/use-fdp-data.ts`
  → `computeFDPResult`): the dashboard isn't keep-alive, so its `useMemo` dies on
  every navigation — the module cache (content key + 5-min time bucket) makes
  re-mounts a cache hit. Keep heavy computation + the cache write in that plain
  module function, not in the hook (render purity)
- **Fonts**: **Inter is the single app typeface** (sans + numbers), loaded via a
  Google Fonts `<link>` in `app/layout.tsx`; `--font-sans` and `--font-mono` both
  point to Inter. There is intentionally **no `font-mono`** in the app — use
  `tabular-nums` (Inter has tabular figures) for aligned numbers, not a monospace
  class.

## Linting

ESLint uses a **flat config** (`eslint.config.mjs`) that spreads
`eslint-config-next/core-web-vitals` **directly** — `eslint-config-next@16`
ships native flat-config arrays, so wrapping them in `FlatCompat` double-wraps
the plugins and throws a "Converting circular structure to JSON" error. `eslint`
and `eslint-config-next` are declared devDependencies (keep `pnpm-lock.yaml` in
sync; Vercel uses frozen-lockfile). `pnpm lint` should stay **green (0 errors)**.

### The advisory react-hooks v6 warnings (~54, intentionally `warn`)

Next 16 bundles **`eslint-plugin-react-hooks` v6**, which ships the **React
Compiler** rule suite (`set-state-in-effect`, `refs`, `immutability`, `purity`,
`static-components`, `incompatible-library`). This codebase predates the
compiler, so these fire on patterns that are **correct in standard React**. They
are downgraded to **warnings** in `eslint.config.mjs` on purpose — do **not**
re-promote them to errors or mass-refactor to silence them. The classic
load-bearing rules (`rules-of-hooks`, `exhaustive-deps`) keep their default
severities.

Why each is left (they are resolvable, but the fix is a real refactor with
regression risk, and several are false positives for our constraints):

- **`set-state-in-effect`** — flags SSR-hydration effects (read `localStorage`
  then `setState`, which *must* be post-mount, e.g. `use-sidebar-context`) and
  reset-on-prop-change effects. "Compliant" rewrites mean `useSyncExternalStore`
  / derived state per hook — easy to introduce hydration mismatches.
- **`refs`** — flags the deliberate `ref.current = latest` write during render
  (e.g. `use-page-actions`) used to avoid effect-dependency churn / button
  flicker. The "fix" reintroduces the flicker.
- **`incompatible-library`** — `@tanstack/react-virtual`; not fixable in our code.
- **`immutability` / `purity`** — conservative compiler analysis (e.g. the login
  TOTP auto-submit effect); not real mutations.
- **`static-components`** — a Recharts `content={<CustomTooltip/>}` defined in
  render (closes over theme); hoisting means threading every prop back through.
- **`@next/next/no-page-custom-font`** — Inter is loaded via a Google Fonts
  `<link>`; the family is hardcoded in a Tailwind v4 `@theme` block, so a
  `next/font` migration is fiddly and risks a wrong font shipping.

When **genuinely** missing a stable dep (a `useCallback`/`useMemo`/router/setState
dispatcher), add it. When excluding a dep is intentional (the flight-form
re-init/auto-save effects keyed on `resolvedFlight?.id` — depending on the full
object clobbers in-progress edits on every reactive Dexie write), add an
`// eslint-disable-next-line react-hooks/exhaustive-deps` **with a rationale**.

Clearing the remaining warnings is a deliberate "adopt the React Compiler"
project, individually tested — not a piecemeal lint cleanup.

**New code, however, must not add new advisory warnings** — write it
compiler-clean and keep the ~54 baseline as a cap (`pnpm lint` should not grow).
In practice: put `setState` inside callbacks / event handlers / subscription or
timeout callbacks rather than synchronously in an effect body, derive state
instead of effect-then-setState, and avoid `useLiveQuery` in new components
(read counts via an async effect + the sync `onDataChanged` subscription, as
`components/first-sync-splash.tsx` does).

## Environment Variables

- `MONGODB_URI` — MongoDB connection string (required)

## Known Issues & Deferred Work

### FDP / roster legality — audited against the regulation (14 Aug 2026)

The source is the **Air Navigation (121 — Commercial Air Transport by Large
Aeroplanes) Regulations**: the **FIFTH SCHEDULE (Regulation 178)** for the
limits, and the **FIRST SCHEDULE (Regulation 2)** for the words those limits
are written in. Everything below was checked cell by cell against those
documents.

**`lib/utils/roster/__tests__/fdp-tables.test.ts` transcribes the schedule's
own figures**, not the implementation's — it is the check ON the tables rather
than a copy of them. `rest-period.test.ts` does the same for paragraph 3,
`regulation-definitions.test.ts` for the First Schedule and
`circadian-rest.test.ts` for paragraph 4. If a table ever needs to change,
change the test from the regulation first.

#### The FIRST SCHEDULE definitions are code, not assumptions

`lib/utils/roster/regulation-definitions.ts` holds them. They are not helper
utilities — they are the vocabulary the Fifth Schedule is written in, and every
one of them used to be an assumption scattered through the calculator. Three of
those assumptions were **wrong**, all in the permissive direction:

| Term | What the code assumed | What the schedule says |
|---|---|---|
| local night | a fixed 22:00–06:00 SGT band | an 8-hour period falling between **2200 and 0800** local |
| rest start | 30 minutes after gate-in | **one hour after the crew member is free of all duties** |
| acclimated | within 2 hours of home base | **3 consecutive local nights free of duty in a time zone** |

- **"When am I legal" is a SEARCH, not a lookup.** Para 3(1)(a)/(b) are
  conditions on the rest period AS PROVIDED, and whether it includes a local
  night grows as the crew member waits. `calculateRestUntilLegal` therefore
  takes the earlier of two ends: wait for the local night to complete and 10
  hours suffices, or don't and it is 12. Testing for a night ONCE over a
  hypothetical 10-hour rest and falling to 12 when that failed missed every
  case in between — rest starting in the evening reaches its eighth hour inside
  the 2200–0800 window around the eleventh hour of rest, and 3(1)(a) then asks
  for 10. Reported by the owner: 06:26 shown where 06:00 was legal.
  `earliestLocalNightCompletion` is the forward half of `containsLocalNight`.
- **A local night is any 8 contiguous hours inside a TEN-hour window.** Rest
  running 00:30 → 08:30 is a full local night and used to read as none, taking
  the requirement from 10 hours to 12. In the other direction, ANY overlap used
  to count, so rest that merely clipped 22:00 claimed 3(1)(a)'s 10 hours when
  3(1)(b)'s 12 applied. And it is read in **SINGAPORE time, wherever the rest
  is taken** (`LOCAL_NIGHT_ZONE_MINUTES`) — the owner's ruling, Nov 2026. It
  was the zone the previous duty arrived in, which on a layover moved the
  window by the zone difference. Acclimatisation's "3 local nights in a time
  zone" is a different question and is still read in that zone.
- **A duty period ends when the crew member is free of ALL duties.** Para 7(2)
  puts 90 minutes of checks around the flying with at least 60 before it, so at
  least 30 minutes of post-flight checks are still duty — and the rest period
  then commences an hour after THAT. The old model ended the duty at gate-in
  and let 30 minutes stand for both, over-counting rest by an hour.
- **Acclimatisation is a STATE built from history, not a property of the
  airport a duty starts at.** `applyAcclimatisation` walks the whole timeline,
  and each duty's FDP table is re-derived against the zone the crew member was
  acclimated to **as at that duty's report time** — so landing somewhere cannot
  retroactively justify its own table. A pilot who night-stops once in London
  is not acclimated to London (Table B); one who has been there a week is
  (Table A). It runs between `mergeDutyPeriods` and `calculateAllRestPeriods`,
  because the rest calculation reads the corrected figures.

#### ONE derivation of the FDP maximum — `deriveMaxFDP`

Every stage goes through it: both duty-period producers, the overnight merge,
the acclimatisation pass, and the two hypothetical-duty builders. It exists
because the maximum used to be recomputed at each of those from whatever inputs
that stage happened to have, and they disagreed.

**A duty period carries TWO report times and they do different jobs.**

| | Field | Job |
|---|---|---|
| when the duty BEGAN | `reportTime` | `dutyMinutes`, the elapsed clock, the duty window |
| what Table A is ENTERED on | `fdpStartLocal` | para 14(1)'s "local time of start", in the DEPARTURE station's clock |

They differ whenever reporting slips, and para 10(a) is explicit about it:

> where the delay is less than 4 hours, the maximum permitted flight duty
> period is based on the **original** reporting time but the flight duty period
> **starts at the actual** reporting time

The reported bug was exactly this. TR566/567 on 12 Dec: scheduled out 14:50Z =
22:50 local, so report 21:50 local — Table A's **1500–2159** band, two sectors,
**12¼ hours**. The aircraft pushed back 23 minutes late, putting the ACTUAL
report at 22:13 local. The producer got it right; `applyAcclimatisation` then
re-derived the lookup from `reportTime`, landed in **2200–0559**, and reported a
maximum of **10:15** — below the 10:57 actually flown, so the pilot was shown an
exceedance they had not committed. `mergeAdjacentDutyPeriods` had the same
defect.

`deriveMaxFDP(dp, { acclimatedOffset })` takes the acclimatised zone as its ONLY
override, because that is the only thing a later stage knows that the producer
did not. Everything else — the band, the sectors, the sector lengths, the crew
complement — is read off the duty period. A duty carrying no `fdpStartLocal`
falls back to `reportTime`, which is the old behaviour and is wrong only for a
delayed report.

The report time also has to be moved into the **departure station's** clock from
whichever frame the source stated it in — UTC shifts by the departure offset,
LOCAL_BASE shifts from SGT to it, and **LOCAL_STATION is already there** and must
not be shifted at all (it was, which is an eight-hour error on a UTC+0
departure).

#### TWO report times, and paragraph 10

`reportTime` is when the duty BEGAN. `fdpStartLocal` is what Table A is ENTERED
on. They are different questions and para 10 is explicit about it:

> (a) where the delay is less than 4 hours, the maximum permitted flight duty
> period is based on the **original** reporting time but the flight duty period
> **starts at the actual** reporting time;
> (b) where the delay is 4 hours or more, the maximum … is based on the
> **actual** reporting time but the flight duty period **starts 4 hours after**
> the original reporting time

**The report defaults to the ROSTERED time** — `scheduledOut − PRE_FLIGHT_CHECK_MIN`
— not to `actualOut − 1h`, which is what it used to be. Deriving it from the
actual gate-out is right only when the company moved the report by exactly the
pushback delay; in the ordinary case of a late aircraft under a crew who
reported on time it slid the duty's start forward with the delay and made the
duty look SHORTER than it was. On the owner's TR566/567 duty that hid 23
minutes (10:57 against 11:20 on duty); a three-hour technical delay hides three
hours, and the panel then offers FDP remaining that does not exist.

`FlightLog.reportTime` records an actual report when the company moved it —
told to stay at the place of rest because the inbound is late. Precedence:

1. an explicit `flight.reportTime` on any sector of the duty,
2. `scheduledOut − 1h`,
3. `actualOut − 1h` (a hand-entered flight with no schedule).

Under 10(b) the FDP window opens BEFORE the crew member reports, so part of it
is already spent when they walk in. `DutyPeriod.fdpElapsedAtReport` carries
that, and `ActiveDuty` therefore has TWO clocks: `elapsedMinutes` (the crew duty
period, from report) and `fdpElapsedMinutes` (the FDP). They are equal on every
ordinary duty and only para 10(b) separates them.

#### Standby (paragraph 6)

**Standby is a DUTY period but not a FLIGHT duty period.** Paragraph 14's tables
never applied to it, so it carries `maxFdpMinutes: 0` and must never reach an
FDP gauge or an FDP exceedance check — read against a maximum of 0, a 12-hour
standby is a 12-hour exceedance of a limit that does not exist. Its own cap is
para 6(2)(a): **18 hours** for a flight crew member.

| | Field | Rule |
|---|---|---|
| what it really was | `dutyMinutes` | drives para 3 rest and the 18h cap |
| what reaches the limits | `countedDutyMinutes` | para 6(7) — **20%** of home standby |

`calculateRollingStats` sums `countedDutyMinutes ?? dutyMinutes`, so every
ordinary duty counts in full and only standby is discounted. Airport standby
counts **zero** separately, because para 6(3) folds it into the rest period or
the following FDP instead.

**A home standby is REST — called out or not.** The rest period runs straight
through it: it takes no rest requirement of its own and does not become the duty
the next one is measured against, so a flight after a standby rests from the
last duty actually flown. `isRestingStandby` is the test; `calculateAllRestPeriods`
and `calculateRestUntilLegal` are the two places that skip it. The 20% is
unaffected — "did you rest" and "how many hours have you worked" are different
questions and the schedule answers them in different paragraphs. A CALLED-OUT
standby is skipped too: it ends the moment the duty begins (6(6)), and treated as
the duty to rest from it put the gap between activation and report — less the
hour, so −1:00 — as the rest before the flight it became, and every called-out
standby read "rest short".

> **The OWNER'S RULING (Nov 2026), against the literal text.** The First
> Schedule's "duty" includes standby and a rest period is "free of all duties",
> so read literally a standby interrupts rest and a 12-hour one demands 12 hours
> after it under 3(1)(c). Both readings were put to the owner; the operator's
> practice is the one kept. It is the PERMISSIVE direction — written down, not
> assumed. For days off (para 5) a standby IS a duty: a day on standby is not a
> day "free of all duties".

**Para 6(6) — activation.** A standby that is called out ceases at the moment of
activation, so `truncateActivatedStandby` cuts it back to the following duty's
report before the 20% is taken. Left whole, those hours are counted twice: once
at 20% as standby and again in full as the duty they turned into.

Two callers need "was this called out": the FDP pipeline works in duty periods,
the roster page has schedule entries and flights. Both go through
`findActivationMinute` — `standby-activation.ts` is the roster's half — so the
rule cannot drift into two. It reads the ROSTERED report, so a pushback delay
does not move the activation and credit duty hours as standby.

**`mergeDutyPeriods` competes only on KIND.** It prefers the logbook for a date
and marks that date consumed, which is right for a schedule FLIGHT duty — an
alternative record of the same duty — and wrong for a standby, which is a
different duty that happens to share the day. And the day it shares with a
flight is exactly the day it was ACTIVATED on, so the one standby whose hours
needed accounting for was the one being dropped, and `truncateActivatedStandby`
never saw the pair.

**The dashboard gives standby its own band** (`DutyStatus.standby`), and RENDERS
it. Left in the flight-duty search it becomes the ACTIVE duty carrying
`maxFdpMinutes: 0`, so the panel reads as a flight duty whose limit failed to
compute — a dash where a pilot expects a number, on a duty paragraph 14 says
nothing about. But reading it as OFF DUTY is the worse error in the other
direction: the crew member is committed and contactable. The band gauges the
standby's own window, the rest clock keeps running beneath it (an un-called
standby is rest), and the annunciator says "On standby to HH:MM" rather than
"Nothing required".

`standbyKind()` is a code→`home`/`airport` lookup that currently returns `home`
for everything, which is what this operator rosters. It is a lookup rather than
a constant so the day airport standby appears it is a table entry, not a
rewrite.

Rest before a standby needs no special code: once the standby is a
`DutyPeriod` in the merged timeline, `calculateAllRestPeriods` checks it like
any other. That was the whole reason for tracking it.

#### The roster page is gone — its duties are logbook cards

See "The roster IS the logbook, with its duties on". The sticky month over a
day-by-day agenda (`RosterAgenda`) is retired; what it said survives on the
cards: a day off or leave reads "all day" (the report's 00:00–23:59 window was
two clocks for nothing), an activated standby says when it was called out, a
past sector with no times reads "not logged".

#### The roster holds NON-FLIGHT duties only

`userDb.scheduleEntries` was never removed — the table, the store, the roster
page and its MongoDB sync were all intact. What was missing was a writer (all
imports go to the logbook) and, before that, a parser stage: `schedule-parser`
offered every non-flight row to `tryExtractSimDuty` and dropped whatever was
not a simulator, so **standby had never been extracted at all**.

**Duties are hand-editable.** `components/roster/duty-detail-panel.tsx` adds and
edits one, in the DETAIL panel — beside the month on a tablet, the full-screen
overlay on a phone — the way a flight opens in the logbook (owner's request,
Oct 2026: the roster is `hasDetailPanel: true` now). The card is
swipe-to-delete. The form holds a DRAFT over the live entry (`useDraft`), so a
sync write cannot clobber an edit in progress and every field the pilot has not
touched follows the record. Selecting, adding and the phone's `__new__`
sentinel follow the crew page's pattern.
Deleting is a **soft** delete into Recently Deleted, like everything else the
pilot can delete — the old hard-delete rule held while these were import
bookkeeping the next report regenerates, and stopped holding the moment the
pilot could author them.

It now holds standby / ground / leave / off — and nothing else. **Flights stay
logbook-only.** The old roster was a parallel record of flights that had to be
reconciled against the logbook, and that reconciliation is what made it heavy;
a standby has no logbook counterpart, so there is nothing to reconcile.
`classifyGroundDuty` maps the company's codes, `ParsedGroundDuty` carries the
window in UTC (converting can move the DATE — 06:00 SGT is 22:00 the previous
day), and the executor writes them through the existing sync-aware
`bulkUpsertScheduleEntries`, keyed on date + dutyCode so a re-import updates
rather than duplicates.

#### Paragraph 4 — duties around the window of circadian low

Three First Schedule terms, all defined in **acclimated time**:

| | Definition |
|---|---|
| early start | a SCHEDULED departure commencing 0500–0659 |
| late finish | a SCHEDULED arrival ending 0100–0159 |
| window of circadian low | a TAKE-OFF or LANDING in 0200–0459 |

The last one is defined *in relation to a take-off or landing* — not to a duty
period and not to the cruise. A sector airborne at 2310 and landing at 0650 is
over the window for its whole middle and touches neither end of it.

A duty encompassing any of the three is **disruptive**, and para 4 asks for a
rest period of **24 hours inclusive of a local night** in two places: 4(1)(a)
before the first FDP of a SERIES, and 4(2) before the next disruptive FDP once
two consecutive ones are complete. Inside a series, 4(1)(b) hands every rest to
paragraph 3.

**A series runs between DAYS OFF** (the owner's reading, Nov 2026, replacing
"one disruptive duty is a series"): it begins after a rest of 34 hours
inclusive of a local night — a day off, para 5(1) — so 4(1)(a)'s 24 hours is
met by construction and an early start after an ordinary duty mid-block is
paragraph 3's. Read the other way, every disruptive duty after an ordinary one
asked for 24 hours where the operator's legal roster gave 15–18 — the "24
hours every now and then". The text supports either reading ("a series of
flight duty periods that encompass …"); this one is the operator's practice.
**Tested against the owner's 18 months of rosters (May 2025 – Nov 2026, 154
FDPs, 47 disruptive) with no failure**, on scheduled and on actual times; the
older readings each failed rostered rests. Two of those rosters decide it:
17 Feb 2026 (disruptive, 118h off, disruptive, 15h, disruptive) is legal only
because the day off ends the series; 27 Nov 2026 (two disruptive, two
ordinary on short rests, then 25:30 before a disruptive one) is the owed 24
hours given past the ordinary duties. Both are pinned in
`circadian-rest.test.ts`.

- **The classification happens in `applyAcclimatisation`, not at construction.**
  The duty period producers store the raw instants (`departureMs`, `arrivalMs`,
  `takeoffLandingMs`); only the whole timeline knows what clock to read them in.
- **4(2) is a STATE carried until the next day off** (`CircadianState`,
  `stepCircadian`, in `calculateAllRestPeriods` and `calculateRestUntilLegal`),
  because neither duty in a pair can see it. Two consecutive disruptive FDPs
  make the 24 hours OWED, and from then on EVERY disruptive FDP needs 24 hours
  inclusive of a local night before it until a day off (`isDayOffRest`, 34h
  with a local night) ends the series. An ordinary FDP breaks the RUN but does
  not discharge it ("prior to … the next FDP that encompasses" one), and
  neither does a 24-hour rest short of a day off. Non-FDP duties neither
  extend the run nor break it.
- **Early start and late finish read the SCHEDULE, never the actual times.**
  The definitions say "scheduled departure" / "scheduled arrival", so a delay
  cannot make one — an arrival planned for 0030 that blocks in at 0115 is not
  a late finish. They read the actual times, so every delayed late-night
  arrival became a late finish and para 4 asked for 24 hours — the owner's
  "24 hours every now and then" (Nov 2026). A flight with no schedule recorded
  (hand-entered) is judged on what it did. The window of circadian low reads
  the take-off and landing that HAPPENED. Each sequence wraps its own day, so
  an actual time is never read against a scheduled one.
- **Gate times stand in for wheels times when a flight records none** — and a
  BLANK one (`""`, the canonical default) counts as none (`||`, not `??`). Every
  planned sector and older logbook rows carry out/in only; treating those as "no
  take-off or landing" would classify all of them as never touching the window.
- **A LOCAL_STATION schedule report supplies no instants at all.** Its
  departure-side and arrival-side times are in different zones and the entry
  does not carry the arrival's offset, so it is left unclassified rather than
  read against a clock that could be a whole timezone out.

#### Verified correct

| | Source |
|---|---|
| Table A, all 32 cells | para 14(1)(a) |
| Table B, all 6 cells | para 14(1)(b) |
| Table C, all 20 cells | para 14(1A) |
| Long-sector count-as values | para 14(2) |
| Duty 90h/14d, 180h/28d — the FLIGHT crew figures | para 12(1) |
| Flight 100h/28d, 1000h/12mo | Reg 107 |
| 60 min pre-flight, 90 min pre+post | para 7(2) |
| Rest 10h / 12h / round-up / 24h and the ordering | para 3(1) |

Note para 12(2) gives CABIN crew 100h/14d and 200h/28d. The app is a FLIGHT
crew logbook and `DEFAULT_FTL_LIMITS` carries the flight-crew figures — do not
"correct" them to the cabin numbers.

#### Fixed in this pass (all were wrong in the permissive direction)

- **Rest sub-rules are CUMULATIVE, not alternatives.** Para 3(1) joins (a)–(d)
  with "and", so every applicable one must be met and the requirement is the
  LARGEST. Read as an if/else chain, an 11-hour duty followed by rest with no
  local night required only 3(c)'s 11 hours and ignored 3(b)'s 12.
- **Para 14(2) counts long sectorS, plural.** Only the longest was counted up,
  so a duty of two 8-hour sectors read as 3 effective sectors instead of 4 —
  an hour and a half of FDP the schedule does not allow. `calculateMaxFDP` now
  takes `sectorMinutes: number[]`; `longestSectorMinutes` remains for old
  callers.
- **Para 14(2) applies only to a crew that "only consists of 2 pilots".** The
  adjustment was being applied to augmented crews too (their ceiling comes from
  para 15) and is not named for Table C at all.
- **Para 15(3)(b): no extension without rest facilities.** The augmented
  extension was granted unconditionally. It now requires
  `inFlightRestFacilities === true` — unknown withholds it, because guessing in
  favour of a longer duty is the wrong way to be wrong. Nothing currently sets
  `augmentedCrew`, so this changes no existing figure.
- **A merged overnight duty dropped the long-sector adjustment.** The recompute
  in `mergeAdjacentDutyPeriods` had only the sector COUNT, so an over-long
  merged duty read as compliant. `DutyPeriod.sectorMinutes` now carries the
  lengths through the merge.
- **`includesLocalNight` was given the un-wrapped debrief date.** A duty
  crossing midnight debriefs the following day, and testing the night window
  against the wrong day picked the wrong rest rule (3a vs 3b).
- **The three First Schedule definitions above**, each of which shortened a
  required rest or raised an FDP maximum.
- **Paragraph 4 was not implemented at all.** A roster of consecutive early
  starts asked only for paragraph 3's 10 or 12 hours where the schedule
  requires 24 inclusive of a local night.
- **The FDP maximum was re-derived from the ACTUAL report time** by the merge
  and the acclimatisation pass, against para 10(a). Reported by the owner:
  10:15 shown on a duty entitled to 12:15, which also made a compliant 10:57
  duty read as an exceedance. Now one derivation (`deriveMaxFDP`) over one
  stored basis (`fdpStartLocal`).
- **A LOCAL_STATION schedule report's time was shifted by the departure
  offset**, double-counting it — eight hours, two bands of Table A, on a UTC+0
  departure.
- **A report before midnight UTC was clamped to 00:00Z.** The rostered report
  is the scheduled gate-out less an hour, and for a departure before 01:00Z it
  falls on the previous day — `Math.max(0, …)` moved it to midnight of the
  flight's date, dropping up to an hour of duty and entering Table A on the
  wrong local time (07:55 SGT read as 08:00 — across a band boundary). The duty
  now carries the date it was REPORTED for; its id stays on the flights' date.
- **`calculateRestUntilLegal` still had the if/else chain** the same pass fixed
  in `calculateRestPeriod` — so the countdown a pilot actually reads off the
  dashboard under-stated an 11-hour duty's rest by an hour, and measured the
  local night at home base rather than where the crew member was. It now builds
  the same candidate set, and folds in para 4 when the NEXT duty is known.

#### Known gaps — these need the OWNER's input, not a guess

- **Airport standby is written but inert.** Every code maps to `home`, which is
  what this operator rosters. Para 6(3) — airport standby is part of the rest
  period with adequate facilities and part of the following FDP without — is
  implemented as far as "counts zero separately"; the FDP-absorption half needs
  a real case to model against.
- **Training and ground duties still contribute nothing to the cumulative
  limits.** Only standby is discounted by rule; a ground duty is written to the
  roster and counted at zero, where para 12 would count it in full. It needs
  the owner's read on which of their ground codes are genuinely duty.
- **Para 5(6)** (a disrupted flight may cut the ensuing day off by 4 hours if
  made up) is not modelled — whether a disruption was unforeseen is not in
  the record. Para 5(1)(b)'s "time taken to reach the accommodation" likewise.
- **Imports cannot mark positioning** — neither report seen so far flags it.
- **Para 13 / 3(2): commander's discretion** is not a field: a duty legitimately
  extended still reads as an exceedance, and the timeline's detail SAYS whether
  it lies within the PIC's 3:00 (FDP) or 2:00 (rest, local night satisfied) —
  and that a schedule has no discretion at all.
- **Para 4's "series" runs between days off** (owner's reading, Nov 2026,
  tested against 18 months of rosters — it replaced "one duty is a series"):
  see Paragraph 4 above. 4(1)(a) is then met by the day off that begins a
  series; only 4(2) can fail. The rosters could not tell whether a 24-hour rest
  short of a day off should end a series too; the stricter answer (it does not)
  is the one kept.
- **Acclimatisation is only as good as the roster's COVERAGE.**
  `acclimatisedOffsetMinutes` now walks the real duty history rather than
  assuming home base, but it reads a gap between two known duties as "free of
  duty" — so a period the app simply has no data for looks like three nights
  somewhere. With a complete roster loaded it is exact; with a partial one it
  can move a duty to Table A, which raises the maximum. It cannot be fixed
  without knowing where roster coverage begins and ends.
- **A rest period away from base may be over-reported.** The First Schedule's
  rest definition takes the SHORTER of "one hour after free of all duties" and
  "on reaching the designated accommodation". The app has no idea when a crew
  member reached their hotel, so it models the first limb only.

#### Audited against the full text (Nov 2026) — what changed

The owner supplied the Fifth Schedule and the First Schedule in full; every
clause was read against the code and `fifth-schedule-scenarios.test.ts` now
walks them as worked scenarios through the REAL pipeline (flight rows in;
duty periods, maxima, rests and days off out). The tables were already exact.
What was wrong or missing:

| Clause | Was | Is |
|---|---|---|
| FDP definition — "the last flight on which he or she is a crew member" | the FDP closed at the last arrival of ANY kind, so positioning home after the flying was charged against the maximum | closes at the last OPERATED on-blocks; the positioning is duty |
| para 2(1)(b) — positioning "immediately precedes a flight" | across a date boundary it stayed a separate duty (merge only joined like kinds), so its rest to the flight read short | `mergeAdjacentDutyPeriods` joins positioning and simulator duties INTO a flight duty |
| para 8 — positioning only | given the one-sector FDP maximum | `dutyKind: "positioning"`, a duty period with no maximum |
| para 9 — simulator | counted as a sector, given a pre-flight hour, and a session alone was an FDP with a one-sector maximum | not a sector; its window is the detail itself; ahead of flying it opens the FDP (9(2)); alone it is `dutyKind: "training"`, a duty counted in full, no maximum; on the timeline it is hatched and adds no flight time (`TimelineSector.simulator`) |
| para 4 — "consecutive flight duty periods" | a simulator or called-out standby between two early starts broke the run | non-FDPs neither extend nor end it (`isFlightDutyPeriod`) |
| para 6(6) + the standby ruling | a called-out standby was the duty the flight rested from → rest −1:00 | skipped like an un-called one |
| "acclimated" — 3 consecutive local nights free of duty | only nights inside ONE duty-free gap counted, so three London nights with day duties between never acclimated | the run of nights is carried across duties (`stepNights`); a night with a duty in it, or one in another zone, restarts it |
| para 5 — days off | not computed | `days-off.ts`, below |

**Para 5 is read off the timeline's own blocks** (`analyseDaysOff`), so the
warning and the picture cannot disagree. A day off is 34 hours free of all
duties with a local night, from an hour after the duty; each next one 24 hours
with a local night (`daysOffIn`). Checked: 5(4)(a) more than 7 SGT dates
worked between days off; 5(4)(b) fewer than 2 days off in any 14 SGT days;
5(4)(c) fewer than 8 in any 28 — under 6 a violation, 6–7 a CAUTION unless the
4 weeks before or after make the shortfall good; 5(5) back from 7 days or more
away (the last sector's airport off home base, `DEFAULT_HOME_BASE`) without 82
hours and 3 local nights before the next FDP. **Days off are found only
BETWEEN known duties**, and windows are judged only inside the span the duties
cover — missing data reads as free time, so it can only ever produce a day off,
never a violation. Standby is a duty here; local nights are SGT. The FDP page
lists findings from four weeks back in the same list as the forecast breaches
(tap → pointer), and a rest's detail counts the days off it holds.

#### Rolling windows are whole UTC DAYS (settled 31 Oct 2026)

`calculateRollingStats` and the timeline's index take the window as the
`days` UTC dates ending on the as-of instant's UTC date — the clock a duty's
`date` is keyed on. They compared each duty's LOCAL midnight against UTC-built
as-of instants, so in Singapore every 14/28/365-day window on the FDP chart
and in the Quick Check lost its oldest day (a duty 13 days back fell out of
the 14-day total), and west of UTC the forecast's local as-of gained one.
`timeline-data.test.ts` runs the windows under six zones (`process.env.TZ`).

**The Quick Check reads FDP violations through `isDutyExceedingLimits`**, and
FDP through `fdpMinutesOf` (report → last on-blocks, plus para 10(b)'s spent
part). `simulateScenario` had its own `dutyMinutes > maxFdpMinutes`, which
flagged every standby after the hypothetical duty (its maximum is 0) and any
duty ending inside its post-flight half hour, and its "affected" set grew as it
was walked, so every later duty's existing problem was reported as the
scenario's (`scenario.test.ts`). The FDP chart's tooltip reads the same rule
(`TimelineDataPoint.fdpExceeded`) and prints the FDP against its maximum
(`fdpHours`) on its own row — "Duty 12:40/12:15" in red, for an FDP of 12:10,
was the duty compared with a limit it is not measured against.

### The FDP page — ONE timeline, read at ONE pointer (Nov 2026)

`components/roster/duty-timeline.tsx` (model: `lib/utils/roster/duty-timeline.ts`,
`lib/utils/roster/rolling-at.ts`). The rolling limits chart and the duty Gantt
used to be two charts with two zooms; the owner asked for them in sync "both in
period and where it is focused", so they are ONE scroller on ONE time axis:

| | Shows |
|---|---|
| the header | the POINTER's instant ("Nov 4 03:11Z", the other clock under it: "11:11 SGT") beside − / + / Now — no "Timeline" title, and no Next Duty card above it (the row below says the same) |
| the state row | THREE fixed cells, never prose (`PointerStateRow`, `stateCells`): on duty, the leg (WSSS-RPLL) under its state / FDP x/max / Flight (a duty that is not an FDP — standby, simulator, positioning, ground — its code / Elapsed / Flight —); at rest, Next Duty / Next FDP x/max, both DIMMED / Rest x/minimum (from 100 hours, "19d 21h" (`formatRestSpan`, which the dashboard's rest figure uses too) under "Rest · Min 12:00" — "477:23/11…" did not fit a phone's third). A line of prose wrapped as it changed and moved the card's height |
| the tabs | Duty 14d, Duty 28d, Flight 28d, Flight 12m AS AT THE POINTER (`rollingAt`) — the same names the dashboard's limits band and the Quick Check use; the chosen one is drawn |
| the rolling chart | that limit's running total — flown solid, scheduled dashed yellow from now, what-if orange — against the limit line and its 90% |
| the deck | each duty bar (sign-on → sign-off) the full row height with its sectors' block time INSIDE it, full height too; the rest directly under it with no gap |

- **The pointer is the centre of the view, to the minute, at any zoom.** It is a
  fixed line over the scroller, and it HOLDS its instant through anything that
  moves the axis without a gesture — new data shifting where the axis starts,
  a resize — so a sync never slides the view out from under the reader; the readouts subscribe to a small store
  (`createPointerStore`) written on each scroll frame, so the chart itself
  re-renders only when what is drawn has to move on (a quarter of the view).
  Nothing on the page is a total "over the period in view" any more — the
  owner found that not useful.
- **The rolling total is a CONTINUOUS window at an INSTANT** (`rollingAt`):
  the `days` × 24 hours ending at the instant, each duty counted by the part of
  it inside (duty pro rata, flight as its sectors' block time). It climbs
  through a duty and rolls off the far end minute by minute; it used to be the
  pipeline's whole UTC dates, which dropped a day's duty at a midnight — the
  owner's "it jumps". Every 14 consecutive calendar days lie inside some 14 ×
  24h window, so its peak is never below the day figure the dashboard and the
  forecast use (`calculateRollingStats`, unchanged). Linear between
  breakpoints (a mark, and the same mark `days` later), so `rollingSeries`
  draws it exactly; `rolling-at.test.ts` pins it to the overlap definition.
  Ground duties count zero, standby its `countedDutyMinutes`.
- **Zoom is continuous** — a pinch follows the fingers' spread and holds the
  time under them (so it pans too), ctrl-wheel on a trackpad, − / + for a
  keyboard; 3 hours to 180 days. There are no 24h / 7d / 28d presets. Gridlines
  run the FULL height at the finest step that leaves 42px for a label (hours
  under a day, dates beyond; midnights stronger), dates as "4 Nov" (`formatDayAt`, no weekday or year).
- **Duty and FDP are drawn apart.** The duty bar runs sign-on → sign-off; the
  FDP inside it, darker, runs sign-on → the last on-blocks (`fdpEndMs`); what is
  left after it is the post-flight half hour, duty but not FDP. The flying sits
  inside that, full height.
- **A limit is GEOMETRY, not a colour, and it is the FDP's.** A duty still to
  come carries its maximum as a DOTTED outline to the latest on-blocks it allows
  (`fdpLimitMs` = the FDP's end moved by the FDP still in hand); a FLOWN duty
  draws no maximum (`showMax`), only the FDP past it struck red, ending at the
  last on-blocks with a red edge — never at the sign-off (the owner's report: a
  2-minute FDP breach was drawn over the post-flight half hour). The rest row
  starts where rest COMMENCES (`RestBefore.startMs`, an hour after sign-off —
  that hour is neither, so nothing is drawn), then the minimum solid
  (`minimumEndMs`), then the rest beyond it; a minimum past the next sign-on is
  struck red under the duty that came too soon. The minimum ends where the
  rest FIRST BECAME LEGAL — `earliestLegalRestEnd`, the same function the
  dashboard's "legal from" uses — not at commencement plus the requirement of
  the rest as finally provided: rest commencing 01:27 SGT after an 11-hour
  duty holds a night by the time it is over (11h), but none by its eleventh
  hour, so it was legal at 12, and the timeline drew it an hour early.
- **The state row says WHERE, not that.** On a flight duty the first cell's
  caption is the state (On Duty / Scheduled / What-If) and its value the leg at
  the pointer (`legAt`: the one in progress, else the next, else the last); a
  standby or ground duty its code ("SBYC"). At rest, the next duty and its FDP
  are DIMMED — what it will ask, not a clock running now. The header carries
  the other clock under the pointer's: SGT beside Zulu, Zulu beside local.
  Axis labels are centred ON their gridline, which starts as a tick under it. Labels are "used/limit" in the pilot's duration
  format — a duty its FDP against its maximum, a rest against its minimum —
  and only where the label FITS its own bar or rest (`fits`): zoomed out, one
  per duty was "x:xx/xx:xx" over every few pixels. The rolling chart's fill
  runs on, fainter, BEHIND the duty and rest rows to the chart's floor, so the
  chart does not stop in a hard edge above the duties. A rest's detail names
  the rule that set its minimum (`REST_RULE_LABEL`) and whether it holds a
  local night (SGT).
- **"Scheduled", never "planned"**, in anything a pilot reads, as everywhere
  else in the app.
- **The axis runs three years either side of the logbook** (capped at
  `MAX_INNER_PX` around now at the finest scale); only what is within a view
  either side is drawn. "Now" brings the pointer back; a jump of more than a
  few views is instant, a short one smooth. Tapping the rolling chart brings
  that time to the pointer.
- **ONE findings list under the chart, in date order** (`FindingRow`): a
  forecast breach of ANY of the four limits — the first date per limit; a
  breach hidden behind another tab was not shown at all, and the same breach
  repeated day after day — and the para 5 findings, each "date · what" with
  its rule ("Reg 12a", "Para 5(4)(a)") on the right. A breach row switches to
  its limit's tab and brings the date to the pointer.
- **The Quick Check draws on it.** `simulateScenario` returns the duties as the
  what-if leaves them (`dutyPeriods`, rest recomputed) and the ids it took out;
  the page builds blocks from them (`TimelineScenario`). An added duty
  (`SCENARIO_DUTY_PREFIX`) is orange (`FDP_COLORS.scenario`) with its flying as
  one span from the end of the pre-flight checks; a removed one is a dashed
  outline; the rolling line ahead turns orange over the original's dashed
  yellow; a strip names the result with a Clear. Closing the Quick Check KEEPS
  the what-if until it is cleared — on a phone the check covers the chart.
- **The blocks come from the same duty periods the limits were computed from**
  (`allDutyPeriods`, flown + `upcomingPlannedDuties`), and a rest is the
  pipeline's own `restBefore` where it has one. Training and ground duties come
  from the roster (`scheduleEntries`, UTC only), hatched like a standby.
- **Para 5 findings and the commander's discretion are read here too.** In
  the findings list, the days-off findings (`analyseDaysOff`, four weeks back
  on); in a duty's detail, whether an FDP over its maximum lies within the
  PIC's 3:00 (para 13) — "none for a schedule"; in a rest's detail, within the
  PIC's 2:00 (para 3(2), the local night satisfied where required), its rule,
  and the days off it holds. A simulator or positioning duty is named ("SIM",
  "POS" → Simulator / Positioning) and reads "Not a flight duty period".
- **A tapped duty or rest expands IN PLACE under the chart** — sign-on,
  sign-off, FDP against its maximum, latest sign-off, sectors; a rest's length,
  minimum and when it ends, and the duties before and after it — an exception
  to Main / Detail, because the FDP page gives the detail panel to the Quick
  Check only. Every tap target is at least 28px wide (`hit`).

### OCR engine

The engine is now the app's own pipeline over the PP-OCRv4 models (Camera OCR
› The engine is ours). The owner had asked about **PaddleOCR JS**; the
assessment on record:

- The speed gap in the PaddleOCR web demo is mostly **server hardware**, not the
  engine. Locally the cost is dominated by **model load** and by how many boxes
  are RECOGNISED — which is why skipping the keypad was the win, not a new
  engine. Paddle's JS models are the same family and comparable in size.
- The extractors take `{text, box, confidence}` so they are engine-shaped, but
  the digit repair (`O`→`0`, `I`→`1`) and row-grouping tolerances are tuned to
  these models' output. Real photos are fixtures (`OCR_ENGINE=1 pnpm test`) —
  any change of model, detection size or threshold has to read all seven.

### Deferred design work (owner-approved to-do)

- **Fewer "USE x:xx" buttons in the flight form's TIME section — DONE (Nov
  2026)**, once the owner asked for the audit's findings to be acted on. The
  section leads with the categories the flight HOLDS and the role time of the
  seat it is logged in (`leadsTimeSection`, `logbook-rules.ts`); every other
  category the rules keep waits behind ONE row, "More Categories 7", which
  opens them in place with their USE buttons as before. Nothing holding a
  figure is ever folded, and the fold is per flight (a mounted form showing
  the next flight starts folded). Considered and NOT done, on purpose: hiding
  the empty Scheduled Out / In rows on a flown flight, and folding
  Approaches / Holds / IPC — a row that is sometimes there and sometimes not
  is a row to hunt for, and they are four short rows at the end of the form.

- **The split-view detail panel on every route** — no longer deferred: the
  owner set the rule (Oct 2026), see "Main / Detail on every page".

### Performance work surveyed but NOT actioned (audit trail)

Each of these was measured or read closely during a performance pass and left
alone on purpose. The reason is recorded so the next pass doesn't re-derive it
— and so that anyone who *does* action one knows what they are trading.

- **The glass rim's edge blurs — ACTIONED 9 Nov 2026, on the owner's say,
  and marked for a possible REVERT.** Each glass surface carried five
  `backdrop-filter`s: the face (`.GlassBlur`) and four edge layers
  (`.GlassEdgeReflection`, `.GlassEmbossReflection`, `.GlassRefraction`,
  `.Highlight`) masked to a ~2px ring but filtering the whole box. A/B on the
  owner's logbook at 4× (390×844, frames over 33ms):

  | | now (22 blurs) | edge blurs off (6) | no blur at all (0) |
  |---|---|---|---|
  | scroll logbook / roster / airports | 60fps | 60fps | 60fps |
  | sidebar open / close | 16 / 6 | 8 / 2 | 9 / 2 |
  | calendar open / close | 13 / 10 | 6 / 1 | 4 / 1 |

  The edge layers were nearly all of the cost; darken-only bought almost
  nothing more and let the cards read through the bottom bar. So ONE rule at
  the end of the glass block in `globals.css` ("RIM BLURS OFF") hides the
  four layers — they draw nothing but their filter. The painted hairline
  (`.GlassMaterial::before`, the conic) stays; what goes is the 1–2px of
  refracted backdrop inside it. **To revert: delete that rule** (or
  `git revert` the commit "Glass keeps one blur per surface"); every original
  declaration was left in place, so nothing else needs restoring. The owner is
  judging it on device. (The specular DRIFT that used to sit beside this in
  the list was actioned — see "Smoothness" — because it turned out to move
  nothing.)
- **`dedupingInterval: 0` on every data hook** means the five keep-alive pages
  reading `useFlights()` each fire their own full IndexedDB read on first
  mount. Raising it is safe *in principle* — SWR only consults the interval for
  `revalidateOnMount`/focus/polling, and an explicit `mutate()` always sets
  `shouldStartNewRequest`, so a post-write refresh is never swallowed (verified
  against the SWR source). What it does open is a window where a page mounting
  shortly after another reuses the earlier request's result. Needs testing
  against the running app before changing.
- **`useFDPData`'s airport-timezone effect runs once per consumer** — three on
  the dashboard — each resolving the same IATA set from IndexedDB. A module
  cache would collapse them, but a cached offset would pin a PLACEHOLDER
  timezone if a custom airport were enriched later, and that feeds the FDP
  legality math. Do not cache it without invalidation tied to enrichment.
- **The Google Fonts stylesheet is render-blocking** — a third-party
  `<link rel="stylesheet">` in `<head>`, so first paint waits on a
  `fonts.googleapis.com` round trip on a cold start. See the `next/font` note
  under Linting for why the migration was deferred.
- **Root-level setup docs are stale** — `BUILD_FIX_SUMMARY.md`,
  `OCR_INTEGRATION.md`, `OCR_IMPLEMENTATION_SUMMARY.md`,
  `OCR_SETUP_CHECKLIST.md`, `ROSTER_FEATURE.md` (~1,100 lines) describe
  finished work whose live rules are already in this file.
  `OCR_SETUP_CHECKLIST.md` is actively misleading: its "Required Actions" tell
  the reader to fix **npm install** issues, which contradicts the pnpm-only
  rule and would desync `pnpm-lock.yaml` and break the Vercel build. Delete or
  correct — owner's call.

- **The Nov 2026 resource audit (owner kept these for later).** Baseline,
  production build, 390×844, real logbook (344 flights), 4× CPU unless noted:
  cold load 57 scripts / 1,635KB raw / 541KB gzip; first card 1.42s on a
  repeat launch; idle 20–45ms of main thread per 4–5s, no running animations;
  heap 12–15MB after GC with every kept-alive tab visited, 2,238 nodes, 703
  listeners. Waiting:
  - **The import pipeline is a STATIC import of the logbook and roster pages**
    (`UnifiedImportButton` → every parser, LogTen, the reconciler, the
    executor, the review dialogs): ~120KB minified, est. 35–40KB gzip, used
    only after a tap. On a repeat launch V8's code cache makes it ~7–20ms; the
    cost is the first launch after install and after every deploy. The shape:
    a thin button that `import()`s the pipeline on tap, warmed at idle so an
    offline import still finds it cached.
  - **Opening a flight** is ~380ms of React reconciliation at 4× (four long
    tasks, worst 185ms). App code in it is small (the form 19ms, swipe rows
    28ms). Mounting the lower sections after the first paint would shorten the
    first task, but it touches the auto-save baseline (see "can lose an edit
    made in its first half-second") — its own change, with its own approval.
  - **Heap creeps ~0.3–0.5MB per ~25 interactions** after GC while nodes and
    listeners stay flat — probably caches. Diff two heap snapshots before
    changing anything.
  - **The one-off data repairs write one transaction per flight** (~500ms at
    4× on the launch that repairs 160 flights; later launches write nothing).
    Batching them is a change to the sync write path.
- **Measured and REJECTED (Nov 2026) — do not re-try without new evidence:**
  - `.GlassMaterial`'s `will-change: transform` + `translate3d` costs 5–6
    layers and up to 0.7MB per screen, and dropping it is pixel-identical at
    rest — but it is what keeps the morph and the press composited: without
    it the sidebar open went from 2–4 frames over 33ms to 6–8, close 0 → 3,
    a glass press 2–3 → 5.
  - `scroll: false` on the remaining in-app `router.push`es: no measurable
    difference (289 vs 327ms, noise).
  - Dropping `visibility` from hidden kept-alive pages (content-visibility
    alone): the arriving page is restyled on unskip either way (95–109ms).
  - The scroll indicator's per-frame reads: its layouts are the frame's own,
    taken earlier, not extra ones (6 layouts in four flings, 4 of them there).
  - Fewer overscan rows or a slimmer card: 40 elements a row is already lean,
    and less overscan risks blank rows on a fast fling.
  - A sweep of `getComputedStyle` over every element STARTS pending
    transitions inside the stowed sidebar (`content-visibility: hidden`) that
    then never finish — it reads as "two animations running forever" and is
    an artefact of measuring that way, not of the app.

### Lower-priority items (not yet actioned)

- **Multi-device gaps from the Oct 2026 audit.** Closed since: an IMPORTED
  duty is created under a derived id (`importedDutyId` — `duty:<date>:<code>`),
  so two devices importing one report before syncing land on one record (and
  `decidePush` lets a purged derived id be recreated, as for comparisons); the
  pilot's own card is chosen by ONE rule everywhere (`pickSelfCard` — the most
  recently changed flagged card), and saving a self card clears every other
  flag; `putManyWithSync` sends an update of a row this device does not hold
  as a field PATCH from base 0, not a whole record that cleared every key the
  import did not carry. Still open: the auto-fill switches are per device while
  the times they produce are shared (with `formPatch` a form only sends a
  recalculation the user's own edit caused, which narrows it), and the
  keepalive flush on `pagehide` takes no lock (harmless — it never deletes
  queue rows).

- **`discrepancies.resolved` boolean secondary index** (`lib/db/user-db.ts`) —
  IndexedDB can't key a boolean, so the index is inert (same class as the
  airports `isFavorite` bug already fixed). Not a live bug today (all readers use
  `.filter()`, not `.where()`), but removing it needs a Dexie version bump, so
  it's deferred. Do **not** add a `where("resolved")` query against it.
- **Logbook CSV `remarks`** (`lib/utils/parsers/logbook-parser-v2.ts:224-225`) —
  `synthType` and `remarks` both read `cols[17]`. Confirmed against the real
  Scoot "Crew Logbook Report" export: that format has **18 columns and no
  remarks column** (col 16/17 are SYNTH. DEVICES Time/Type). So this is harmless
  redundancy, not data loss — left as-is.
- **Crew logbook CSV times are UTC** (`logbook-parser-v2.ts` ~:62-63) — verified
  by cross-referencing the crew logbook export against the three **labeled**
  schedule reports (UTC / Local Base / Local Station) for the same flights: the
  logbook's dep/arr times match the **UTC** report exactly (e.g. 02/04 SIN→BKK
  `04:49→07:22`; 03/04 SIN→CJB arrival `17:13`, and `17:13 UTC + 5:30 = 22:43` =
  the Local-Station CJB local arrival). So storing them verbatim as UTC (the
  parser's `// logbook is already UTC` comment) is **correct** — there is no
  local→UTC conversion to apply here, unlike the schedule report which carries an
  explicit time-frame header and is normalized via `time-reference-normalizer`.
  (An earlier audit guessed these were local station times; that was a false
  positive.)
- **Clearing a field on the server needs a CURRENT client.** A push from a
  build that declares `SYNC_SCHEMA_VERSION` replaces the stored document, so a
  cleared key is cleared (this fixed `unresolveDiscrepancy`'s leftover
  resolution metadata). A push from an OLDER build is merged, exactly as `$set`
  was, so the `null` sentinel convention (`deletedAt`, `acceptedAt`) stays: it
  is what makes a clear survive that path. Keep writing `null`, not `undefined`.
- **A same-field conflict is settled by device clocks.** Only there: pulls
  rebase and patches merge without consulting a clock. A fast clock is capped
  5 minutes past the server's for the tiebreak; a slow one simply loses ties.
  The losing value is in `syncConflicts` but nothing in the UI shows it yet.
- **The flight form can lose an edit made in its first half-second.** Its
  auto-save takes its "nothing changed" baseline from the FIRST settled form
  state, 500ms after it stops changing (`components/flight-form.tsx`, `baselineFlightIdRef`), so an edit
  typed before that timer fires — or while `resolvedFlight` is still
  loading — becomes the baseline and is never saved. Hard to hit with a fast
  IndexedDB; easy while one was stalled (see the airport seed). Fixing it means
  taking the baseline from the loaded flight AFTER the form's own calculations,
  without saving those calculations on open — deferred, it is delicate.
- **Service worker — still to verify on a real device, offline.** The Oct 2026
  pass changed it (below); a bad SW is hard to roll back, so confirm a cold
  offline start of every route and one update cycle on an installed iPhone
  before trusting it. Still open: app deploys that do not change `sw.js`
  install no new worker, and navigations are served cache-first, so the first
  launch after a deploy runs the PREVIOUS build's HTML — a chunk of that build
  not yet cached 404s on Vercel unless Skew Protection is on (a project
  setting, not code). `STATIC_CACHE` is unbounded (one entry per full-URL
  navigation).

## PWA Details

**Offline and update rules (Oct 2026 audit):**

- **A new service worker WAITS.** `install` no longer calls `skipWaiting()`:
  it activated under every open tab and the page reloads on
  `controllerchange`, so a deploy reloaded the app mid-edit. The page reloads
  only for an update the user asked for (`applyServiceWorkerUpdate` sets
  `reloadOnTakeover`), never on the FIRST install's `clients.claim` — that
  restarted a new user's registration or passkey ceremony once the OCR models
  had downloaded. A worker already waiting at load shows the update banner.
- **`/_next/static` chunks live in `ASSET_CACHE`, apart from the 150-entry
  dynamic FIFO.** A hit never re-puts, so the oldest entries were the
  framework and main-app chunks, and a month of per-flight pages evicted them:
  an offline cold start then got cached HTML and a 503 for main-app.js.
- **The catch-all caches SAME-ORIGIN only.**
- **The Inter stylesheet is fetched `crossOrigin="anonymous"`** — CORS mode, so
  the SW can cache it; a no-cors response is opaque and was never stored.
- **Every route is cached for an offline cold start** (`OFFLINE_PAGES` in
  `auth-provider.tsx`), not just the five list tabs.
- **`navigator.storage.persist()` is requested** at sign-in and boot. Without
  it IndexedDB — and the sync queue in it — is best-effort and evictable.
- **The offline OCR engine's code is fetched while online** (`warmBrowserOCR`,
  at idle, after a 3s floor — it starts the OCR worker, which pulls its own
  chunk and ONNX Runtime's JavaScript), and a failed load is retried rather
  than cached as the answer. The models and the WASM runtime are precached by
  the service worker at install.
- **The install banner sits ABOVE the edge-to-edge chrome, and the chrome
  knows it** (`pwa-install-prompt.tsx`, a browser tab only). It is in layout
  flow at the top of the shell, so the panels move down with it — but every
  VIEWPORT-fixed surface did not: the mobile flight overlay, the signature
  pad, the duty dialog and the import review were all anchored to the top of
  the screen, under the banner. While it is up it publishes
  `--install-banner-height` (fixed surfaces add it) and zeroes `--top-inset`:
  the banner is topmost, so IT clears the status bar, and `--chrome-top`,
  `.pt-chrome-bar`, `.pt-safe` and the nav pill read `--top-inset` instead of
  the raw `env(safe-area-inset-top)` so they do not clear it a second time.
  A new fixed surface under the banner reads those two variables, never the
  env() directly.
- **Chromium's install offer is captured at MODULE scope and spent on the
  first tap.** `beforeinstallprompt` can fire before hydration (a mount-effect
  listener missed it, so the banner never showed), and `prompt()` works ONCE
  per event — keeping the event after a declined dialog left an Install
  button that threw. A declined dialog counts as a dismissal (7 days). The
  "Open" button that appeared after `appinstalled` is gone: a tab cannot launch
  the installed app, so it only reloaded the page.
- **A database that fails to open is retried and SAID** (`retryDBOpen`,
  `StorageNotice`). It used to be final, and every page showed its EMPTY state
  — "NO FLIGHTS YET" over a full logbook.

- **Service worker** (`public/sw.js`): precaches static assets, login page, and OCR models; runtime caches app routes and CDN resources; versioned caches (v4)
- **Manifest** (`public/manifest.json`): standalone display mode, window controls overlay for desktop
- **Offline fallback**: full offline operation with cached data; `offline.html` as last resort
- **OCR models** (~16MB): cached by service worker after first load

### One look on every platform

iOS and Android render the app **identically**. There is no engine sniff, no
`@supports (-webkit-touch-callout: none)` (the WebKit-only hack), and no
material or layout that one browser gets and another doesn't. Vendor-prefixed
properties are fine where they are paired with the standard one or simply inert
elsewhere (`-webkit-overflow-scrolling`, `::-webkit-scrollbar`) — what is not
fine is a rule whose *effect* only lands on one platform.

Three of those were removed: the date-field height and the focused-field
`touch-action`, both gated to WebKit so Android quietly rendered a shorter
input and a laggier tap; and the `.squircle` helpers, which masked with the
Chromium-only Houdini `paint(squircle)` worklet that was never registered, so
the class did nothing anywhere.

The legitimate exceptions are all cases where the OS itself differs, not the
app's look:

- `components/pwa-install-prompt.tsx` — adding to the home screen is a
  genuinely different flow per OS (iOS: Share → Add to Home Screen; Android:
  browser menu → Install app, via `beforeinstallprompt`), so it detects the
  platform to show the right instructions. Do not "unify" it, or iOS users lose
  the only path to installing.
- `components/bottom-edge-blur.tsx` — keys off a real bottom safe-area inset,
  which only an installed iOS app has. Android's window already excludes its
  gesture bar, so there is no band to fade toward and nothing renders. Same
  rule, different OS geometry.

## Database Schema

### User Database (Dexie — `userDb`)

| Table | Purpose | Key Indexes |
|---|---|---|
| `flights` | Flight log entries | id, date, syncStatus, aircraftReg, userId |
| ↳ | Non-indexed additions need no migration: `entryType`, `isSimulator`, `simSessionCode`, `importDecisions`, `scheduleReportAt`, `logbookReportAt`, `toLdgDecidedAt`, `deletedAt` (recycle bin) | |
| `aircraft` | Aircraft records | id, registration, type, userId |
| `personnel` | Crew members | id, name, userId, crewId |
| `preferences` | User settings | key |
| `syncQueue` | Pending sync items | id, collection, timestamp |
| `syncMeta` | Sync metadata | key |
| `userSession` | Local session mirror | id |
| `scheduleEntries` | Roster schedule | id, date, dutyType |
| `currencies` | Certificate tracking | id, code, expiryDate, syncStatus |
| `discrepancies` | Comparisons + import notes (`holding`, `acceptedAt`) | id, type, resolved |

`scheduleEntries` holds **non-flight duties only** — standby, ground, leave,
off. Flights live in `flights` and nowhere else. It is server-synced like every
other user collection.

### Reference Database (Dexie — `referenceDb`)

| Table | Purpose | Key Indexes |
|---|---|---|
| `airports` | Airport reference data (~10k) | icao, iata, [icao+iata] |
| `aircraftDatabase` | Unified aircraft DB (FR24 + custom + MongoDB-synced enriched) | icao24, registration |
| `aircraftTypes` | ICAO DOC 8643 type designators | designator |
| `metadata` | Version tracking for cache invalidation | key |

### MongoDB Collections (server-side)

| Collection | Purpose |
|---|---|
| `aircraftSubmissions` | User-submitted aircraft with enrichment status (pending/enriched/failed) |
| `airportSubmissions` | User-submitted airports with enrichment status |
| `sessions` | User sessions with TTL |
| `deletions` | Tombstones (TTL 30d) for propagating deletes across devices |
| `flights`, `aircraft`, `personnel`, etc. | Synced user data collections |

**Indexes:** `lib/mongodb/client.ts` runs an idempotent, best-effort
`ensureIndexes()` once per warm process after `connect()` — `{userId,id}` (unique)
and `{userId,syncedAt}` on the data collections, the `deletions` TTL/dedup/delta
indexes, and unique dedup indexes on the submission collections. (The
`/api/sync/setup-ttl` route still creates the `deletions` indexes too.) Index
creation is fire-and-forget and never blocks a query; a failure (e.g. a
pre-existing duplicate blocking a unique index) is logged, not thrown.

## Critical Files

When making changes, be aware of these high-impact files:

**Core Infrastructure:**
- `app/layout.tsx` — Root layout, provider hierarchy, PWA preloaders
- `app/(app)/layout.tsx` — Authenticated app layout, responsive nav
- `lib/db/user-db.ts` — Dexie user database schema (schema changes affect migrations)
- `lib/sync/sync-service.ts` — Core sync logic (changes affect data integrity)
- `components/providers/auth-provider.tsx` — Auth context, login/logout flows
- `components/providers/sync-provider.tsx` — Sync initialization (auth-driven: (re)initializes triggers + initial sync when a user logs in, tears down on logout)
- `public/sw.js` — Service worker caching strategies
- `lib/mongodb/client.ts` — MongoDB connection pool (shared across API routes)

**Navigation & Keep-Alive:**
- `components/keep-alive-pages.tsx` — Persistent page shell (changes affect all four main pages)
- `hooks/use-page-active.tsx` — Active route context and `usePageActive` hook
- `hooks/use-detail-panel.tsx` — Detail panel provider (keep-alive route awareness)
- `components/desktop-layout.tsx` — Responsive app shell (sidebar + detail panel)
- `components/nav-pill.tsx` — The pill↔sidebar morph, the nav highlight's slide, and the drag lens
- `lib/layout/panel-widths.ts` — the one panel-width budget (single/dual month, detail minimum, split minimum)

**Edge-to-edge shell & chrome** (one number each — changing one moves every panel):
- `app/globals.css` — `--chrome-top` / `--chrome-bottom` (scroller offsets),
  `--nav-bottom-offset` (where the nav rests), `--content-bottom-inset` (what
  content owes the home indicator), `--panel-gutter` (the shared horizontal
  gutter), and the `html, body` shell itself (clipped, `100dvh` in a tab /
  `100vh` installed)
- `components/ui/chrome-overlays.tsx` — `ChromeFade`, the one floating-header
  treatment (progressive blur under a darkening veil)
- `components/ui/scroll-indicator.tsx` — the inset scroll indicator (fixed thumb
  in `document.body`, sticky marker as the rubber-band sensor)
- `components/bottom-edge-blur.tsx` — the home-indicator darkening fade

**Glass system:**
- `components/ui/glass-container.tsx` — ONE material on every platform: the
  layered ring stack in `globals.css` (blur + edge reflections + a
  conic-gradient specular rim). iOS and Android render the same thing.

  There used to be a second, Chromium-only **lens** path — a per-element
  Snell's-law displacement map + computed rim specular applied through
  `backdrop-filter: url(#filter)` (`lib/glass/displacement.ts`, adapted from
  winaviation/liquid-web, MIT). It is **removed**, deliberately, because it
  made the PWA feel slow rather than crisp:
  - an SVG backdrop-filter **re-rasterises every frame** the element resizes or
    scales, so every morph and every press had to swap the lens out for a plain
    blur and back;
  - each surface rastered and PNG-encoded a pair of up-to-megapixel maps on the
    main thread, which needed a geometry cache, a debounce, a radius tag and a
    cheap stand-in to cover the gap;
  - and it only ran on Chromium, so a phone and an iPad showed different
    materials.

  That is a lot of machinery whose whole output is a rim. **Do not reintroduce
  a platform-conditional material.** If the rim needs more presence, change the
  ring stack — every device gets it.
  - **ONE full-face `backdrop-filter`, on `.GlassBlur`.** This is what makes
    iOS and Android agree. There used to be SIX, stacked on separate elements
    — `.GlassBlur`, `.BlendLayers`, `.BlendEdge`, `.Contrast`, `.Brightness`
    and an `invert(0.1)` on `.GlassContent` — each meant to sample the
    composite of the ones below it. Stacked backdrop-filters are the least
    interoperable construct in CSS: Blink composes the whole chain, WebKit
    does not, so the same code gave a warm dark slab on iPad and a flat grey
    one on a Pixel. Measured in Blink the chain landed on `rgb(71,71,70)` —
    an R-B warmth of **1**, i.e. neutral grey; one list gives `rgb(40,29,19)`,
    warmth **21**.
    A filter *list* on a single element is well-specified; several elements
    each with their own backdrop-filter is not. Do not add a second one.
  - **The washing terms are gone deliberately.** `contrast(0.69)` pulled the
    whole face toward mid-grey (the single biggest grey-maker — 69 units of
    delta on its own) and `invert(0.1)` lifted the blacks. With the chain
    collapsed they were no longer cancelled by anything, so the face is now
    blur + a themed brightness lift + `saturate(1.5)` (the vibrancy term —
    without it the material reads as frosted film rather than glass).
  - **A surface OVER A BLUR is more translucent** (`overBlur` →
    `[data-over-blur]`). The material's opacity exists to stop what is behind
    it reading through as legible content. Where something else has already
    blurred and darkened that backdrop — the header's `ChromeFade` band, the
    mobile sidebar's progressive backdrop, a modal's bottom fade — the work is
    done before the glass gets there, and a full undercoat on top only buries a
    backdrop that is unreadable anyway while costing the material its whole
    point. Only `--glass-base` moves (52% dark / 32% light against the standard
    82/55); the face blur, the veil, the rim and the specular are untouched, so
    it is the same material letting more through, not a second material.

    | over a blur | NOT |
    |---|---|
    | header controls (`GlassIconButton`/`GlassButtonGroup`/`GlassSearchButton` — they ARE the `ChromeFade` band by construction) | the mobile bottom pill — `bottom-edge-blur` is a DARKEN with no blur in it, so the flight cards would read straight through the tabs |
    | the DESKTOP pill in pill shape (same header band) | the DESKTOP sidebar — no backdrop at all, it stands beside the content |
    | the MOBILE nav in sidebar shape (over `SIDEBAR_BACKDROP_BLUR`) | the logbook calendar and its panels, the login page, the import segmented tabs |
    | | the import dialogs — the review is a plain card (see Things to Avoid) |

    The nav is deliberately on BOTH lists, one per shape, and in opposite
    directions on the two morphs — which is why `background-color` rides the
    same 320ms clock as the corner radius on `.GlassMaterial::after`. A solid
    fill is repainted on those frames regardless (the box is resizing), so that
    costs the fill's colour and not an extra pass.
  - **Opacity comes from `--glass-base`, presence from `--glass-veil`.** They
    are two coats on `.GlassMaterial::after` doing different jobs, and the
    split is load-bearing: the veil is a LIGHTENING paint (warm off-white), so
    pushing ITS alpha to make the material more opaque turns a dark surface
    white long before it turns it solid. Opacity that keeps the material's
    colour has to be a coat of the surface colour itself — hence a
    card-coloured base under the veil. Currently 0.82 dark / 0.55 light, which
    with the veil over it lands the face at ~84% / ~86% opaque. The blur, the
    brightness lift and the saturate still act on the remaining fifth, so it is
    glass rather than a card with a rim.
  - **The calendar is the same slab as everything else.** It used to paint
    `--background` at 0.85 over its own glass, which is why it read as a
    different, near-solid material from the action buttons and the nav. That
    overlay is gone; the shared material carries the opacity now.
  - **Contents ON the glass are SOLID** — `--on-glass-*` in `globals.css`. Only
    the slab is translucent; the nav's gravity blob, an action button's active
    highlight, an icon, a label are opaque, the way the controls inside an iOS
    Control Center tile are. A translucent blob over a translucent slab lets the
    page through TWICE, so the highlight drifted in tone as the list scrolled
    underneath it and the icons washed out. Each token is the colour the
    translucency used to resolve to, mixed once against `--on-glass` (the solid
    colour the finished face reads as) and then painted flat. **`--on-glass`
    has to track the real face, not `--card`** — with the veil at 0.11 the face
    was ~0.276 and the blob landed at 0.292, i.e. invisible on a dark theme.
    And `--on-glass-fill` is 16%, not the 10% the old `bg-foreground/10`
    resolved to: that alpha was measured against a nearly transparent slab, so
    the blob separated by picking up whatever was behind the glass. Painted
    flat it has to carry the separation itself. The tokens are: `-fill`,
    `-fill-soft`, `-icon`, `-label`, `-muted`, three weights of accent
    (`-accent-soft` / `-accent` / `-accent-strong`) because on the calendar they
    STACK — a range pill, a flight-day chip on it, a today chip on that — and
    the `-active` pair below. Use these on a glass surface, never
    `bg-foreground/10` or `text-foreground/50`.
  - **ONE selected-thing colour: `--on-glass-active` + `--on-glass-active-fg`.**
    An action button's active state and the nav's gravity blob mean the same
    thing, so they are one fill, not a grey blob in the nav and a tinted chip
    in the header. At `--on-glass-accent`'s 18% the chip barely separated from
    the face; **32%** is a fill you can see is a fill. Its label is a SEPARATE
    token because `--primary` on a 32% tint of itself is the same hue at a
    similar lightness — which is precisely why the active button read as barely
    selected. Measured on the dark theme, ΔL against the fill: **0.25 → 0.46**.
  - **Nav labels are `--foreground`, the same as an action button's icon.** The
    action buttons are ghost `Button`s with no colour of their own, so they
    render at the full foreground; the nav sat two steps down at
    `--on-glass-icon` (55%) / `--on-glass-label` (72%) and read as a dimmer
    class of control on the same glass.
  - **`--glass-veil` is the PAINTED half of the material, and both themes need
    it.** A backdrop-filter can do nothing over pure black — blurring black is
    black, saturating it is black, and brightness is multiplicative, so
    1.25 x 0 is still 0. With the dark veil at `transparent` the slab had no
    face at all on an empty screen and only its rim showed. Warm off-white
    lifts it from +16 to +40 luminance over the background while costing
    essentially none of the colour it picks up over content (measured at 10%:
    warmth 37 vs 38). Plain white at matching presence drops that to 34 and the
    material starts reading grey again — do not "simplify" the tint back to
    white. Currently **0.05 dark / 0.68 light**. The dark veil was thinned from
    0.11 once `--glass-base` arrived: with an 82% card-coloured undercoat
    already giving the slab a face, the veil was pure lightening on top of an
    almost-solid surface and the material came out too pale and too warm for an
    iOS-dark app. At 0.05 the face lands around oklch **0.21** on the default (Graphite) ground — `--on-glass` is derived from `--card` so it tracks every palette — which is where
    iOS's own dark chrome sits (systemGray6 `#1C1C1E` → systemGray5 `#2C2C2E`).
    Do not take it to zero — over pure black the base alone still needs the
    lift, and that is the whole reason this coat exists.
  - **`--glass-face-blur` is one blur, not three.** The old stack blurred
    2px + 2.4px + 0.52px on three elements; sequential Gaussians compose as
    the root-sum-square, so ONE blur is identical optics for a third of the
    work. It carries more of the material's presence now that the veil is
    thinner (4.4px).
  - **A fine ring under a soft glint.** `--softness` (**2.2px**) drives the
    edge/emboss/refraction band widths and the specular conic (`--glass-rim`)
    peaks at **0.52** dark / **0.60** light. Measured: edge **0.586px**,
    emboss 0.66px, `.Highlight` 0.5px. The dim flanks between the lobes stay
    dim — that contrast is what makes it a glint rather than an outline.

    **WIDTH and CONTINUITY are separate knobs, and conflating them sent this
    up to 5px and back.** At 3.4 the ring was thin *and* the conic's flanks
    were at ~0.05, so three-quarters of the perimeter had no hairline at all;
    that was read as "too thin" and the width went up alongside the flanks.
    The flanks were the part actually missing. With them at 0.22 the ring is
    continuous everywhere, which freed the geometry to come back down — 5 →
    3.6 → 2.6 → **2.2px**, a finer line than any of them while still drawn the
    whole way round. `.Highlight`'s padding comes with it (1.25 → **0.6px**): it is
    the widest of the edge layers, so leaving it would keep the rim's apparent
    thickness where it was whatever `--softness` says.

    The conic's PEAK is the separate third knob, and it is what "harsh" means:
    at 1.0 the glint was a hard white catch on a ring this fine, which reads
    as a chrome bezel rather than as light on glass. **0.52 / 0.60** keeps the
    lobes visible against flanks of 0.16. Do not take the flanks down with
    either the width or the peak — they are what hold the continuity.
  - **Even face:** `.GlassBlur` spans the WHOLE face, corner to corner. It used
    to be inset by the ring widths, leaving the perimeter a shade darker than
    the middle — the material read as a grey slab inside a darker frame instead
    of one even fill (iOS Control Center controls are uniform edge to edge). Do
    not reintroduce the inset, and do not feather the face outward either —
    that pulls the tone DOWN at the edges, which is the opposite problem.
  - **`quiet` drops the EDGE filters while a surface is in motion.** The
    material carries five `backdrop-filter`s — the face plus four edge layers,
    three of them masked to a ~2px band but still filtering the whole element
    box. At rest nothing re-rasterises and that is fine. During the pill↔sidebar
    morph, which interpolates `left`/`width`/`height`, all five re-read and
    re-blur every frame on a panel growing to the height of a phone.
    `[data-quiet]` drops the four edge ones for those 300ms; the face keeps its
    own, and the rim you actually SEE is unaffected because the conic specular
    on `.GlassMaterial::before` is a painted background, not a filter. Same
    trick the drag lens uses on its landing (`--settle`), and the exact opposite
    of the old `data-morphing` surge: this removes work rather than adding it,
    and it is a step change rather than an animation.
  - **`.GlassBlur`'s filter value is CONSTANT — it is never animated.** There
    used to be a "morph surge": `data-morphing` on the container raised the
    blur by 6px and the brightness to 1.4 over a 240ms transition, so the
    material swelled like a merging droplet as the pill and the sidebar
    merged. It was described as compositor-friendly (one filter value, not a
    filter graph) and it is not. A `backdrop-filter` is a readback of
    everything behind the element plus a separable blur, re-rasterised
    whenever the geometry OR the filter changes — and the morph already
    interpolates `left`, `width` and `height`, so the readback happens every
    frame regardless. Animating the radius on top meant the kernel changed
    every frame too, so nothing in the pass could be reused, for the busiest
    300ms in the app on the surface a phone user touches most. That was the
    mobile sidebar's jank.

    The swell cannot be rebuilt compositor-side. A second element carrying the
    surged filter and fading in is precisely the stacked-backdrop-filter
    construct that made this material render differently on iOS and Android.
    The `morphing` prop and the `data-morphing` attribute are GONE with it,
    rather than left as a hook with nothing behind it.
  - **The press is tracked on the WINDOW, not the element.** Only
    `pointerdown` is bound to the glass; everything after it listens on
    `window` until release. The element stops receiving pointer moves once the
    finger wanders off it, and — the Android bug — Chrome fires
    `touchcancel`/`pointercancel` as soon as a move starts to look like a
    scroll. That used to run `endPress`, so the glow appeared on touch and died
    the instant the finger moved. A cancel now only drops the bloom and keeps
    the light; a `CANCEL_GRACE_MS` timer closes it out if no further touch
    arrives, so a glow can never stick.
  - **Release ripples.** On lift the light expands from the release point and
    fades (`.GlassRipple` + `glass-ripple`), keyed so a quick second press
    restarts it and self-clearing on `animationend`. Deliberately faint — it is
    a trace of the touch leaving, not an event of its own.
  - **Press bloom and release settle.** Press grows the control to `BLOOM`
    (1.045); release passes UNDER 1 to `RELEASE_DIP` and springs back, the way
    an Apple control lands. `RELEASE_DIP_MS` is how long the dip is HELD, not
    how deep it goes — the spring lags the target, so at 90ms it only reached
    0.983 before being pulled back; 140ms lets it actually arrive (measured min
    0.9722, settled by ~330ms). The NAV PILL gets this too, but only in pill
    shape: `disableTapFeedback={isSidebarShape}`, because scaling a full-height
    panel around a scrolling list reads as the layout wobbling, not a press.
  - **Press glow survives a scroll:** `--glass-press` is set **imperatively**
    on pointer down/up, not through framer's `whileTap`. A native scroll inside
    the surface (the sidebar list) steals the pointer and fires
    `pointercancel`, which ends a tap gesture — so the glow died the instant
    you started scrolling with your finger still on the glass. `pointercancel`
    now only drops the bloom/pull (scaling a scrolling surface janks) and
    `touchmove` keeps feeding the spotlight position until the real lift. The
    fade lives on `.GlassContent::after`'s `transition`.

**Dashboard (two pages, one toggle):**
- `hooks/use-dashboard-view.ts` — which page is showing; a module store, persisted, hydrated in `subscribe`
- `components/dashboard/legal-dashboard.tsx` — page 1: one screen, no scroll, one continuous surface
- `lib/utils/dashboard/pilot-status.ts` — the annunciator, the governing constraint and the NEXT ACTION
- `lib/utils/dashboard/duty-status.ts` — duty phase + the per-duty FDP maximum (read, never invented)
- `lib/utils/dashboard/legality.ts` — the requirement model (currency vs limits); the verdict is the worst requirement
- `components/dashboard/summary-dashboard.tsx` — page 2: the three period blocks, one column
- `lib/utils/dashboard-aggregate.ts` — period totals, the 90-day recency lapse, and the per-flight detail the list unfolds

**Report Import:**
- `lib/utils/roster/reconciler.ts` — classification + the global match assignment
- `lib/utils/roster/match-assign.ts` — cost-ranked pairing shared with cross-hydrate
- `lib/utils/roster/flight-window.ts` — the MATCH window (widened by the sectors) vs the report's stated range (which still bounds deletion)
- `lib/utils/roster/classification.ts` — SAFE / CRITICAL / `TRACKED_FIELDS`
- `lib/utils/roster/executor.ts` — applies a confirmed plan (flights, sims, aircraft, discrepancies)
- `lib/utils/roster/import-decisions.ts` — decision memory, on the shared window
- `lib/utils/roster/report-tracking.ts` — per-source "generated on" watermarks
- `lib/utils/roster/sim-sessions.ts` — structural simulator recognition/dedup
- `lib/utils/parsers/cross-hydrate.ts` — merge a logbook plan with a schedule plan
- `components/import/import-review-modal-v2.tsx` — the consent surface
- `lib/utils/parsers/logten/` — the LogTen Pro migration: `header-map.ts` (name-addressed columns), `values.ts` (non-throwing coercion), `time-reference.ts` (UTC-vs-local detection + the date-shifting conversion), `flights.ts` / `aircraft.ts` / `address-book.ts`, `executor.ts`
- `components/import/logten-review-dialog.tsx` — the migration's consent surface, including the UTC/Local switch
- `lib/utils/parsers/shared/csv-split.ts` — `sniffDelimiter` + `splitDelimitedLine` (eCrew is comma, LogTen is tab)
- `lib/utils/history-markers.ts` — which overlay owns the top history marker, so a deferred release can't pop another dialog's entry
- `lib/db/stores/reference/aircraft.store.ts` — `matchRegistrationKeys` (dashless↔dashed key matching) + the `deletedAt` filter every lookup owes
- `components/flight-card-body.tsx` — the one flight-card definition
- `lib/utils/retention.ts` — the single 90-day undo window (decisions, accepted comparisons, recycle bin)
- `lib/utils/flight-sort.ts` — the one list order (date, out time, departure, id)
- `lib/db/stores/user/flights.store.ts` — soft delete / restore / purge + `isLiveFlight`

**Flight card gestures:**
- `components/flight-quick-actions.tsx` — the flight card's extra actions (Next
  Leg / Return Trip / Duplicate / Share / Lock), cascading out of a `…` button
  in the row's SWIPE PANEL. The panel is `[…] [delete]`.

  **The press-and-hold menu it replaced is gone, and the reason is the gesture,
  not the presentation.** A hold is invisible: nothing on the card advertised
  it, it competed with the swipe and the scroll for the same pointer, and
  holding a row inside a virtualised scroller turned into a long fight with
  whichever engine was delivering the events (an orphaned framer session
  dragging the held card, a few px of finger drift before the menu appeared,
  each needing its own counter-measure). The swipe panel is already the card's
  "what can I do to this" surface and it is already discoverable, so the extra
  actions belong in it.

  **They are not a popover — they are the SWIPE PANEL'S OWN BUTTON, repeated.**
  Each option is a 64px CIRCLE on the action surface (`.control-surface`, see
  "The Action Surface") carrying its icon over a `text-xs` word, CENTRED on the
  `…`, and they travel out from it one after another (`STAGGER_MS`) — the panel
  extending rather than a dialog appearing over it. The swipe panel's buttons
  are capsules on the same surface, so the run is visibly the same family as
  the control it came out of. The word goes INSIDE the circle — outside it,
  floating over a dense list, it landed on a flight's route.

  They were `bg-secondary` rounded squares, deliberately NOT glass, and that
  is what the owner reported against: in the context preview the action row
  was the same flat slab as the card above it and read as more card. The
  objection to glass was legibility over a list (a translucent slab showed the
  cards through the labels); the action surface is the glass face's PAINTED
  half — opaque, the colour the finished glass reads as, with its rim — so it
  is the same material as a header control and nothing shows through.

  `ACTION_TILE_PX` / `actionTileClass` / `ACTION_LABEL_CLASS` are exported
  and the context preview uses them, so the two surfaces are the same control
  in different arrangements rather than two that resemble each other.

  One word each, and the icons are **aeroplanes distinguished by ATTITUDE**.
  A plain plane repeated three times was tried and rejected for the obvious
  reason — "next leg", "return trip" and "duplicate" are all flights, so three
  identical planes distinguish nothing — and a relational set (an arrow, a
  two-way arrow, a stack) was tried in its place. The attitude answers both at
  once: they are unmistakably flights AND they differ.

  | | Icon | Reads as |
  |---|---|---|
  | Next | `PlaneTakeoff` — nose up, leaving | the onward departure |
  | Return | `PlaneLanding` — nose down, coming back | the reverse leg |
  | Repeat | `Plane` — level, unqualified | another one like this |

  That last one is **"Repeat", never "Copy"** — copy reads as putting something
  on the clipboard, and what actually happens is that a whole new flight is
  created.

  Rendered through a PORTAL, so the card's own size never changes — a menu that
  grew the row would move every row below it (measured: card height 110 before
  and 110 with the cascade open). The `…` action passes `keepOpen`, so the
  swipe panel stays put underneath (measured: row x = −144 with the cascade up)
  — the run has to look like it came out of a control that is still there.

  Direction is DERIVED at render from the anchor, not held in state: down by
  default, up when the run would not fit below (measured: a card whose `…` sits
  at y 712 puts its last item at 432, i.e. above the anchor). One answer, known
  on the first render, so the column can never paint downward and then flip.

  **The `…` fires on the LIFT, not on the click** (`fireOnPointerUp`). A click
  is the fragile half of a tap: an engine can suppress it after a drag, a
  capture-phase guard can swallow it, and it arrives last. On device the first
  tap on `…` after a swipe did nothing at all — the second worked — which is
  the shape a lost click makes. Chromium does not reproduce it, so this is a
  mitigation by construction rather than a measured before/after: `pointerup`
  is the same gesture one step earlier, with none of that ordering.

  **A dismissing tap on the `…` itself needs a guard** (`CASCADE_REOPEN_GUARD_MS`).
  The two halves of that tap can land on either side of the unmount: the
  capture-phase swallow closes the cascade on `pointerup`, React tears the
  listeners down, and the `click` that follows is no longer swallowed — so it
  reaches the button and reopens. Chromium orders it that way and WebKit did
  not, which is why it looked like a platform bug; a close STAMP settles it on
  both. An open request arriving within 350ms of a close IS that same tap.

  **While it is open the app can still be MOVED but not OPERATED**, and that
  rule is inherited wholesale from the hold menu — it was hard-won and none of
  it was about the hold. The line is drawn at **`pointerdown`/`touchstart` in
  the CAPTURE phase with `stopPropagation` and NOT `preventDefault`**:
  - `stopPropagation` means the event never reaches any React or framer-motion
    handler, so no other row's drag can start.
  - withholding `preventDefault` leaves the browser's own default — the
    compositor-driven touch scroll — completely untouched. Scrolling is not
    delivered through the listeners being cut, which is the whole trick.
    (Measured: an identical touch drag scrolls the logbook 0→285px with a menu
    open and 0→285px without it.)

  A full-screen scrim is the obvious alternative and it is worse — it kills the
  scroll too. `mousedown` additionally takes `preventDefault`, which is what
  stops a text field taking focus on a desktop click. `click`/`pointerup` are
  swallowed and close it; `scroll`/`wheel`/`touchmove` only close it. The
  swallow ARMS on a timer, because the tap that opened the cascade has not
  dispatched its click yet and would otherwise close it on the same gesture.

  **And the rows are made UNTOUCHABLE, not merely un-listened-to**
  (`lib/utils/menu-lock.ts`). Blocking events at the capture phase says the
  same thing, but only for the events you thought to block, in the order the
  engine happens to deliver them — which is why that took three passes and a
  card still moved slightly on iOS each time. While a menu is open
  `SwipeableCard` sets **`pointer-events: none`** on its root (and passes
  `drag={false}`), so the row stops being a hit-test target altogether:
  nothing can drag it, focus it, activate it or even give it `:active`,
  whatever any engine sends. It costs nothing, because a touch that misses the
  row lands on the SCROLLER behind it, which still scrolls natively. A
  `useSyncExternalStore` module store carries the flag, so the cards get it in
  the same commit the menu opens rather than a frame later.
- `components/flight-context-preview.tsx` — the PRESS-AND-HOLD context
  preview. A hold lifts one row out of the list, shows the detail the compact
  card has no room for (the four OOOI times, block, flight, night, reg, and
  remarks if there are any) and puts the same action set in a row beneath it.

  It is deliberately NOT the `…` cascade, and the split is the point of having
  both. The cascade is a MENU: you know what you want to do, and you go to a
  control that advertises itself in the swipe panel. This is a LOOK: you are
  scanning the list, you want to know more about one row without leaving your
  place, and a hold is the gesture that has always meant "tell me about this".
  The actions come along because once you are looking at it, acting on it is
  the obvious next thing.

  Its scrim dismisses only a tap that STARTED on it (`scrimPressRef`): the
  finger lifting off the hold is the same gesture, and an engine may still
  turn that release into a click — which lands on the scrim, since the card
  has moved out from under the finger — so the preview closed the moment it
  was let go.

  Its positioning wrapper is `pointer-events-none` with the card and the action
  row taking pointers back. The wrapper spans nearly the whole screen so the
  card can be centred, and with pointers on it swallowed almost every tap meant
  for the scrim — on a phone, where hardly any scrim is left uncovered, that
  meant the preview could not be dismissed at all.

  **It GROWS OUT OF the row you held, and goes back into it.** The preview
  opens as an exact copy of that card, on that card — same `px-3 py-1` body,
  same `rounded-xl border bg-card` — and then travels to the centre while the
  detail and the action row unfurl beneath it. Closing plays the same thing
  backwards and only then unmounts, which is why `onClose` is called on a timer
  rather than the overlay being torn down on the tap. Measured at the first
  frame against the row's own box: **dTop 0.0, dLeft 0.0, dWidth 0.0,
  dHeight 0.0**.

  It is **NOT** framer's shared-layout (`layoutId`) morph, and the reference
  implementation that asked for one was deliberately not followed:

  - The source card lives inside the **virtualised** list. A `layout`/`layoutId`
    prop there puts every rendered row into framer's measurement pass on every
    layout change — exactly the per-row measuring the logbook list was rebuilt
    to remove (see the virtualised-list note above).
  - A FLIP morph animates the box by **scale**, and this growth is nearly all
    height, so the card's text would visibly stretch on the way up.

  **The morph IS Shadix UI's `expandable-card` technique** — framer's `layout`
  projection (a FLIP), adopted after three rounds of the hand-derived version
  still reading as less smooth than the nav morph. The difference is
  structural, not a matter of tuning: **nothing animates a length any more.**
  The card is laid out COLLAPSED on one commit (`position: fixed` on the row's
  own box, which we already measure as `anchor`) and EXPANDED on the next (an
  ordinary centred flex child at its natural height), and framer interpolates
  the difference as a transform. Per frame that is a transform and some
  opacities, where it used to be `width` plus two `height: 0 → auto` boxes plus
  an interpolated `boxShadow`.

  The two objections that held it off for three rounds both have answers:

  - **`layoutId` would put every virtualised row into framer's measurement
    pass.** So there is no `layoutId` and the list is not involved at all.
    Shadix shares an id between a collapsed card and an expanded one; we
    already measure the row when the hold fires, so the collapsed box is stated
    outright. Same projection, none of the cost.
  - **FLIP animates the box by SCALE, so `tabular-nums` text stretches.** Every
    content block therefore carries `layout="position"`, which makes it its own
    projection node — framer cancels the parent's scale on it, so it animates
    where it SITS and never how big it is. One wrapper per block is enough;
    everything inside a corrected node is corrected with it. This is what
    Shadix's `layout="position"` on its title and description is for.

  Measured on a 390×844 viewport, opening (row at `[12,12,366,105]`):

  | t | card box | scaleY | compact body |
  |---|---|---|---|
  | 51ms | 12,12,366,105 | — | 103×364 |
  | 108ms | 12,12,366,105 | 0.329 | 103×364 |
  | 250ms | 12,201,366,295 | 0.927 | 103×364 |
  | 649ms | 12,224,366,319 | none | 103×364 |

  The first frame is the row to the pixel, and the compact body is **103×364 in
  every frame** while the card's scaleY runs 0.33 → 1 — the scale correction
  holds exactly. Closing: the card lands back on `[12,12,366,105]` at 459ms and
  the overlay unmounts at 510ms, with **zero frames** where both the overlay and
  the un-hidden row are visible.

  **The card WIDENS, and which projection mode each block gets is what makes
  that possible.** The card's projection scales its subtree on both axes. The
  vertical part must be cancelled — it would crush the row's text to a fifth of
  its height — but the horizontal part IS the card widening, and the compact
  body is supposed to follow it. So:

  | | prop | why |
  |---|---|---|
  | compact body | `layout` (full) | exists in BOTH states, and its own height is 103 either way — so its delta is **scaleX only**. Condensed at the first frame, relaxing out as the card widens. |
  | detail, actions | `layout="position"` | exist only while open, so they have no delta of their own; this cancels the parent's scale outright, which is what keeps them true-size while the card collapses under them on close. |

  `layout="position"` on the compact body was tried first and is wrong for it:
  it lays the body out at the RESTING width from the first frame and lets the
  card clip it, so on a tablet the arrival time and ICAO are simply missing
  until the card has widened past them. Condensed type reads as motion; half
  the flight missing reads as broken. (Shadix hits this too — its title is
  `layout="position"` and laid out at the expanded width from frame one — but
  its text is short enough to fit the collapsed card, so nothing is clipped.)

  Measured at 1180 wide, from a 312px row: card `[12,12,312,105]` at the first
  frame with the body at **310×103**, and `[254,212,672,319]` at rest with the
  body at **670×103** — the body's height is 103 in every frame while its width
  tracks the card's. On a phone `MIN_GROWTH` suppresses the growth entirely
  (measured: scaleX exactly 1 throughout, body 364×103 in every frame), because
  a row is `innerWidth − 24` and the wrapper's margin only allows
  `innerWidth − 32`, so "growing" would mean getting 8px narrower.

  The width only ever GROWS. A row already wider than `MAX_WIDTH` rests at its
  own width rather than shrinking to 672 — shrinking would mean laying the body
  out narrow and stretching it, which is the frame-one mismatch again in the
  other direction.

  **Every style key is supplied in BOTH states, never a switch between two
  differently-shaped objects.** A `motion` component does not clear a style
  property that simply disappears from the object — measured: with the
  collapsed branch dropping `position`/`top`/`left`/`height`, those stayed on
  the element as `position: fixed; top: 12px; left: 12px; height: 104.75px` for
  the whole morph, so the card never left the row and there was no layout
  change to animate at all.

  What remains: the CARD carries `layout`; the compact body, the detail and the
  action row carry `layout="position"`; the detail and the actions are MOUNTED
  only while open (inside `AnimatePresence`) so the card's natural height is
  what changes; and the lift is a static shadow on its own projected node
  (`LIFT_SHADOW`), faded by opacity — it needs `layout` of its own or the
  card's scale would squash a 50px blur, and it sits OUTSIDE the clip because a
  box-shadow paints beyond its element's box and `overflow: hidden` on an
  ancestor takes all of it. That is why the wrapper and the surface are two
  elements rather than one.

  The anchor is the **card's** box (`[data-slot="card"]`), not the row
  wrapper's — the wrapper carries the list's per-row top gap, and 4px out is a
  visible jump on the first frame. And the source row is `invisible` while the
  preview is up: the copy opens on top of it, so leaving it would show the same
  flight twice through the scrim. It comes back at the unmount, into the box
  the preview has just collapsed onto, so there is nothing to see.

  **It comes to rest centred on the VIEWPORT at `MAX_WIDTH` (672 — `max-w-2xl`),
  not in the column the row lives in.** That is what makes the transformation
  visible at all on anything bigger than a phone: held to the width of the panel
  it came out of, the card barely moved and the morph read as nothing happening.
  Measured on a 1180-wide tablet: the row is 336 wide and the preview settles at
  672, centred at x 254. On a phone the row already fills the screen, so the
  width clamps to what it had and the growth is all height (measured: +143px);
  there is nowhere else for it to go.

  The DETAIL arrives a beat after the box that holds it — `opacity` and `y`,
  delayed 30% into the box growth and running for 76% of it. There is
  deliberately **no `blur()`** in that reveal: it is a per-frame filter pass on
  the busiest frames of the overlay, and the delay plus the travel already read
  as content settling in. The box growing is
  the card changing shape; this is the content settling into the room that just
  appeared, and separating the two is most of what makes the expansion legible
  rather than a jump.

  The hold that drives it is the one that was removed from the ACTIONS menu,
  and it keeps every hard-won guard: it cancels on any movement past
  `HOLD_SLOP` so it never fires on a scroll or the start of a swipe, and when
  it fires it dispatches a synthetic `pointercancel` on `window` so framer
  cannot carry a half-started drag into the overlay (that was the ghost swipe).
  The same `menu-lock` applies, so nothing behind the scrim is a hit-test
  target. `QUICK_ACTION_ITEMS` is shared with the cascade — one action set, so
  the two surfaces cannot drift apart.

  **A press on one of the row's CONTROLS is not a press on the row.** The
  pointer hooks are on `SwipeableCard`'s OUTER container, so the swipe panel's
  buttons are inside them — and a thumb resting on the `…` for the 450ms this
  hold takes is an ordinary tap, not a long press. Without the guard, tapping
  `…` opened the PREVIEW instead of the cascade on a phone, where a tap is
  comfortably slower than on a trackpad. The hold bails when the press begins
  on a `button`/`a`/`input`/`textarea` or inside `[data-swipe-actions]`.
- `lib/utils/derive-flight.ts` — what a derived flight carries. Everything that does not change between two legs (aircraft, crew, role) and NOTHING that is a record of a specific flight having happened (OOOI, takeoffs/landings, signature, lock, import + sync stamps) — copying those forward would fabricate a logbook entry.
- `components/signature-dialog.tsx` — signing, full screen. Orientation-agnostic by construction: the surface fills what is left after the chrome, and the strokes are normalised to their own bounding box, so a signature drawn in landscape renders identically in portrait.

  **"Full screen" means the CONTENT REGION, not `inset-0`.** On a phone those
  are the same thing — the dialog sits above the bottom nav, so covering the
  viewport is right. On a tablet they are not: the sidebar and the nav pill
  draw above it, so `inset-0` put the signing surface *behind* them and the top
  of it was unreachable. It takes the main panel plus the detail panel instead:
  `top: --chrome-top` / `bottom: --chrome-bottom` (the same clearance every
  scroller gets — and `--chrome-bottom` is already tier-aware, collapsing to
  the home-indicator inset at ≥1120 where the nav pill is at the top), `left`
  stepped across by `SIDEBAR_WIDTH_PX` **only while the sidebar is actually
  PUSHING** (below 1120 it is an overlay floating over full-width panels, so
  the content region has not moved), and the panel gutter either side. The
  `left` transition matches `PushSidebar`'s, so it travels with the content
  rather than snapping across after it. Measured at 1180: sidebar closed
  `left 12 … right 1168, top 52`; open `left 211` (199 + the 12px gutter).
- `lib/utils/virtual-scroll.ts` — `scrollToIndexSettled`. A dynamically-measured list needs the scroll re-issued until the arriving rows have measured, and convergence has to be read off the ELEMENT's `scrollTop` (`virtualizer.scrollOffset` is written by the scroll listener, so it always looks unchanged in the same tick).

**Swipe & Forms:**
- `components/swipeable-card.tsx` — The single swipe-to-reveal primitive (framer-motion). Used by all lists, the flight form rows, and the crew/aircraft detail rows.
- `lib/utils/pending-actions.ts` — armed destructive actions; outlives the row that armed them.
- `components/ui/form-section.tsx` — Shared grouped section card + header.
- `components/ui/settings-row.tsx` — Shared `SettingsRow`/`ToggleRow`/`ReadOnlyRow` (inset divider, blended inline inputs, swipe-to-clear).
- `hooks/use-crew-form.tsx` + `components/crew-form-body.tsx` — Shared crew form state + body (crew detail panel and `[id]` page are thin wrappers).
- `app/globals.css` — `.row-divider` inset divider rules, `[data-swipe-active]` morph rules, and `[data-swipe-row] input` pointer-events rule (changing these affects every swipe row).

**Reference Data System:**
- `lib/db/reference-db.ts` — Dexie reference database schema (airports, aircraft, types)
- `lib/db/stores/reference/aircraft.store.ts` — unified aircraft reference store (FR24 + custom + MongoDB-synced; no CDN download)
- `lib/db/stores/reference/airports.store.ts` — Airport reference data, favorites, timezone utilities
- `lib/db/stores/reference/aircraft-types.store.ts` — ICAO DOC 8643 type designator lookup
- `lib/submissions/submit.ts` — Fire-and-forget client→server submission with flight reconciliation
- `lib/utils/aircraft-type-utils.ts` — ICAO type code parsing (description → category/engines)
- `components/aircraft-new-form.tsx` — Aircraft creation form with FR24 auto-populate
- `components/airport-new-form.tsx` — Airport creation form with FR24 auto-populate
- `lib/utils/string.ts` — `normalizeRegistration` canonical registration key (shared client/server)

## Things to Avoid

- Do not introduce Turbopack — the project explicitly uses Webpack due to OCR/ONNX compatibility
- Do not add a second test framework — Vitest is the one in use (`pnpm test`), pure-function suites next to their subject; a browser/component runner is a separate discussion
- Do not modify the Dexie schema without considering IndexedDB migration implications
- Do not change sync conflict resolution strategy without understanding the tombstone system
- Do not gate `SyncProvider`'s init on a one-shot `getUserSession()` check at mount — drive it off `useAuth().user` so a login *after* mount (cold-open-logged-out, or logout→login) still initializes triggers and runs the initial sync
- Do not re-fork the per-collection delete/upsert dispatch into switch/if-else chains — extend the single `COLLECTION_HANDLERS` registry in `sync-service.ts` instead
- Do not advance the sync watermark from the client clock — `lastSyncTime` must come from the server-returned `serverNow`, and only after a clean drain (or an `upToDate`)
- Do not gate a sync trigger on the local queue being non-empty — a sync is a PULL as much as a push, and gating it is what made other devices' edits arrive only at login
- Do not store `knownSeq` from anything but a COMPLETE pull's `headSeq`, and do not read the head AFTER the pull's queries — either lets the cheap poll answer `upToDate` past a change the device never received
- Do not reserve seqs outside the transaction that writes them — the counter would show a seq whose row is not readable yet, and the poll can record a head past it
- Do not declare a REQUIRED field (a switch, a count, a list, a time) as `null` or `opt(...)` in `lib/sync/schema.ts`, and do not declare an optional fact as bare `null` — the declaration IS the type rule. A switch that can be `null` is three states where the pilot means two
- Do not write a synced document except through `canonicalizeDocument` — a raw `$set`/`insertOne` is how the collections ended up with records of different shapes. Add a field to the field table in `lib/sync/schema.ts` (the compiler insists), and bump `SYNC_SCHEMA_VERSION` when existing documents need rewriting
- Do not treat an un-versioned push as complete — it may come from an older build that doesn't know a newer field; it is MERGED, only a client declaring the current schema REPLACES
- Do not build a client normalizer from an explicit field list — spread the server record first. The crew normalizer was a list without `deletedAt`, so binned crew came back on every other device
- Do not apply pulled records one at a time — `applyServerChanges` does one transaction, one `bulkGet` and one `bulkPut` per collection. The per-record double lookup + put was most of a first sync's cost
- Do not raise the "syncing" status or fire `onDataChanged` for a poll that found nothing — it runs every 30s while the app is open
- Do not delete a record on the server before its tombstone is written (`/api/sync/bulk`) — that order prevents deleted records resurrecting on other devices
- Do not write or delete a synced record by `{ userId, id }` "first match" — pick the stored copy with `newestCopies` and replace it by `_id`, and purge with `deleteMany`. Until the unique index exists a record can have two copies, and first-match updated the stale one and left a purged record standing
- Do not make `entryType`/`isSimulator` REQUIRED in the flight field table. The table's default is applied BEFORE `NORMALIZE`, so a required `entryType` would stamp "flight" on an old build's `isSimulator: true` row and turn a simulator into a flight; they are `opt` so the normalizer can still see the legacy flag
- Do not write synced documents by hand with EJSON `$numberLong` values — the engine stores numbers as BSON double, and a long is one more spelling of the same field. An admin correction must also take a fresh seq per record (reserved from `counters`), stamp `fieldVersions`, and bump the counter once more at the end, or no device ever pulls it
- Do not ship a `role="dialog"` without `useDialogFocus` (or Radix's own focus scope) — `aria-modal` hides the page from assistive tech but moves no focus; and do not fake the modality with `inert` on the app, which restyles every kept-alive page
- Do not issue a session from a passkey route without calling `verifyAuthenticationResponse` — a `credential.id` lookup is not proof of possession (credential IDs aren't secret). Same for `register/complete`/`add-passkey`: bind the attestation to the server-issued challenge (`webauthn.create` + matching challenge)
- Do not trust client-supplied `userId`/`callsign`/`totpSecret` in `register/complete` — read them from the consumed server-issued challenge doc
- Do not re-tighten the WebAuthn counter check to always-strict — synced/platform passkeys report `signCount 0` forever; only enforce strict increase when a counter is in use (either side non-zero)
- Do not accept a TOTP code without the `auth.lastTotpCounter` replay check, and keep the OTP comparison constant-time (`verifyTOTPWithCounter`)
- Do not verify a TOTP code with a bare `verifyTOTP` — that wrapper is GONE. It called `verifyTOTPWithCounter` and threw the counter away, which is the replay-protection signal, so an unused export sitting next to the correct one was a footgun with the more obvious name. `verifyTOTPWithCounter` is the only entry point
- Do not reintroduce per-file registration normalizers — use the canonical `normalizeRegistration` in `lib/utils/string.ts` on both client and server
- Do not resolve an IATA code without the flight's DATE where one is known — a code can move between airports (`IATA_REASSIGNMENTS`; VTZ went from VOVZ to VOVI on 17 Aug 2026), and the undated lookup took whichever row came first. Pass the instant to `getAirportByIata`, or pick from the enrichment map with `pickAirportAt`; resolve a stored flight by its ICAO first. And never correct a SIGNED or LOCKED flight's airport automatically — note it in Discrepancies
- Do not take a UTC offset at "now" for a flight — `getAirportTimeInfo(tz, at)` at the flight's instant. A whole-career import read with today's offset is an hour out on every flight in the other half of the year
- Do not re-add a bulk CDN aircraft download — the aircraft DB is populated from FR24, custom entries, and the MongoDB enriched pool only
- Do not remove `"use client"` directives — server/client boundary is intentionally designed
- Do not commit `.env` files or MongoDB credentials
- Do not use `npm install` or `npm add` — always use `pnpm` to keep `pnpm-lock.yaml` in sync (Vercel uses frozen-lockfile)
- Do not expose FR24 as the data source in UI — the user explicitly requires online lookups to be transparent (no "Online Results" labels, no Globe icons, no "FlightRadar24" branding)
- Do not add hexdb.io fallback for aircraft lookup — if FR24 fails, manual entry is the only option
- Do not call FR24 from the app except through the gateway Worker (`callFr24Worker` from an Edge route, `lookupFromEdge` from a Node one, `lib/lookup/client.ts` in the browser), and do not let an airport with a BLANK timezone reach the client — the Worker's position-only tiers return `""`, `lookupAirportOnline` / `deriveTimezone` derive the zone from the coordinates, and the client would otherwise store it as UTC. And run every route that calls the Worker on the EDGE runtime: FR24 scores the Worker's caller, and challenges the Node runtime's calls on every endpoint. A route that needs MongoDB keeps that in a separate Node route, as the shared pool (`/api/lookup/pool/*`) does. And do not add an online-lookup route outside `/api/lookup`, or fetch one by hand: a Worker route goes in `LOOKUP_ROUTES` and `LookupRoutes`, one that combines several in `lib/lookup/composite.ts`, and every caller uses `lookup.*` Never hand the Worker's secret to a browser, never expose its `/raw` (an FR24 passthrough) through the app, and expose `/probe` only through `/api/lookup-test` — which stays off in production unless `LOOKUP_TEST_ROUTE=1` is set there on purpose. Both doors answer through `lib/lookup/door.ts`; do not give the test door routing of its own
- Do not bypass `recalculateFlightFields()` `manualOverrides` — users' manually entered field values must never be overwritten by enrichment
- Do not let a hidden keep-alive page recompute on a data change — read data through the hooks that hold it (`useHeldWhileHidden`), and add a new list hook the same way. And never default SWR's `data` to a fresh `[]` per render: it breaks every downstream memo, and under the hold it loops
- Do not put the active route back into context as a plain value, and do not render a keep-alive page's element inline in the stack — either one re-renders all six retained pages on every tab switch. The route is a store whose SNAPSHOT is the per-page boolean (`useSyncExternalStore`), and each page is `memo`ized on its route key
- Do not add pages to `PERSISTENT_PAGES` in `keep-alive-pages.tsx` without considering memory impact — only heavy virtualized pages should be persistent
- Do not use `display:none` for hiding keep-alive pages — `visibility:hidden` is required to preserve scroll positions and virtualizer measurements
- Do not re-add swipe "full-swipe to auto-trigger the primary action" to `SwipeableCard` — it was intentionally removed; actions fire only on button tap
- Do not add a delete path without `showUndoToast` after it — the toast is how a one-tap delete tells the user it happened and how to take it back. It runs AFTER the soft delete; it is never a gate in front of one
- Do not put a confirmation in front of a delete — not a dialog, not a hold, not an armed countdown. Deleting is one tap and `Recently Deleted` is the undo (30 days). The countdown machinery survives for exactly ONE caller, "Sign out of all devices", because that genuinely has no undo; do not wire `holdToConfirm` to a delete again
- Do not move the armed-action timer back inside `SwipeableCard` — it lives in `lib/utils/pending-actions.ts` because a virtualised list recycles rows, and an in-component timer meant scrolling away silently cancelled the deletion. And always pass a **data-derived `id`** to a card that can be armed; the `useId()` fallback changes on recycle and orphans the registry entry
- Do not move the sidebar's gravity blob back into a non-scrolling overlay translated from a scroll listener — that is a main-thread reaction to a scroll that already happened, so the blob trails the items by a frame. It belongs inside the scroller, where it moves on the compositor; the top band is masked anyway, so there is no overshoot clipping to protect it from
- Do not give the morph different open and close leads — one `MORPH_LEAD` keeps the two directions exact mirrors, which is what makes the top pill and the bottom pill read as the same animation
- Do not put a `backdrop-filter` back into the sidebar backdrop, the modal backdrop, or a second layer into `ChromeFade`. Progressive BLUR is a chain of full-viewport readbacks that re-rasterise whenever the backdrop or the geometry changes — under the sidebar that is every frame of the morph, and under a header it is every scroll frame. All three are progressive DARKENING now (`SIDEBAR_BACKDROP_RAMP`, `--modal-scrim-core`, and `ChromeFade`'s single 1.8px layer under its veil), which is one paint and a composited opacity
- Do not put `width: auto` back on the nav pill — `width` animates alongside `left`/`transform`, and CSS can't interpolate to `auto`, so it snaps on the morph's first frame and the pill resizes before it moves. Keep the measured px endpoint from `usePillWidth` (measured only while settled as a pill, in a ResizeObserver callback)
- Do not put a spring or a shape back on the nav highlight — it SLIDES (`slideTrack`, ease-out, sampled to WAAPI keyframes so it composites); the stretch-and-squash soft body read as springy on device. And do not move it with a Framer/JS spring: a main-thread tick hitches when a heavy page mounts. For the nav morph, keep the overlapping per-property delays (`morphTransition`) with the **asymmetric** open/close leads (closing collapses height almost fully before it moves — do not make it symmetric or simultaneous), and keep the phase advancing on **both** the fallback timer **and** the *delayed* property's `transitionEnd` (keyed to `propertyName` so the delayed group is never cut). The **pill** content stays hidden until settled (it squishes mid-morph), but the **sidebar** content is intentionally visible + interactive for the whole open span with its opacity timed to the height (reveal + growth = one motion) — do not gate it back on the settled phase (drops taps) or fade it on its own timeline (reads as two motions)
- Do not add a rule, material or layout that only one engine gets — iOS and Android must render the app identically. In particular do not reintroduce `@supports (-webkit-touch-callout: none)`, the WebKit-only sniff: it silently made Android's date fields shorter and its focused fields slower to take a tap. A vendor-prefixed property paired with the standard one, or inert elsewhere, is fine. The sole exception is the PWA install prompt, where the OS flow itself differs
- Do not let a press inside a PORTAL start a glass press or arm a swipe row — React bubbles synthetic events through portals along the COMPONENT tree, so a menu a glass button opened (the + menu, the camera's Take / Choose Photo, portalled to `<body>`) delivered its `pointerdown` to the button, which then bloomed and stretched after the finger across the menu. `GlassContainer` and `SwipeableCard` ignore a press whose target is not inside them in the DOM (`currentTarget.contains(target)`)
- Do not end the glass press on `touchcancel`/`pointercancel` — Chrome fires those the moment a move looks like a scroll, which is what made the Android spotlight die as soon as the finger moved. Track on the window, treat a cancel as bloom-only, and let the grace timer close it out
- Do not set the dark theme's `--glass-veil` back to `transparent` — a backdrop-filter has nothing to work with over pure black (blur/saturate of black is black; brightness is multiplicative), so the veil is the only thing giving the slab a face on an empty screen. Keep it warm rather than plain white, or the material reads grey over content again
- Do not animate `.GlassBlur`'s filter VALUE — no transition on it, and no `data-morphing` surge. The nav morph already interpolates `left`/`width`/`height`, so the backdrop readback runs every frame; changing the blur RADIUS on top of that means the kernel changes too and nothing in the pass can be reused, for the busiest 300ms in the app. That was the mobile sidebar's jank. The swell it produced cannot be rebuilt compositor-side — a second element carrying the surged filter is the stacked-backdrop-filter construct below
- Do not add a second full-face `backdrop-filter` to the glass — `.GlassBlur` carries the only one, as a single filter *list*. Six of them stacked on separate elements is what made the nav pill warm-and-dark on iOS and flat grey on Android: Blink composes the chain, WebKit doesn't, and neither is wrong. Anything the material needs goes into that one list (and the rim layers stay masked to the edge band)
- Do not give the drag lens's `-refract` layer a `backdrop-filter` instead of its background — the lens is portalled to `<body>` and carries its own `scale`, so it forms a backdrop root and a backdrop-filter there does not sample the pill at all (measured — `blur(10px)` leaves the label underneath perfectly sharp). The layer must paint over the pill it duplicates, or the copy and the original show at once. Cutting the pill out with a mask instead was tried and rejected on the look
- Do not minify the drag lens's copy uniformly — the squeeze is `scaleY` ONLY, with the row counter-scaled so the labels keep their size and only the control gets shorter. And do not push `LENS_SQUASH` much below 0.84: the counter-scaled row has to fit the copy's box, and the mobile pill's 44px tab item in a 56px bar is what sets that floor (at 0.72 the icons and labels were clipped away entirely)
- Do not reintroduce an SVG-displacement glass lens (`backdrop-filter: url(#…)`), or any other material that only one engine gets. It was removed on purpose: an SVG backdrop-filter re-rasterises every frame the element resizes or scales, every surface had to raster and PNG-encode megapixel maps on the main thread behind a cache/debounce/stand-in, and Android ended up looking unlike iOS. The owner's verdict was that it made the PWA feel laggy rather than crisp. One ring material, every platform — if the rim needs more presence, change the ring stack
- Do not delete a user record outright — `deleteEntity` is a **soft delete** into Recently Deleted (30 days) and pushes an UPDATE; only `purgeEntity` writes a tombstone. Push a real delete when the user merely binned it and the row is gone on every device with nothing to restore. The one exception is discrepancies, which are import bookkeeping regenerated by the next report and stay hard. Schedule entries USED to be — that reversed when duties became hand-editable
- Do not merge the dashboard's two pages back into one. Legal and Summary want opposite layouts — an instrument read in two seconds versus a month's review — and one layout serving both is what makes a dashboard a spreadsheet. They get different containers: Legal is laid out TO the height (no scroll), Summary is an ordinary scrolling page
- Do not change a figure in `fdp-tables.ts` without changing `fdp-tables.test.ts` FROM THE REGULATION first — that test transcribes the Fifth Schedule's own numbers, so it is the check ON the tables rather than a copy of them. Same for `rest-period.test.ts` and paragraph 3
- Do not answer "when am I legal" with a single rest-rule lookup — para 3(1)(a)/(b) turn on whether the rest period AS PROVIDED includes a local night, and that grows as the crew member waits. `calculateRestUntilLegal` takes the earlier of "wait for the night, then 10 hours" and "don't, so 12"; a one-shot test at the 10-hour mark reported 12 hours for rest that was legal at 11½ (06:26 shown where 06:00 was legal)
- Do not present a standby as OFF DUTY. It is not a flight duty period and must never reach an FDP gauge, but the crew member is committed and contactable — the panel gauges the standby's own window with the rest clock running beneath it, and the annunciator names it
- Do not treat the rest sub-rules of para 3(1) as alternatives — they are joined by "and", so every applicable one must be met and the requirement is the LARGEST of them. As an if/else chain an 11-hour duty resting without a local night asked for 11 hours instead of 12. The same rule holds in `calculateRestUntilLegal`, which had the chain long after `calculateRestPeriod` lost it — that one is the countdown a pilot reads off the dashboard
- Do not reintroduce a definition the FIRST SCHEDULE already gives. `lib/utils/roster/regulation-definitions.ts` is the vocabulary the Fifth Schedule is written in, and the three terms that were assumed were all assumed WRONG: a local night is any 8 contiguous hours in the **2200–0800** window (not a fixed 22:00–06:00 band, and not any overlap with one), a rest period commences **one hour after free of all duties** (not 30 minutes after gate-in), and "acclimated" is **3 consecutive local nights free of duty in a zone** (not proximity to home base)
- Do not read a rest's local night in the arrival zone — the owner's ruling is 2200–0800 SINGAPORE time wherever the rest is taken (`LOCAL_NIGHT_ZONE_MINUTES`). Acclimatisation's own local nights stay in the zone being counted
- Do not classify an early start or a late finish from ACTUAL times — the First Schedule says scheduled departure / scheduled arrival, and a delayed arrival read as a late finish made para 4 ask for 24 hours
- Do not end a duty period at gate-in. Para 7(2) requires 90 minutes of checks around the flying with at least 60 before it, so at least 30 minutes of post-flight checks are still DUTY — and the rest period commences an hour after that, not 30 minutes after the aeroplane parks
- Do not decide an FDP table from the departure airport's offset alone. `applyAcclimatisation` re-derives each duty against the zone the crew member was acclimated to **as at that duty's report time**, from the duties before it — reading the duty's own arrival zone would let landing somewhere instantly justify its own table. It must run between `mergeDutyPeriods` and `calculateAllRestPeriods`, because the rest calculation reads the corrected figures
- Do not classify a duty's circadian state where the duty period is BUILT — early start, late finish and the window of circadian low are all defined in ACCLIMATED time, and acclimatisation is a property of the whole timeline. The producers store the raw instants (`departureMs`/`arrivalMs`/`takeoffLandingMs`) and `applyAcclimatisation` does the classifying. Carry all three through `mergeAdjacentDutyPeriods` too, or a merged overnight — precisely the shape that lands in the window — is classified against half of itself
- Do not read the window of circadian low against a duty period or a cruise — it is defined "in relation to a **take-off or landing**", 0200–0459. A sector airborne at 2310 and landing at 0650 is over the window for its whole middle and touches neither end of it
- Do not track paragraph 4 inside `calculateRestPeriod` — 4(2) reacts to the two duties BEFORE the one whose rest is being measured, so neither duty in a pair can see it. `calculateAllRestPeriods` carries a `CircadianState` (`stepCircadian`): two consecutive disruptive FDPs make 24 hours OWED before every disruptive one until a DAY OFF (34h with a local night) ends the series; an ordinary FDP breaks the run but does NOT discharge it, and neither does a 24-hour rest. And do not ask 24 hours before a disruptive duty merely because the one before was ordinary — a series runs between days off (the owner's reading, tested against the owner's rosters), so that rest is paragraph 3's
- Do not draw an FDP breach to the sign-off, or the FDP maximum round the whole duty — the FDP ends at the last on-blocks (`fdpEndMs`, `fdpLimitMs`), and the post-flight half hour after it is duty. And do not start the rest bar at the sign-off: rest commences an hour later (`RestBefore.startMs`)
- Do not treat a flight with no wheels times as never touching the window of circadian low — every PLANNED sector and older logbook rows carry out/in only, so the gate times stand in for them. Silence there is the permissive way to be wrong. A LOCAL_STATION schedule report is the opposite case and is left unclassified on purpose: its departure-side and arrival-side times are in different zones the entry cannot resolve
- Do not count only the LONGEST sector for the para 14(2) adjustment — the schedule says long sectorS. Two 8-hour sectors are 4 effective sectors under Table A, not 3, and under-counting raises the FDP maximum. Pass `sectorMinutes: number[]`, and carry `DutyPeriod.sectorMinutes` through `mergeAdjacentDutyPeriods` or a merged overnight silently loses the adjustment
- Do not apply the para 14(2) long-sector adjustment to an augmented crew or to Table C — it applies where the crew "only consists of 2 pilots", and an augmented crew's ceiling comes from para 15 instead
- Do not grant the augmented-crew extension without `inFlightRestFacilities === true` — para 15(3)(b) forbids any extension without rest facilities, and UNKNOWN must withhold it rather than assume in favour of a longer duty
- Do not swap `DEFAULT_FTL_LIMITS` for the cabin-crew figures. Para 12(1) gives FLIGHT crew 90h/14d and 180h/28d; 12(2) gives cabin crew 100h and 200h. This is a flight-crew logbook
- Do not derive a duty's report time from the ACTUAL gate-out. It defaults to the ROSTERED report (`scheduledOut − PRE_FLIGHT_CHECK_MIN`), because a late aircraft under a crew who reported on time is the ordinary case and does not move the report — deriving from the actual OUT slid the duty's start forward with the delay and made the duty look SHORTER than it was (23 minutes hidden on the owner's TR566 duty; three hours on a three-hour delay, with the panel then offering FDP that does not exist). `FlightLog.reportTime` is how a genuinely moved report is recorded
- Do not treat para 10(b) as a variation on 10(a). Under 10(b) the FDP window opens **4 hours after the ORIGINAL report**, which is EARLIER than the actual one — so part of the FDP is already spent when the crew member walks in. `DutyPeriod.fdpElapsedAtReport` carries that, and `ActiveDuty` keeps two clocks (`elapsedMinutes` for the crew duty period, `fdpElapsedMinutes` for the FDP) because only that branch separates them
- Do not give a standby an FDP maximum, and do not let one reach an FDP exceedance check — it is a DUTY period but not a FLIGHT duty period, so paragraph 14's tables never applied to it. `maxFdpMinutes: 0` read as a limit makes every standby a full-length exceedance. Its cap is para 6(2)(a)'s 18 hours. `applyAcclimatisation` skips it (a lookup on 0 sectors would hand it the one-sector figure) and `mergeAdjacentDutyPeriods` will not merge it with a flight duty
- Do not treat a home standby as a duty to rest FROM, called out or not — by the owner's ruling it is rest, and the rest period runs straight through it. `isRestingStandby` is the test and `calculateAllRestPeriods` / `calculateRestUntilLegal` are the two places that skip it. Treated as the duty to rest from, a CALLED-OUT one gave the flight it became a rest of −1:00. It still contributes its 20%, and for days off (para 5) it is a duty
- Do not count a simulator session as a sector, give it para 7's pre-flight hour, or give a session-only duty an FDP maximum (para 9) — and do not let a positioning-only duty have one, or let positioning after the last flight extend the FDP. Read "is this an FDP" through `isFlightDutyPeriod`
- Do not count "3 consecutive local nights" inside one duty-free gap only — the run carries across duties in the same zone (`stepNights`)
- Do not evaluate a para 5 window outside the span the known duties cover, or count a day off anywhere but between two known duties — missing data must never produce a violation
- Do not let `mergeDutyPeriods` consume a date for a NON-FLIGHT duty. Only a schedule flight duty is an alternative record of a logbook duty; a standby is a different duty that happens to share the day — and the day it shares with a flight is the day it was ACTIVATED on, so consuming the date dropped the one standby whose hours needed accounting for and hid the pair from `truncateActivatedStandby`
- Do not answer "was this standby called out" in two places — `findActivationMinute` is the rule, with `truncateActivatedStandby` (duty periods) and `standbyActivation` (schedule entries + flights, for the roster page) as its two callers. And read the ROSTERED report when finding it, or a pushback delay moves the activation later and credits duty hours as standby
- Do not let a standby into the dashboard's active-duty search — it would become the ACTIVE duty carrying `maxFdpMinutes: 0`, so the panel reads as a flight duty whose limit failed to compute. `DutyStatus.standby` is its own band
- Do not hard-delete a roster duty, and do not let a binned one be matched by `bulkUpsertScheduleEntries` — updating a deleted row silently resurrects a duty the user deleted, the same rule the flight reconciler follows. Every read filters `isLiveEntity`
- Do not open what is behind a row in a sheet, a dialog or an in-list expansion on a page with a detail panel — it opens IN the detail panel (see "Main / Detail on every page"). The discrepancy resolution was a sheet over the list it was chosen from; account was one long scroll with accordions
- Do not open anything tapped on the FDP timeline in the detail panel — a tap on it is part of reading it, and on a phone the overlay covered the chart on every one. The page takes the full width instead (`useMainPanelFullWidth`) and gives the panel back only to the Quick Check
- Do not let an app scroller scroll SIDEWAYS — `PageContainer`, `DetailFormPanel` and the dialog scrollers carry `overflow-x-hidden`. Glass inside one reaches past its own box by its edge-blur margin (`.GlassEdgeReflection`'s negative margin), so a segmented control on Discrepancies gave the page 14px of sideways play. Clip at the scroller, never on the glass, which would cut its shadow
- Do not listen for `beforeinstallprompt` in a component — the install banner's module captures and spends it at page load, before any page mounts. Read the offer through `useInstallOffer()` (`pwa-install-prompt.tsx`); the account page's own listener never saw an offer, so its Install button only ever showed manual steps
- Do not put the duty or currency form back in a sheet over the page — a selected duty or currency opens in the DETAIL panel (`DutyDetailPanel` / `CurrencyDetailPanel` on `DetailFormPanel`), beside its list on a tablet and as the overlay on a phone, like a flight or a crew member; a sheet covered the very list it was chosen from. And keep their forms a DRAFT over the live record (`useDraft`), never a copy seeded once — a copy goes stale at the next pull and saving it reverts another device's edit
- Do not count a standby's full length toward the 90h/180h limits — para 6(7) counts **20%** of home standby, and para 6(3) folds AIRPORT standby into the rest period or the following FDP so it contributes nothing separately. `countedDutyMinutes` carries the discount and `calculateRollingStats` reads `countedDutyMinutes ?? dutyMinutes`, so every ordinary duty is untouched
- Do not leave an activated standby at its rostered length (para 6(6)) — `truncateActivatedStandby` cuts it back to the following duty's report before the 20% is taken, or the called-out hours are counted twice: once as standby and again in full as the duty they became
- Do not put flights back into `scheduleEntries`. The roster holds NON-FLIGHT duties only — standby, ground, leave, off — precisely because they have no logbook counterpart and so nothing to reconcile. A parallel record of flights needing reconciliation against the logbook is what made the old roster heavy. And do not add standby as a `FlightLog.entryType` instead: it puts non-flight rows in the legal flight record and breaks the fixed-height card the virtualised list depends on
- Do not drop a non-flight schedule row on the floor. `schedule-parser` used to offer every one to `tryExtractSimDuty` and skip whatever was not a simulator, which is why standby had NEVER been extracted; `tryExtractGroundDuty` runs after it. Normalise the window to UTC and remember the conversion can move the DATE — 06:00 SGT is 22:00 the previous day, and the app keys a duty on its UTC date
- Do not clamp a duty's report to midnight of its flights' date — a 00:30Z departure reports at 23:30Z the DAY BEFORE. Put the duty on the date it was reported for (`dutyDate` in `createDutyPeriodFromFlightGroup`), so every reader building an instant from `date` + `reportTime` gets the right one; keep its id on the flights' date
- Do not compute an FDP maximum anywhere but `deriveMaxFDP` — it is the ONE derivation, and every stage (both producers, the overnight merge, the acclimatisation pass, the hypothetical-duty builders) goes through it. Four sites recomputing it from whatever inputs each had is what put 10:15 on a duty the schedule allows 12:15 for
- Do not enter Table A on `reportTime`. That is when the duty STARTED; the table is entered on `fdpStartLocal`, which is the **original** (scheduled) reporting time in the DEPARTURE station's clock. Para 10(a) is explicit — a delay under 4 hours keeps the maximum on the original report while the FDP starts at the actual one — and a 23-minute pushback on a 2150 report crosses into the 2200–0559 band and takes an hour and a half off the maximum, which then reads as an exceedance the pilot never committed
- Do not shift a LOCAL_STATION report time by the departure offset — it is ALREADY the local time where the crew member reports, so shifting double-counts (eight hours, two bands of Table A, on a UTC+0 departure). UTC shifts by the departure offset; LOCAL_BASE shifts from SGT to it
- Do not HARDCODE an FDP maximum, ever. Under CAAS Reg 14 it moves with report time, sectors, crew complement, acclimatisation and the long-sector adjustment; `DutyPeriod.maxFdpMinutes` already holds the figure `calculateMaxFDP` computed for THAT duty, and `fdpTableUsed` is printed beside it so it can be checked. A duty with no computed maximum shows a dash, not a default — a default is a number somebody might fly to
- Do not add a 7-day duty figure to the dashboard. CAAS imposes 14-day and 28-day duty caps (Reg 12) and 28-day/12-month flight caps (Reg 107); a 7-day limit is not in the regulation and printing one is worse than printing none
- Do not turn the legal page back into a stack of glass cards — six cards' borders, radii and margins cost ~120px of a phone's height, which is the difference between it fitting and not. One surface, hairline `divide-y` rules. And keep it `max-h-full`, not `h-full`: stretching makes the one `flex-1` section absorb every spare pixel and leaves a hole under the last requirement
- Do not fall back to the fullest rolling limit for the "tightest" constraint — a limit REFILLS, so 41% of a 12-month flight allowance is not tight, and reporting it named the least urgent thing on the page. With nothing flagged the answer is the nearest EXPIRY, which is why only `currency` requirements carry `daysUntil`
- Do not sort currencies and rolling limits into one grid. They are different kinds of thing (days that expire vs hours that refill) and mixing them is what made the panel unreadable at a glance — separate bands, and keep the limits PAIRED (Duty 14d/28d, then Flight 28d/1y) rather than four rows sorted by urgency
- Do not split 90-day recency back into separate takeoff and landing cells — they are two halves of one question, and urgency-sorted they did not even sit beside each other. One cell answers with the binding half; expanding shows both
- Do not turn the currency band back into a column of full-width rows, and do not give a currency cell a bar. A currency is a name and a number of DAYS — one small fact — so it is a figure over a caption in a grid read at a glance; a bar belongs to the limits band, where the number really is a fraction of something. And do not expand a cell IN PLACE: one cell opens at a time, in the detail panel, with a ring left on the cell it describes
- Do not tint the currency cells that are MET. The status ramp means met / close / not met, so tinting all of them paints the whole band and leaves the one flagged cell nothing to stand out against
- Do not put rest back in the currency band — it is a property of the duty just flown, not a standing qualification, and a live countdown among expiry dates reads as a different kind of thing. It lives in the duty band, and the annunciator has to fold it into the verdict itself since it is no longer one of the requirements
- Do not print the rolling limits in the duty band as well as the limits band — that was the duplication the rework removed. The duty band carries FDP and flight time for THIS duty only
- Do not derive the duty band's bar colour from how full it is — state the tone. A nearly-full FDP bar is a warning and a nearly-full REST bar is good news; deriving it painted a fully-rested pilot amber. And do not put a standby's window on the status ramp: how full it is is a magnitude, not a verdict (`RAMP.info`)
- Do not put the duty band's ring back. The off-duty question is a COMPARISON of two instants on one axis — when the rest becomes legal, and when the next duty reports — and an arc has nowhere to put the second one. It is a timeline with the report as a CARET and the rest still owed as a red band, so a duty rostered inside the rest period is visible before a word is read
- Do not let the annunciator's second line repeat its headline — when the headline is the governing requirement's own remedy, the line is `status.also` (the NEXT flagged requirement, "+N More"), never "Tightest <the same requirement> <its figure>". And do not paint a limit bar green: a limit with room is neutral, colour arrives with caution or fail
- Do not stand every hour category in the flight form's TIME section — the ones the flight holds and the seat's role time lead (`leadsTimeSection`), the rest wait behind "More Categories". Never fold a category that holds a figure, and never hide a row conditionally elsewhere in the form to save space (the empty Scheduled rows stay): a row that is sometimes absent is a row to hunt for
- Do not offer NOW on a flight that is not dated within a day of today (`isWithinADayOfToday`)
- Do not draw a past sector with no OUT/IN as scheduled — `isUnloggedPast` makes it a gap (amber "not logged", a `Not Logged` caution on the legal page). And do not flag a simulator that way, or a sector before its UTC arrival day has ended
- Do not add a keyboard shortcut that does not go through `isShortcut`, or a `navigator.vibrate` call outside `haptic()` — and never vibrate from a scroll, a render or a timer
- Do not make the logbook's opening scroll run more than once per mount, or over a selection — after the first rows it is the pilot's list, and a programmatic scroll cancels a momentum scroll on touch
- Do not print a bare rest countdown in the annunciator. The hero is `nextAction.headline`, which is the CONTEXTUAL form of the same fact ("Rest short by 3:00", "Rest until 04:36"); a raw countdown there, a copy inside the ring and an "N to go" line beside "Legal from" were three printings of one number
- Do not let `pilot-status.ts` format its own clocks — it is pure, so the formatter is INJECTED (`buildPilotStatus({ formatClock })`, wired by `usePilotStatus(recency, now, display)`). Its own `Intl.DateTimeFormat` was device-local 24-hour with a colon, so a Zulu-configured pilot read one convention in the hero line and another two lines below it
- Do not make the legal page's cells navigate on tap — they open their detail in the detail panel, with the dashboard still in place. The reader came to check a status, and a route change loses the screen they came for. The deep link belongs inside the panel
- Do not replace the sector chain with a list of recent flights — that list showed history, not THIS duty, and could not answer "where am I in a four-sector day". The chain comes from `deriveSectorLegs` off the duty's own route
- Do not let the summary page's flight list grow the page — it scrolls in its own bounded box, so a year-long period cannot push the breakdown below it out of reach
- Do not read an in-progress duty from the logbook alone. `mergeDutyPeriods` prefers the logbook for today, and mid-duty the logbook holds only the sectors already flown — so a two-sector day with one sector logged reads as a duty that ended at lunchtime and the panel falls through to a rest countdown. Pass `scheduleDutyPeriods` into `deriveDutyStatus`; where the roster runs later, the duty is still on
- Do not let a part-flown duty end at its first arrival in the pipeline — `completePartFlownDuties` gives it the plan's shape before rest, para 4 and para 5 see it, and the pipeline runs only through `runFDPPipeline` (one function, tested as the app runs it). And do not end an active duty at its planned end while a sector is still off blocks
- Do not float glass or a blur fade over a dialog's scrolling list. The import review's header and footer floated over its cards on glass — seventeen `backdrop-filter`s (the segmented tabs, two glass buttons, two `ChromeFade`s) re-blurred on every scroll frame: 23 frames over 50ms in a short scroll at 4×, worst 550ms, against 1 frame (117ms) as a plain card, and on a phone the cards faded out under ~300px of blur before reaching the title. A dialog is header / scroller / footer bands on its own surface, with `Button` outline + default. `SegmentedTabs` is on `.control-surface` for the same reason — it always sits in a panel over a flat backdrop
- Do not treat the FDP pipeline's duty periods as the whole plan. `computeFDPResult` filters to `isFlownFlight`, so a sector sitting in the logbook as `scheduledOut`/`scheduledIn` contributes nothing — on a part-flown day with no roster imported there is no plan anywhere, and the panel reads "Roster Clear" and counts down rest between sectors. `buildPlannedDuties` rebuilds the day from the flight rows with scheduled fallbacks; it is for duty shape and FDP only, never cumulative limits
- Do not end the ACTIVE duty at the debrief — the FDP ends at the last ON-BLOCKS, and the duty window carries para 7(2)'s 30 minutes of post-flight checks after it. Keyed off the window the panel kept counting an FDP down for half an hour after the aeroplane was parked. `fdpEndOf` closes it at the last arrival once EVERY sector is on blocks, and not before: an unlogged sector is not a finished one
- Do not measure a duty's FDP to the DEBRIEF — that carries para 7(2)'s 30 minutes of post-flight checks, which are duty but not FLIGHT duty. `DutyPeriod.fdpEndTime` is the last on-blocks and every FDP figure is measured to it
- Do not show "legal from" as the whole answer when a next duty is known. What a rest period has to be depends on the duty AHEAD as much as the one behind (para 4's 24 hours before a duty touching the window of circadian low), so the useful comparison is the rest AVAILABLE before that duty against what THAT duty needs. "Legal from" is the fallback for when nothing is rostered
- Do not format a point in time on the legal page by hand — `formatInstant` joins `useZuluTime`, `timeFormat` and `clockSeparator`, and a page that formats its own clocks disagrees with the rest of the app about what time it is
- Do not tick this page at 1Hz. Nothing on it is shown to the second, so the clock aligns to the minute boundary and holds there; a per-second tick re-rendered the whole panel sixty times for every visible change. Keep the immediate catch-up in a timeout CALLBACK, not a synchronous effect write
- Do not print a figure the gauge already draws, or a countdown the annunciator already runs. "Elapsed" had no denominator beside an FDP line carrying one; "N to go" beside "Legal from" was the third copy of the same number. And the last duty's LENGTH says nothing about whether the next one is legal — its route does
- Do not give a standby its own card shape. It is a duty and must never read as off duty, but the question it raises is the off-duty question — am I legal, and for what — so it takes the same rest gauge and lines with its window added
- Do not format a clock on the legal page without `clockSeparator` — `formatClockDisplay` governs every point in time in the app and this page is not exempt. The view takes it as a prop so the presentational half stays free of the database
- Do not take the FDP maximum, sector count or route from the logbook half of a part-flown duty — Reg 14 sets the maximum by the sectors PLANNED, so a one-sector logbook duty carries a one-sector limit that nobody should fly to. Plan supplies the shape and the limit; the record supplies what has been flown
- Do not put a number inside a meter's fill without checking it fits — below `LABEL_FITS_INSIDE` it goes outside the fill instead. A figure clipped by its own bar is worse than no figure
- Do not print "12 / 12 currencies current" — a pilot does not need telling about the eleven that are fine. The panel names the TIGHTEST constraint, and falls back to the fullest rolling limit only when nothing is flagged
- Do not state a problem without its remedy on the legal page. The next-action line is the imperative ("2 landings required"), phrased in `legality.ts` where the shortfall is in hand — not the reading ("landings 1 / 3"), which the requirement cell already shows
- Do not let a FAILED duty computation or flight read reach the legality model as empty data — it reads CURRENT. Pass `unavailable` to `buildLegalityModel`, and never treat an errored read as `logbookEmpty`
- Do not shrink a touch target below `h-9`, or dim the unselected side of a licence-record choice (`OptionPair`) below `text-muted-foreground` — where the row height is fixed, grow the hit area with an `after:` pseudo-element instead
- Do not use `alert()`/`prompt()` for a form's errors or input — inline `role="alert"` text and inline fields. And do not let a flight form render nothing for a missing or binned flight; it says which
- Do not alarm on an empty logbook — 0 / 3 recency there is an app that has not been told anything, not a pilot who lapsed. `logbookEmpty` drops the recency cell and turns a clear verdict into the neutral `getting_started`; it must never mask a real failure (an expired document still raises ACTION REQUIRED)
- Do not let a standing requirement outrank an exceeded FDP — that one is happening right now rather than being true today, and it is the only thing that overrides the legality verdict for the annunciator
- Do not group the legal page's requirements under headings — they are sorted most-pressing-first so the top-left cell is always the thing closest to stopping the pilot. Headings cost four rules and ~56px to impose an order nobody is reading for on a no-scroll page
- Do not put the period controls (calendar, period pills) on the legal page — they do nothing there, and the action bar is the one thing that can push a button under the centred nav pill
- Do not drop `suppressHydrationWarning` from the legal page's clock nodes, and do not assume it inherits — it applies only to the element it is on. Node's ICU renders `GMT` where the browser renders `GMT+0` for the same zone, so the offset mismatches in production even when the clock value agrees
- Do not rebuild the pilot-status model on every clock tick — `usePilotStatus` buckets `now` to the MINUTE, because the model changes state on minute boundaries and the seconds are read straight off the clock by the component
- Do not reduce the legal page's requirement grid to a banner, and do not compute its verdict any way but the WORST requirement — an average or a majority reads one expired medical as legal. The requirements are the content; the verdict is derived from them and they stay visible
- Do not answer recency with a current/not-current chip — it must carry the LAPSE DATE, and that is 90 days after the flight supplying the THIRD event, not the newest. Takeoffs and landings lapse independently and the EARLIER one wins (a sector flown as PM lands without taking off). The fortnight before it lapses is the only window in which a pilot can still do something about it
- Do not fail a document that is merely inside its warning window — expired FAILS, warning/critical CAUTION. That is the whole reason a currency carries two thresholds. Meter it against its own `warningDays`, never its full validity, or every document sits near empty for a year and the meter says nothing
- Do not match a forecast breach to a limit row by exact string — `forecastExceedances` appends the regulation ("28-day flight (Reg 107a)") where `calculateCapacity` does not. The match is by PREFIX; exact binds every breach to no row and drops the warning silently
- Do not paint a magnitude with the status ramp. Green/amber/red is RESERVED for requirement state (met / close / not met); role hours and type hours are quantities with no status, and they use one hue (`MagnitudeRow`). Sharing the ramp teaches the reader that a colour means the same thing in the breakdown as on the legal page, where it means whether they can legally fly. And never let a state be carried by colour alone — every state has its own icon, in the rows and in the header tally
- Do not give the SUMMARY page a second layout at a breakpoint. It is ONE COLUMN at every width, same blocks in the same order; a wider container buys DENSITY INSIDE a block (2→6 requirement columns, 4→8 detail fields, stacked→side-by-side), never a rearrangement. Every step is a CONTAINER query — the page renders in a resizable split panel, so the viewport's width says nothing about the room a block has
- Do not re-add a ring for the dashboard's period hours — the one it replaced was metered against a hardcoded 100-hour max, so a week and a year drew the same arc. A ratio needs a real denominator; period block hours have none, so the form is a hero figure (with PROPORTIONAL figures — `tabular-nums` reads loose at display size). Day/night does have one and is drawn
- Do not draw the engine split with a single class present — a one-segment part-to-whole bar is a 100% fill under a one-item legend, restating the hero figure. Gate it on ≥2 non-zero classes
- Do not put a number on the dashboard twice. Night and sim live in the period summary (`SHOWN_ELSEWHERE` keeps them out of the breakdown), recency/limits/rest/expiries live in the legality panel, and the alerts bell is scoped to import notes — the one alert class the page does not otherwise show. Every one of those was printed in two places before
- Do not send the dashboard's flight rows to a full page — they open the flight in the detail panel, because the reader is looking at the period as a whole and navigating away loses it. And gate every dashboard write to the panel on BOTH `isActive` and the pathname being `/`: the dashboard is keep-alive, and the pathname moves a commit before the active-route store, so on its own `isActive` let a navigation away write the ARRIVING page's selection into the dashboard's panel
- Do not order flights anywhere but `lib/utils/flight-sort.ts` — the order must be TOTAL (date, then actual-or-SCHEDULED out time, then departure, then id) or rows move on their own: a new flight sat at the top of the logbook until the next refetch and then jumped, and reading `outTime` alone treated every unflown sector as 00:00 so scheduled flights sank below completed ones on the same day. An optimistic cache write inserts with `insertFlightSorted`, never by prepending
- Do not read a user table for a list, a total or an import match without filtering deleted rows (`isLiveFlight` for flights, `isLiveEntity` for the rest) — a binned row reaching the reconciler silently updates, and so resurrects, something the user deleted. The store's own `getAllX` already filters; go through it rather than hitting the table
- Do not use `RETENTION_MS` for a deletion sweep or `DELETED_RETENTION_MS` for a decision — they are 90 and 30 days and the helpers take the window as an argument precisely so a caller has to say which
- Do not clear a retention stamp (`deletedAt`, `acceptedAt`) by setting it `undefined` — `/api/sync/bulk` `$set`s only the keys the payload carries and `JSON.stringify` drops undefined ones, so the server's stamp survives and the next pull undoes the undo. Write `null` and test with `== null`
- Do not rebuild `normalizeFlightFromServer` as an explicit field allowlist — it must spread the server record first, or every field added since it was written is dropped on the way back down (that is how `entryType`/`isSimulator` were being lost)
- Do not write `?selected=` through the ROUTER (`router.push`/`router.replace`) — use `window.history.pushState`/`replaceState`, which Next keeps `useSearchParams` in step with. A router navigation for a query change asks the server for the route's payload and commits the history entry only when it returns: measured ~1.5s after the tap on the dev server, so a back gesture in that window had nothing to pop and left the section, every flight opened was a server request, and opening a detail needed the network in an offline-first app. A change of PATHNAME still goes through the router
- Do not wire a detail's Back to `setSelectedId(null)` — that closes onto the CURRENT page's list, and a detail opened from another page (a link carrying `?selected=`) must go back to the page it came from. The overlay's Back is `backFromDetail`; a link that opens another page's detail needs nothing more than its `?selected=`
- Do not open a detail with a REPLACE — an explicit open must PUSH, or the system back gesture skips the whole section instead of closing the detail. Decide "is it already open" from the URL, not the stored selection (a section keeps its selection while closed). And do not make the "re-sync `?selected=`" effect unconditional: it runs in the same commit as both the open and the back-clear, and will replace the pushed entry / put the param straight back
- Do not remove `overflow-anchor: none` from the logbook scroller — growing the top spacer is how the floating panels push the list, and scroll anchoring exists to cancel exactly that (it bumps `scrollTop` to keep the view still). With it on, the calendar only pushed the list when it was already scrolled to the top, and the compensating adjustment read as a downward scroll that hid the nav pill
- Do not leave a collapsed panel's content painting — the calendar and the logbook's search are mounted at `height: 0` (their natural height must stay measurable), and clipped to nothing their GLASS was still composited: ten backdrop-filters on the logbook for two panels nobody could see. `useStowedWhenClosed` (`calendar-panel.tsx`) hides the content (`visibility`, so it is still laid out) once the collapse has finished, and shows it on the commit that opens it
- Do not give the calendar's collapse and the list spacer separate animations — they share `PANEL_MOTION`, or the panel opens and the list catches up afterwards as a visible second stage. The calendar stays MOUNTED at `height: 0` so its natural height is measurable and the collapse is a px transition the spacer can match
- Do not make the panel divider draggable again, and do not raise the main panel's `minSize` percent above what 360px needs — the two widths are a toggle, and a free drag flips the calendar's layout mid-gesture
- Do not step the dual-month calendar by one month — the panes are a fixed odd|even pair, so a step moves two; stepping by one swaps which side each month is on. The pair only re-anchors when the top flight card leaves it entirely
- Do not reintroduce search CATEGORIES on the logbook — search is a token field: the typed text filters live, Enter pins it as a chip, and chips AND together. The old category tabs were a precondition (typing did nothing until one was picked), and stacking terms covers what they did without the mode
- Do not let flight cards vary in height, and do not put per-row `measureElement` back on the logbook list — the virtualizer corrects the scroll offset when a measured row differs from the estimate, and a programmatic scroll cancels a momentum scroll on touch (that is the "scrolling up stops every row" bug). Keep the optional rows' `min-h`, keep the calibration ONE-SHOT (feeding every row back in is a setState loop that crashes the page), and keep `getItemKey` on the flight id
- Do not inset the app shell by the safe area — the PWA runs edge to edge and content scrolls UNDER the status bar and Android's gesture pill. The insets belong inside each scroller
- Do not size the app shell with `100%` or with a measured/compensated height, and do not put a `transform` on `body`. The shell is ONE box — `html, body { margin:0; padding:0; overflow:hidden; height:100dvh }`, switched to `100vh` under `@media (display-mode: standalone)`. Each unit is wrong somewhere and the split is the point: `100%` resolves against the initial containing block, which under `viewport-fit=cover` + `black-translucent` EXCLUDES the area behind the status bar, so the shell lands short of the screen; `100dvh` is wrong at COLD START in an installed iOS app and does not reliably settle (it corrects after a portrait→landscape→portrait rotation), so sizing from it — and far worse, MEASURING the shortfall and compensating — is a feedback loop that made the app visibly vibrate; `100vh` is correct from cold start in standalone (no toolbar, so `vh`/`dvh`/`innerHeight`/`screen.height` converge) but is the LARGE viewport in a browser tab, where it would hide the bottom nav behind the URL bar. This is a display-mode split, not a platform one — it reads the same on iOS and Android. `overflow: hidden` propagates to the viewport and is what keeps the document unscrollable. A `transform` on `body` would make it the containing block for every `position: fixed` element, changing what "fixed" means app-wide (and what `100%` resolves against on those elements) for no gain once the shell is sized right. Safe-area padding stays inside the bottom nav (`bottom: 4px + env(...)`), never on `body`
- Do not derive the sidebar's open height from `window.innerHeight` — use `calc(100% - …)`, which for a fixed element resolves against `body` (its containing block, via the transform above), the compensated shell. The measured version came out taller than the visible page on iPad Safari in portrait and overshot both ends. Subtract BOTH safe-area insets: one morph is top-anchored and the other bottom-anchored, and each still has to clear the other end
- Do not put the chrome offsets on a SCROLL CONTAINER as padding — use the in-flow `h-chrome-top` / `h-chrome-bottom` spacers. WebKit has long dropped a scroll container's `padding-bottom` from its scrollable area, which strands the last row under the nav pill; an in-flow element is always counted. Padding is fine on a content wrapper that is itself inside a scroller
- Do not add `pb-safe` to page content — a scroller gets its bottom clearance ONCE, from `--chrome-bottom` (via `.pb-chrome` / `.h-chrome-bottom`), and that value already carries the inset. Page wrappers used to add `pb-safe` inside a container that had it too, which on iOS meant a dead strip of ~96px plus TWO home-indicator insets at the end of every list — the "the bottom is padded" bug. One clearance per scroller, declared in one place
- Do not hardcode the header offset anywhere — use `--chrome-top` (or `.pt-chrome` / `.h-chrome-top`). It is the bar (3.25rem: a 4px margin, the 44px controls, a 4px gap) PLUS the status bar, and a bare rem value is exactly how the logbook's search field ended up sliding under the action buttons once the shell stopped insetting itself. `--chrome-bottom` is the matching bottom clearance (nav pill + gesture bar)
- Do not give the bottom pill, the sidebar's lower end, or a scroller's bottom clearance their own safe-area math — they all derive from `--nav-bottom-offset` (`max(4px, env(safe-area-inset-bottom) - 10px)`: hugs the iOS home indicator, plain 4px on Android/desktop). One number keeps the pill↔sidebar morph endpoints aligned and the scrolled-to-rest last row on the same line; `components/bottom-edge-blur.tsx` adds the progressive blur under that line on iOS standalone only (below the nav in z-order so the sidebar and pill stay sharp)
- Do not leave the cloned pill's `backdrop-filter`s (or `mix-blend-mode` anywhere in the lens subtree) in place during a drag or landing — they re-sample every frame and block layerisation, which is what made the release jank
- Do not give the drag lens its own copy of the highlight to land on — it is portalled to `<body>`, so an opaque fill there covers the tab's icon and label and the landing flashes a solid pill with nothing in it. The REAL blob is revealed instead (it lives behind the row) and the glass dissolves off it; the lens stays translucent the whole way, so the content is never covered
- Do not extend the header's band (`ChromeFade`) or its tap-to-top target past `--chrome-top`, and do not let them end at different lines — the bar, the blur and the tap target are ONE band with the action buttons in its middle. A tail below the bar (41px, then 16) and a tap strip 4px beyond the blur made the header's edge unreadable and the tap area too large, and every floating panel under the bar then needed the header to step aside for it
- Do not put the drag-lens (`.PillDragLens`) release settle back on JS (framer `animate()`) or on layout properties — it must stay CSS `translate` + `scale`, which run on the compositor, because the release also fires `router.push` and a main-thread landing stalls against the route mount. Keep the two easings split (position no overshoot, scale overshoot = the splat), keep `--settle` dropping the glass's `backdrop-filter`, and keep the refract clone effect gated on `lensPhase === "drag"` so a deep clone of the pill never runs on the landing's first frame. Keep it clamped to the tab strip (edge overshoot → the liquid bounce) and keep the handoff timer longer than the rebound (or the last wobble is cut)
- Do not re-gate the dashboard's meters / FDP chart behind a deferred-animation flag — the blob is compositor-driven now, so they can animate freely
- Do not turn Recharts' series animation back on (`isAnimationActive` defaults to TRUE on every `Area`/`Bar`/`Line`) — it is a JS rAF loop that commits the whole chart through React every frame: ~120 commits of 430–520 components in the FDP page's first 3s at 4×, and the same again on every zoom and pan step, i.e. through a pinch. A new series takes `isAnimationActive={false}`; the chart's arrival is a compositor fade
- Do not read computed style or layout in an effect that runs on a navigation's commit (`getComputedStyle(x).transform`, a rect) — the arriving page's DOM is still dirty, so the read is a style recalculation of the whole page. The gravity blob's interrupted-move position came from `getComputedStyle` and cost 312ms at 4× on a sidebar tap to FDP; it is computed from the move's own samples and `currentTime` now
- Do not let a keep-alive page listen to a background process's progress while it is hidden — the airports page re-rendered on every 250-row chunk of the seed it had started, while the pilot was on another page. Gate the listener on `usePageActive` as well as on there being something to wait for
- Do not compute the whole period aggregate (`aggregateDashboard`) to read one figure off it — the legal page needs only recency, which is `ninetyDayRecency`. And keep `usePilotStatus`'s duty and legality halves in separate memos: one memo rebuilt the duty model (a pass over every duty window) each time an input it never reads landed
- Do not reintroduce a second typeface — Inter is the single app font (`--font-sans` and `--font-mono` both resolve to Inter); use `tabular-nums` for aligned numbers, never a `font-mono` class or a new Google-Fonts `<link>`
- Do not give `register/complete`, `add-passkey`, the callsign change, or the TOTP-reveal routes a path that skips `verifyAuthenticationResponse`/`verifyStepUpAssertion` — the TOTP seed must never be revealed without a fresh passkey step-up
- Do not give `SwipeableCard` action panels horizontal padding — the panel must collapse to 0 width when closed (the left gap comes from `openWidth`/`justify-end`), otherwise a sliver of the action button peeks at the card edge
- Do not put row dividers as a full-width `border-b` — use the inset `.row-divider` class so the line aligns with the `px-4` text
- Do not give inline form inputs a visible box — keep `border-0 bg-transparent dark:bg-transparent shadow-none rounded-none` so they blend with the row (and `md:text-base` so the font doesn't shrink in edit mode)
- Do not hardcode a surface or accent colour, and do not hand-edit the `palette:light` / `palette:dark` blocks in globals.css — colour is generated from a `PaletteSeed` (`lib/theme/palette.ts`), and those blocks are the default palette's output, pinned by `palette.test.ts`. A new preset is a new SEED; a rule about colour goes into the generator, where every preset and every custom palette gets it. Keep every dark half night-adapted (ground ≤ L 0.17, text never `#fff`), keep the palette off the status ramp and `--destructive`, and keep a scheduled (unflown) flight in the accent
- Do not fetch anything to choose, edit or restore a palette, and do not apply the stored palette before the preferences row has loaded — the boot script has already painted it from localStorage, and applying the in-memory default first flashes Graphite on every launch

**Report import:**
- Do not concatenate the two parsers' new crew cards in a cross-hydrated import — each invents a card for a captain it cannot find (the logbook from a truncated name, the schedule from the full one), so the same person got two. `mergeImportPersonnel` keeps the schedule's card, points the logbook's sectors at it, and drops a logbook card nothing uses
- Do not create fleet records only for the flights an import TOUCHED — a sector the report repeated unchanged is never touched, so its aircraft never got one (9 registrations in production). The executor also covers the flights the report repeated unchanged (`skip_identical` / `skip_decided` / `skip_stale_report`)
- Do not give a flight's `pilotFlying`/`pilotRole` or an aircraft's `engineType` a constant default — not in the schema, a normalizer or a form. A missing PF/PM or role is filled from the record's own figures (`lib/utils/flight-evidence.ts`: takeoffs/landings, role times, a simulator, the "Self" seat), the same rule on server and client; a NEW flight starts as Settings › Logging says (`newFlightPilotFlying`, the seat); an engine type the type data cannot classify stays UNKNOWN, because the dashboard then reads it off the DOC 8643 description, where a constant "SEP" would have counted an airliner as a piston single
- Do not write an imported record with a bare `table.put()` — it is a raw Dexie write with NO sync-queue entry behind it, so the row lives only on the device that ran the import. The importers reached for it because their rows already carry the ids the flight rows point at, which rules out `addPersonnel`/`addCurrency`; `putManyWithSync` (`crud-helpers.ts`) is the shape that keeps the id AND enqueues, in one `bulkPut` + one `enqueueMany` rather than 2N round trips. Crew, currencies and discrepancies were all silently local for exactly this reason
- Do not close the import status dialog when an execution finishes — it is the ONLY surface that renders the summary and the error message, and closing it in the `finally` meant every eCrew import ended in silence with the work done and nothing said. `onDone` closes it; a cancel closes it without setting a summary nobody will see
- Do not fan a per-item enrichment leg out with `Promise.allSettled(remaining.map(…))` — that is every unresolved registration or airport at once, each holding an 8s timeout through one proxy route. Go through `pooledForEach` (`shared/pooled-map.ts`); a roster's handful behaves identically and a career's logbook gets a queue instead of a stampede
- Do not let a schedule report be read without it STATING its time reference — `timeReference` defaults to UTC, and eCrew issues the same report in three frames that differ only by the "All times in …" header line, so a Local Base report read as UTC puts every time in the file eight hours out as an auto-applied `update_safe`. Missing line = refuse the import
- Do not refuse a new account's first import for want of a "This is me" card — the schedule report names its subject (`readReportSubject`), so the import ASKS "Is this you?" as soon as the files are read (before the airport seed) and creates the card from the header on yes: name, crew id, and the seat its rank states (FO → SIC, CPT → PIC). A crew logbook report names nobody, so on its own it still refuses, saying what to do
- Do not import a report without checking WHOSE it is. The header names its subject; nothing was comparing it, so a colleague's PDF wrote their flights into this pilot's logbook as ordinary creates. Refuse only when BOTH crew ids are present and differ — a missing id is an unknown, not a mismatch
- Do not auto-accept an operation whose sector carries `timesUncertain`. It means a LOCAL_STATION row named an airport nothing could resolve, so the offset fell back to zero and the times may be a whole timezone out. `applyDefaultAcceptance` withholds acceptance regardless of kind — a silently wrong time is exactly the change nobody reviews
- Do not feed the reconciler sectors without deduping them (`dedupeSectors`) — a PDF page break that repeats a row pairs the first copy with the stored flight, leaves the second nothing to claim, and turns it into an auto-accepted `create` duplicating the flight matched a line earlier. The key is date + flight number + route + out time, so a genuine repeated-route day keeps all its legs
- Do not scope an import's MATCH pool to the date range the report's header states — eCrew includes the trailing leg of a duty that starts on the last day, so a `01/01 - 31/01` report carries a `01/02` row. Filtering candidates to the stated range left that flight out of the pool, the sector had nothing to pair with, and `create` fired — auto-accepted, so every re-upload added another copy of the same flight. Widen with `flightMatchWindow` (`roster/flight-window.ts`) and keep handing the reconciler the STATED range: its delete pass re-checks `csvDateRange`, which is what stops a spilled sector turning unrelated flights outside the window into deletion proposals
- Do not match an imported sector to a flight by "first unclaimed on this route" — pairing is decided globally in `match-assign.ts` with time as part of the key. The crew logbook report has no flight-number column, so on a repeated-route day the greedy version pairs every leg with the wrong one (see `repeat-route-day.test.ts`)
- Do not parse a report against an unseeded airport table. The bundled `airports.min.json` is otherwise only loaded when an airport LIST mounts, so a pilot who imported straight from the logbook resolved nothing: a Local Base report converted every time to null, dropped every sector as "no parseable OUT time", and offered the matching flights for DELETION. The import calls `ensureAirportDatabase()` first, the schedule parser reads the base AFTER enrichment, and a Local Base report whose base cannot be resolved is REFUSED rather than read
- Do not read the PDF's next-day marker as anything but +1 — it is a bare superscript one set apart by a space (`02:05 ¹`), not the CSV's `⁺¹`. Unrecognised on a DEPARTURE the range never matched and the return leg of every overnight turnaround was dropped
- Do not reclassify the company's OOOI/scheduled/block times as CRITICAL — they are the record of when the aircraft moved and apply without asking. Conversely do not make `pilotFlying`/`pilotRole`/day-night TO-LDG safe: they are the pilot's own account, and every difference is kept as a `Discrepancy` for the licence record
- Do not skip `detectEditReasons` before classification — it is what protects a signed/remarked/manually-overridden flight regardless of which fields changed
- Do not dedupe simulator sessions on `date|simSessionCode` alone — recognition must stay structural (no route, no registration), or sims written by an older build duplicate on every import
- Do not read `FlightLog.entryType` directly — go through `getEntryType()`, and write through `entryTypePatch()` so the legacy `isSimulator` flag stays in step for the dashboard and FDP pipeline
- Do not count a positioning sector anywhere hours, landings or sectors are counted — read the entry through `isOperatedFlight` / `isPositioningEntry`, never `!isSimulator`. It is duty (keep its OUT/IN in the duty window) and nothing else
- Do not let solo time on a two-pilot type pass silently, and do not zero it either — `soloConflict` flags it in the form; the figure is the pilot's to correct. And keep solo auto-fill OFF by default: a record cannot see passengers
- Do not seat crew from an eCrew report by "first CPT, first FO" — the PIC seat is the commander, the SIC seat is this pilot when they are one of the FOs, and every other pilot is a relief pilot (`deriveSectorCrew`)
- Do not name EASA in Settings or a helper until its wording is verified (`available: false`), and do not add a CAAS name that Appendix B does not give without marking it unconfirmed
- Do not hardcode an hour category's name — the flight form, Auto-fill, the dashboard and the import card all read `TIME_CATEGORIES` (`lib/utils/logbook-rules.ts`) through the pilot's chosen rules. And do not hide a category's figure because the rules or an Auto-fill switch say so: a category the rules do not keep is still shown once it holds time
- Do not resolve the pilot's PF convention without the flight's DATE — `pfRoleFrom` is the PICUS check-out, and a flown leg before it is SIC. And do not let an import apply a `pilotRole` change whose `pilotFlying` half was withheld or declined: the role follows the PF the flight ends up with (`settledRole`), or a PM leg is logged PICUS
- Do not take an eCrew report's day/night takeoff and landing split as fact — audited against a real year it disagrees with the sun on 86 of 283 events (a "day" landing with the sun 78° down). The sun's answer is applied to creates (`suggested*` in `hydrateFlightFromSector`) as it already was to updates, and a PF sector carries BOTH a takeoff and a landing even where the report recorded only one (`suggestToLdg`)
- Do not read an OFF or ON on the flight's own date when it is earlier in the day than OUT — the flight is keyed on OUT's UTC date, so it is the NEXT day (`instantOnFlight`; pass `outTime` to `calculateTakeoffsLandings`). And civil twilight is GEOMETRIC: the sun's centre 6° below the horizon with no refraction term, which moved every dusk ~13 seconds and called a −6.02° takeoff "day"
- Do not parse a UTC offset as an integer — `GMT+05:30` is 5.5. `getAirportTimeInfo` read the hours only, so every Indian airport was stored as UTC+5 on its flights, half an hour out for the FDP calculator's local report time and anything else reading local time. `offsetHoursFromName` (`lib/utils/tz-format.ts`) is the one parser, `getAirportTimeInfo(tz, at)` takes the flight's instant where DST could differ, and `repairFlightTimezones` puts stored offsets right once per launch through `updateFlight`
- Do not leave a simulator's pins on an entry that becomes a FLIGHT — a sim pins `simulatedInstrumentTime` and its 00:00 `nightTime`, and carried into a flight the night pin holds night at zero through every recalculation (four production flights carried them). `withoutSimulatorPins` drops both on the switch, keeping a night pin only when it holds a real figure
- Do not let a simulator's duration reach `blockTime` — it belongs in `simulatedInstrumentTime`, which is what keeps sims out of flight-hour totals — and do not let any RECALCULATION put it there. `recalculateFlightFields` returns `simulatorRepairPatch` for a simulator instead of deriving anything, and the flight form's `calculatedFields` returns zeros for one; both used to compute a block time from the session's OUT/IN and a role time from that block. Production carried seven sessions at 4–6h of block and two at 4h of SIC from exactly that (the form on every open, the roster import's `postWriteRecalculate`). `repairSimulatorEntries` puts such rows right once per launch, AFTER the initial sync and through `updateFlight`, so the fix is an ordinary field patch every device pulls — never correct synced data by writing to MongoDB directly, which skips the sequence the devices pull from

**LogTen Pro migration:**
- Do not route a LogTen migration through `reconcileRoster` — that reconciler rewrites flight numbers into the `TR…` house style and files everything else as `skip_non_airline`, which is right for one airline's recurring roster and wrong for a career's logbook. The migration has its own three ops (`create` / `skip_duplicate` / `update_fill`), and `update_fill` writes only fields the existing record leaves BLANK
- Do not address a LogTen column by index — the Flights tab is ~280 columns whose set depends on which fields the user enabled, and LogTen ships two naming styles. Go through `header-map.ts`'s aliases, and keep the duplicate-label suffixing (`notes#2`) — the Aircraft export really does have two "Notes" columns
- Do not assume a LogTen export's clock times are UTC. It carries no marker and exports whatever the app was set to display; `detectTimeReference` votes across the file's cross-timezone sectors, and when it comes back `assumed` the pilot has to be asked before anything is written. Converting a local time must move the DATE too when it wraps — the app keys a flight on the UTC date of its out time
- Do not let the migration recompute what LogTen already recorded — set the matching `manualOverrides` flag for every field the file populated (`preserveSourceValues`), or first save silently restates totals the pilot has already certified. Only a NON-ZERO day/night TO/LDG count is pinned; a blank means LogTen didn't record the split and the sun calculation is the better answer
- Do not recognise a LogTen simulator from `flight_simulator` or `flight_type` — the first is blank on the sim row of a real export and the second is an unlabelled enum index. It is structural (no registration, no route), the same rule as everywhere else, and the executor must skip the recalculation pass for sims or the recomputed block time reaches flight-hour totals
- Do not store a LogTen registration as the file spelled it once the lookup has resolved it — `9VSKU`, `9vnca` and `9V NCA` all mean the record the chain returned, and its punctuation is what the app stores. A flight card reading "9VSKU, A21N" beside an aircraft list reading "9V-SKU, A388" is two different aeroplanes as far as the reader can tell. A resolved lookup outranks the file on the TYPE too (`preferFileType` is the escape hatch for a re-issued registration)
- Do not let a `bulkGet` be the whole registration lookup — it matches the primary key exactly, so a dashless input never finds a dashed stored key, which is the common case for a migrated logbook. Keep the normalized fallback over the table's primary keys (`matchRegistrationKeys`), and keep it gated on the keys that actually missed
- Do not let a soft-deleted reference aircraft answer a lookup — it reads as a live local hit, so the entry stays invisible in the list AND the enrichment chain never asks the network for it again. That is what made a deleted aircraft impossible to re-import
- Do not break either half of the aircraft loop: an unresolvable tail is seeded into the reference DB so a later flight import finds it locally, and a fleet import back-tags flights that have a registration and no type
- Do not write a migrated pilot's own name into a crew seat — the app's convention is `"Self"` (what `deriveSectorCrew` writes on every eCrew import, and what the flight card renders verbatim). Their own name in the seat reads as though somebody else was flying
- Do not make `values.ts` throw. A corrupt cell degrades to a blank and the row parser decides whether that is fatal — that is what stops one bad line taking down a 4,000-flight migration. Keep `toDuration` and `toClock` separate too: a duration may exceed 24h, a clock time may not, and a four-figure totals row wrapping into a plausible departure time is a silent error

**Formatting & chrome:**
- Do not build a date with `toLocaleDateString` or an `Intl.DateTimeFormat` of your own — every day a pilot reads is `formatDay` / `formatDayAt` / `formatStamp` (`Fri, 27 Nov 26`), with parts dropped where there is no room, never reordered. Month-first crept back in one page at a time, through `en-US` formatters and the device locale
- Do not format a clock time with `formatHHMMDisplay` — that is for durations (which always keep their colon). Points in time go through `formatClockDisplay` so `clockSeparator` governs them all
- Do not use a flat `bg-black/50` for a modal overlay — use `MODAL_SCRIM`; black at 50% is invisible over a dark app and turns the light theme into grey mush
- Do not add the sidebar's floating-strip treatment to only one morph — `DesktopPillMorph` and `MobilePillMorph` must both float the toggle/sync strip over the nav with `topInset`, or the scroll-under silently works on desktop and not on a phone. And keep the dissolve mask on the blob overlay as well as the nav (on the OUTER, untranslated element), or the blob stays solid in a band where its own row has faded out
- Do not let the header veil go solid or lean on blur for the treatment — `ChromeFade` is a **darken with a hint of blur**: the gradient tops out at 50% `--background` and the blur ramp peaks at 2.4px. A solid veil hides the content passing under the status bar (reads as the app stopping there — the web-page-in-a-frame look the edge-to-edge work removed), and a heavy blur smears it into an unreadable band. Text sliding under the bar must stay legible enough to make out roughly what it says
- Do not re-enable the native scrollbar on an app scroller — iOS draws its indicator across the scroller's whole box, i.e. from the screen edge over the status bar. Scrollers carry `scrollbar-hide` + `components/ui/scroll-indicator.tsx` as the FIRST CHILD; it draws the same affordance inset to `--chrome-top` / `--nav-bottom-offset`, so it starts below the action buttons like a native scroll view's `scrollIndicatorInsets` while content still scrolls under the chrome. At either end it must **compress against the end of its track**, not ride the rubber-band: progress is clamped so the thumb is already parked, and the overscroll distance squashes it (asymptotically, so a hard fling never collapses it to nothing)
- Do not cache the scroll indicator's scroller box behind a ResizeObserver alone — opening the sidebar SLIDES the main panel across without resizing it (`0..360` → `199..559`), so no observer fires and the thumb stays at the closed layout's right edge, drawing a grey rule down the middle of the flight cards. Re-read the box in the update
- Do not rely on the cascade's event blocking alone to keep cards still — while a menu is open `SwipeableCard` sets `pointer-events: none` on its root and drops `drag` (`lib/utils/menu-lock.ts`). Intercepting events only covers the events you thought of, in the order an engine happens to send them; removing the row as a hit-test target covers all of them, and the touch still reaches the scroller behind it so the list keeps scrolling. The lock is a COUNTED hold (`setMenuOpen(true)` takes one, `false` releases one): with a single flag, whichever overlay's cleanup ran last decided the answer, so a menu closing as another opened could unlock the rows under the one still up
- Do not move the scroll indicator's thumb back INSIDE the scroller — it is a `position: fixed` element in `document.body`, placed against the scroller's cached box. It lived on a sticky anchor inside the scroller once, with its drift measured and cancelled per frame: that pinned correctly while a finger dragged, but the rubber-band RELEASE is compositor-animated and the correction runs on the main thread from coalesced scroll events, so the track visibly snapped back with the bounce. Nothing inside the scroller can win that race. The zero-height sticky marker that remains is only a rubber-band **sensor** (its drift is the bounce distance for engines that clamp `scrollTop`) and is read at the TOP only — at the bottom it stays pinned, so measuring there returns the whole scrolled distance and collapses the thumb
- Do not let the logbook's first card butt against the chrome, or start it lower than any other page — `LIST_TOP_GAP` is `--content-top-gap` (16px), where every page's title starts (measured: 68 against `--chrome-top` 52 on every page). It is DROPPED while the search or the calendar is open: that panel's own bottom edge is the separation there, and the gap read as slack hanging off the calendar (measured: first card at 415, exactly the calendar's bottom)
- Do not give a page's content its own bottom padding on top of the shared clearance — one clearance per scroller, from `--chrome-bottom` (`.pb-chrome` / `.h-chrome-bottom`), and a card list's per-row gap belongs on the row's TOP (`pt-1`), never its bottom. A trailing per-row gap stacks on the spacer and lands that panel's last row lower than every other panel's (the logbook, aircraft, airports and crew lists each had one; the logbook's 8px is subtracted from its spacer because its wrapper padding can't move)
- Do not let ANY scroller chain its overscroll to the document — every app scroller carries `overscroll-contain`, so a flick that reaches the end of a list can never reach the page. Together with the clipped shell above that is what removed the "free play" where a page with nothing to scroll still moved and carried the fixed action buttons off screen. Verified by sampling `scrollHeight − clientHeight` on the document continuously through load: 0 on every route, in both axes
- Do not bleed a row past the panel edge with a hardcoded `-mx-*` — use `.-mx-panel`, the negative of `--panel-gutter`. A `-mx-4` against the 12px gutter pushed the chip strip 4px past both edges, which is horizontal overflow the root no longer clips (that was the left/right jiggle on currencies and discrepancies)
- Do not pick a `px-*` by hand for a panel's content wrapper — use `.px-panel` (`--panel-gutter`). The logbook and flight form were at 8px, the sidebar at 12px and the reference/settings pages at 16px, so the three panels visibly disagreed at their edges
- Do not conflate the two bottom numbers: **content** clears the home indicator by the FULL inset (`--content-bottom-inset`, which `--chrome-bottom` is built from — the platform convention), while the **nav pill and the sidebar** hug it with the tighter `--nav-bottom-offset`. The pill is a floating control that is meant to sit close, and the sidebar runs down the side where the indicator never reaches it; giving content the nav's offset tucks the last row under the indicator
- Do not add an inline copy of the header gradient — render `ChromeFade` (it now carries the progressive blur + fade as one treatment; an inline gradient silently loses the blur). Do not swap the top/bottom edge treatments: blur belongs to the TOP band only (the bottom band is too short — blur there read as smearing and the owner rejected it; the bottom gets the darkening fade in `bottom-edge-blur.tsx`). And do not paint a `--background` scrim over a translucent glass surface (the sidebar) — mask the content out instead
- Do not leave `--on-glass` at a guessed value when the material changes — it must equal the colour the FINISHED face reads as (base + veil + the brightened backdrop through the remainder). Get it wrong and everything painted on the glass lands on the wrong side of it: at the old value the nav's gravity blob (0.292) was indistinguishable from the face (0.276) in dark mode
- Do not name only the anchor month while the calendar is showing two — the header and the month picker both cover the pair
- Do not give a glass surface `overBlur` because it looks better — it is a claim that something has ALREADY blurred what is behind it, and the two bottom treatments are not the same: the header's `ChromeFade` carries a real progressive blur, `bottom-edge-blur` is a darken with none. The mobile bottom pill over a scrolling logbook is the case that breaks if you get this wrong
- Do not drive the glass's opacity from `--glass-veil` — that coat is a warm LIGHTENING paint and raising its alpha whitens a dark surface instead of solidifying it. Opacity belongs to `--glass-base`, the card-coloured undercoat; the two are separate on purpose
- Do not paint an extra background over a glass surface to make one instance more opaque (the calendar did, at `--background` 0.85, and read as a different material from every other glass surface). Change the shared material instead
- Do not put a translucent fill or a `/NN` text colour on a glass surface — contents ON glass are SOLID (`--on-glass-*`). Only the slab is translucent; a translucent highlight over it shows the page twice and changes tone as the content scrolls underneath
- Do not save or restore the flight form's scroll offset without the flight it belongs to — the restore is for coming BACK to a flight (from a picker, from another section), and saved bare it opened the next, different flight at the depth the last one was read to. A flight changing under a mounted form (desktop) starts at its top. And offer no "USE" while the block is 0:00: a column of "USE 0:00" down an unflown sector offers to copy a zero
- Do not put a padded `CardContent` in a bare `Card` — the shadcn `Card` carries `py-6 gap-6` of its own, so the two stacked: the currency, discrepancy and duty cards each had ~24px of empty band above their header and below their last line, and every `EmptyState` sat in 72px of top padding. A card whose content brings its own padding takes `py-0 gap-0`
- Do not turn the currencies page back into a card per currency or put filter chips over it — it is ONE grouped list (`CurrencyCard` is a row), "Needs attention" then "Current", soonest first, and a pilot's ten documents fit one phone screen (measured: 0px overflow at 390×844 and 360×780). A card each was ~210px and five screens of scrolling to learn what runs out next. Thresholds, notes and the auto-update switch are settings OF a currency and live in its editor; past a year the figure is years ("7.9y"), not "2888d". The code under the name is shown only when it says something the name does not (`describesMoreThanCode`, `lib/utils/string.ts` — the dashboard's rule): "Passport / PASSPORT" and "CRM / CRM" were the same word twice
- Do not let a `useBackDismiss` overlay close on a popstate that was not its own — every listener hears every pop, so a date picker opened OVER a form sheet closed the sheet too when it saved. Each marker entry carries `__overlayId`, and a listener whose entry is still the current one ignores the pop
- Do not vertically CENTRE the login form — centred, every step's different card height moved the brand and the card, and on a short phone iOS panned the page to lift a centred field above the keyboard. It is anchored at `clamp(1rem, 12vh, 7rem)` (`vh`: the large viewport, which a toolbar does not change), compact under 500px of height, over a FIXED, still background (the Ken Burns zoom read as the page moving)
- Do not hand-roll a form dialog — `RegionSheet` (`components/ui/region-sheet.tsx`) is the shell: content-region bounds, header with a close, grouped `FormSection` rows, Cancel/Save in the footer with the reason Save is disabled said beside it. The discrepancy-resolution form uses it (a choice among a few answers is a checked LIST, not a dropdown), and the signature pad takes its bounds from `useContentRegionStyle`. A form for a record chosen from a LIST is not a sheet at all — it opens in the detail panel (`DetailFormPanel`). The currency form was a centred modal of boxed inputs with a full-width button and read as a different app. Mount the form only while open and key it on the record, so `useState` initialisers seed it — never a reset effect
- Do not clear the header's action buttons unconditionally on cleanup — `useRegisterActions` clears only what THIS page put there (`current === own ? null : current`). A keep-alive page learns it is inactive from the route store AFTER the commit that mounted the next page, whose layout effect has already registered its own buttons, so an unconditional `set(null)` wiped them: currencies, discrepancies and FDP came up with an empty header when arrived at from the logbook (once their code was prefetched), and with a full one from any ordinary page
- Do not show "Something went wrong" for a chunk that will not load — that is the previous deploy's HTML asking for code the new deploy no longer serves (navigations are cache-first). `ErrorScreen` (every error boundary) recognises it (`isChunkLoadError`), drops the route's stale page from the worker's cache and reloads ONCE, guarded by `sessionStorage` so a genuinely missing chunk cannot loop
- Do not let the wheel picker emit a value before its settle lands, and do not let a zero-length settle stop between rows — the library (`@ncdai/react-wheel-picker`, `patches/`) truncated the index on both paths, so releasing between 09 and 10 always took 09 and a controlled picker's own value change cancelled the settle on every release. A release held still (>100ms since the last move) has no fling and settles to the NEAREST row. And do not let it refuse a touch that is not `cancelable` — WebKit sends one where it has not routed the region's listeners synchronously, and the calendar's wheels then did not move at all on an iPhone; the patch drags regardless and the wheel is `touch-action: none`. The patch is part of webpack's cache key (`PATCHES_FINGERPRINT` in `next.config.mjs`): webpack re-reads `node_modules` only on a version change and a patch keeps the version, so a restored `.next/cache` shipped the unpatched module. A new patch goes through `pnpm patch`, with `patchedDependencies` in `package.json` (not `pnpm-workspace.yaml`) and only the patch lines changed in the lockfile
- Do not make the wheel's highlight row translucent — the wheel draws the selected value twice (small and rotated, then bold in the highlight), and a translucent strip showed both. `.wheel-fill` (globals.css) is opaque, on the bar AND each wheel's row (`wheelClassNames`). It is a CSS class rather than an arbitrary `bg-[color-mix(…)]`: Tailwind generated nothing for that one
- Do not give a full-surface overlay `inset-0` on desktop — the sidebar and the nav pill draw above it, so it ends up BEHIND them with its top unreachable (that was the signature pad on iPad). Take the content region: `--chrome-top`/`--chrome-bottom`, plus `SIDEBAR_WIDTH_PX` on the left only while the sidebar is PUSHING (below 1120 it overlays full-width panels and the region has not moved). Mobile keeps `inset-0` — there the dialog is above the bottom nav and the viewport IS the region
- Do not redeclare the sidebar's width — it is `SIDEBAR_WIDTH_PX` in `lib/layout/panel-widths.ts`, part of the same budget as the panel widths (1180 − 199 − 1 = 980 on iPad Air 5 landscape). It had drifted into three separate copies
- Do not hardcode the panel widths — they live in `lib/layout/panel-widths.ts` and are a single budget. `DUAL_MONTH_PX` is 600 rather than 620 because 620 + 360 detail is EXACTLY the space iPad Air 5 landscape has with the sidebar open, so it fit with zero slack and any rounding took the dual-month toggle away on the owner's device
- Do not let the calendar's HEIGHT depend on its width — the rows are a fixed height, which is what lets a single month (`SINGLE_PANE_PX`) be wider than a dual pane (`MONTH_PANE_PX`) without the width toggle resizing the calendar under the flight list. Give both modes the one header row (a per-pane caption was 12px of difference), and keep a cap in the split layout: uncapped, a single month stretched across the wide panel for the frames before the dual-month switch caught up
- Do not thin the rim by dropping the conic's FLANKS — iOS's controls have a hairline you can see ALL THE WAY ROUND, and at flanks of ~0.05 three-quarters of the perimeter had none. Keep the lobes concentrated (that is what reads as light on a curve) and the flanks around 0.22; the ring's WIDTH (`--softness`, and `.Highlight`'s padding with it) is the separate knob, and it is only free to be fine BECAUSE the flanks hold the continuity
- Do not go back to ONE image input for the camera button — Android 14+ answers `accept="image/*"` with its Photo Picker, which has no camera. Two inputs (one `capture="environment"`), chosen from `PhotoSourceMenu`, whose rows are `<label>`s so the picker opens inside the tap (iOS refuses a file input opened outside the gesture)
- Do not open the flight card's `…` cascade behind a blocking scrim — the page must stay scrollable underneath (a scroll dismisses it) while taps are swallowed at the capture phase so nothing activates. And arm that swallow on a short timer, or the click from the tap that OPENED it closes it on the same gesture
- Do not let the `…` cascade leave `pointerdown`/`touchstart` alone — they must be `stopPropagation`'d in the CAPTURE phase, or a swipe elsewhere still reaches framer-motion and reveals that row's swipe panel with the menu up. And do not add `preventDefault` to them: that is what would kill the compositor's touch scroll, which is the one interaction the menu is supposed to allow (`preventDefault` belongs on `mousedown`, to stop desktop focus, and on the swallowed `click`/`pointerup`)
- Do not put `themeColor` back in the layout's `viewport` export, and do not sync the status bar from an effect keyed on `resolvedTheme` — Next re-renders the static tags on every client navigation (the bar went dark again on the second page), and the effect runs before next-themes sets the class (the bar lagged a launch behind). The boot script owns the tag and follows the class
- Do not let a panel's title scroll away with nothing in its place — a panel with a large title publishes it through `useCollapsingTitle` (`PageContainer` and `DetailFormPanel` already do), and the header carries it. And never place a header title absolutely over the row: it is the middle cell of a `.header-bar-grid`, which gives the buttons their width first, so it can neither cover a button nor be covered by one
- Do not write to ANOTHER record from a form control before Save — the crew card's "This is Me" switch un-flagged the current self card in the database the moment it moved, untouched by Cancel, so a stray flip left the logbook with no self card. The form changes; `handleSave` clears the other flags when it commits
- Do not let a select show blank for a stored value it has no option for — the currency Type row read empty for any company code an import brought in. Offer the record's own value as an option (`typeOptions`); mapping it to "Custom" would rewrite the stored code on the next save
- Do not use a native `<select>` (laid over a row or bare) or a Radix Select for a choice — it is `ChoicePicker`/`OptionMenu`, the app's own menu on the glass face. The platform's control is a different thing on every device and like nothing else in the app. And give the trigger the whole row, never a corner of it
- Do not draw a calendar day as a bare number with a dot, or give a page a calendar of its own — every calendar is `LogbookCalendar`'s bar grid, fed by `useCalendarSpans` and governed by its own Duties switch. Keep a flight without its designator ("248 WMKP", condensed by `text-fit.ts`, never a second typeface), a return pair ONE bar ("248/9 WMKP"), a second line ("248/9" over "WMKP") only where the lane under it is empty, a day's one-line airports kept or dropped together, three lanes a day, every item a tinted bar (bare text ran together) with a flown flight FILLED in the accent (never grey — a day off is grey), a midnight crossover on HALF of each day, a run of all-day duties ONE bar, and SIX rows of one fixed height in every month
- Do not group a run of duty days anywhere but `groupDutyRuns` — the calendar and the list each had their own rule, so a day off with a window was "all day" on its card and a half-day bar on the calendar, and two codes sharing a description were one bar but two cards. And do not let the schedule parser give a day off or leave a window: converted to UTC, a Local Base 00:00–23:59 LOFF moved to the previous day
- Do not split the duties control back into two switches, and do not put a duties button back in the logbook header — it is ONE three-state menu in the calendar's header (`useDutiesView`), default On Calendar
- Do not paint a calendar bar translucent (`bg-x/20`, `opacity`) or fill another month's days solid — what is ON the glass is solid (`color-mix` into `--on-glass`), and another month's days are a translucent shade the glass shows through. And do not inset the grid from the glass: it runs edge to edge and takes the glass's bottom corners
- Do not store a duty period as one record or edit a run day by day — the roster keeps one entry per day (imports, re-import matching, derived ids and para 5 all depend on it), and a run is edited as a PERIOD through `planDutyPeriod`, with its days listed for a one-day change
- Do not bring back a separate roster page or a List | Roster switch — the roster is the logbook list with its Duties on (`buildLogbookRows`, `useListDuties` — the calendar's switch is its own), one + adds either kind, and a stored "roster" tab goes through `normaliseNavTabs`. A duty card must stay the flight card's exact height (`DutyCardBody` mirrors `FlightCardBody`'s fixed line boxes), or the virtualised list starts correcting its scroll
- Do not bring back the month-capsule grid or a year stepper in the calendar's month/year picker — it is two wheels, live, closed by the date selector; and in the dual layout it takes the RIGHT pane with the month being chosen still drawn on the left. Keep `WHEEL_ITEM_PX` small enough that the wheel fits a dual pane's grid, or the panel grows (or clips) when it opens
- Do not cap a date wheel's past at a few years — a pilot back-filling a paper logbook enters flights from decades ago; the default is 70
- Do not make "Add Crew" open the crew picker directly, and do not lay an additional crew member out differently from the PIC/SIC rows — role on the LEFT (the menu), name on the RIGHT (the picker, for THAT row), a swipe to clear. The pick carries the row's role and index (`additionalCrewField`); address rows by index, never by crew-card id
- Do not size the phone's bottom bar to its tabs, or let it run the full width of a tablet — it is `MOBILE_PILL_WIDTH`, the screen less the panel gutter and 12px more each side (the same proportion of every phone), capped at 25rem so an iPad in portrait keeps a bar rather than a slab. The tabs are EQUAL columns (`grid-flow-col`: `minmax(0, 1fr)` in the fixed-width bar, `1fr` — the widest label — in the desktop pill, whose width is its content), so every tab and the highlight that slides between them is one width and the labels are evenly spaced; sized to their labels, "Dashboard" carried a wider highlight than "Crew". A label too long for its column truncates (an iPad Split View window of 320). The bar's HEIGHT is not scaled: an iPad window at "iPhone size" draws CSS px at ~132 px/inch against a phone's ~150–160, so everything there is physically ~20% larger — that is the device, and sizing per platform would break the one-look rule
- Do not put per-row `measureElement` on ANY virtualised list of same-height rows (airports, aircraft, crew, logbook) — calibrate once with `useCalibratedRowHeight`, and keep the card one height by construction (truncate, reserve empty lines). And never pass `useVirtualizer` an inline `getItemKey`: its measurements are memoised on that function's identity, so a new arrow per render rebuilds every row's position on every scroll-driven render (29k rows on the airports list)
- Do not hand-roll a suggestion list under a field — `SuggestionList` (`components/ui/suggestion-list.tsx`) is the one (an inset well, 44px rows, inset dividers), and `AircraftTypeSuggestions` and the add-aircraft / add-airport candidate lists all render through it; the aircraft form, panel and page each carried a bordered `hover:bg-accent` web dropdown
- Do not ask an online lookup per keystroke or by itself on a form — a flight is looked up on the Lookup button (or Enter), a fleet on opening By fleet or on Find. And do not put Gates or Inbound back in the flight form: the form is for logging; they live on the dashboard's duty band and its panel (`useDutyLookups`, one cache). A lookup over an earlier one replaces what the EARLIER LOOKUP wrote (`lookupPatch`'s `previous`), never what the pilot entered — that is "Replace"
- Do not take the first result of an aircraft or airport search as THE answer — a partial registration ("9VB") is a question. Only a candidate marked `exact` fills a form, an import or a submission by itself; anything else is listed for the pilot to choose, or is no match
- Do not hand the year wheel a new options array per render — `yearOptions` keeps the SAME array while the range holds, and the range is anchored on TODAY (widened only when the viewed year falls outside). Anchored on the viewed year, every year spun rebuilt ~75 rows
- Do not put a segmented choice back as a pair of filled rectangles — it is `SegmentedTabs` (the action surface, a sliding indicator, `h-9` segments), as in the import dialogs, the Quick Check and the custom palette's vividness and depth (`components/ui/segmented-tabs.tsx`). And measure its segments from ONE ResizeObserver: reading `offsetLeft` in a ref callback that is rebuilt on every selection forced a layout per tap and attached a new observer to every segment each time, never disconnecting the old ones
- Do not animate a spacer's `height` to push content — it lays out and repaints everything after it every frame. Push with `useFlipPush` (one layout, a compositor transform)
- Do not tell the layers apart with shadows and rims — ground, card and control are generated tones (`--background` / `--card` / `--control`), each a visible step from the one under it; a rim and a shadow belong only to a surface that floats. Do not put `bg-card/70` or a `shadow-sm` on a card
- Do not forbid zoom in the viewport, and do not give a text field less than 16px on a phone (iOS zooms on focus once zoom is allowed). Do not read `--destructive` as text — `text-destructive` is `--destructive-text`. Do not nest a focusable control inside a `role="button"` row; make the row a plain tap target and an inner element the keyboard target
- Do not put an action back on the card surface (`bg-secondary`, `bg-card`, `bg-muted`) or give it a rectangle's corners — a thing you press is a CAPSULE or circle on `.control-surface`, a thing you read is a rounded rectangle. On the card surface the context preview's action row read as more card. And do not use the REAL glass (`GlassContainer`) for an action that sits over a scrim, a row or a panel: the painted surface is the same look with no `backdrop-filter`, and these pop in on exactly the frames a readback would cost most
- Do not group header controls page by page — a header is VIEW (search, calendar, period) → TOOLS (import, Quick Check, alerts, read-from-photo) → CREATE (+, alone and last), one capsule per role, with a page switch first and detail commits (Cancel / Save / Edit, Back) one capsule each (`glass-icon-button.tsx`). And do not add a Refresh button: every list follows every write and every sync, so it re-reads the same rows, and it reads as "sync" — which is the cloud in the nav
- Do not give the context preview's compact body `layout="position"` — it is the one block that exists in BOTH states, so it takes a FULL `layout`. Its height is unchanged either way, which makes its delta scaleX only: the row's content is condensed at the first frame and relaxes out as the card widens. `layout="position"` cancels the horizontal scale too, which lays it out at the RESTING width from frame one and lets the card clip it — on a tablet the arrival time and ICAO are missing until the card widens past them. The detail and the actions DO take `layout="position"`; they exist only while open. And keep the lift a static shadow on its own PROJECTED (`layout`) node faded by opacity, outside the clip: an interpolated `boxShadow` is rebuilt as a string every frame, and `overflow: hidden` on an ancestor eats a shadow entirely
- Do not let the context preview come to rest in the row's own column — it settles CENTRED ON THE VIEWPORT at `MAX_WIDTH`, and only ever GROWS (a row already wider than that keeps its own width rather than shrinking, which would be the same frame-one mismatch in reverse). Keep the detail's own delayed reveal (opacity + y, ~30% of the morph in): the box growing and the content arriving are two things, and running them together reads as a jump. It does NOT animate `blur()` — that is a per-frame filter pass on the busiest frames of the overlay, and the delayed opacity/travel already says "settling into the room"
- Do not give the context preview's backdrop a blur — it is a plain darken (`SCRIM`). Full-viewport `backdrop-filter` layers each sample the one below, so the whole stack recomputes every frame their opacity changes, and that landed on exactly the frames the card is travelling. Giving it its own short clock helped and was not enough; the reference implementation this morph was measured against has no blur either. A DIALOG's backdrop keeps its blur — nothing is animating a card behind it
- Do not unmount the context preview on a timer set to `MORPH_MS` — the collapse only STARTS on the commit after the closing state flips, so that timer is systematically a frame or two early and the overlay disappeared with the card still short of its row, which un-hid underneath and read as a flash on the flight card. The card's own `onLayoutAnimationComplete` is what "closed" means; the timer stays only as a safety net, and longer than the morph (measured: card lands at 459ms, overlay unmounts at 510ms, zero frames with both visible)
- **Blur animation rules, app-wide.** Never ANIMATE `backdrop-filter`, `filter`, `mask-image`, `height` or `top` — they are layout- or paint-bound and re-rasterise every frame. Animate `opacity` and `transform` only. Where a progressive blur has to appear or disappear, fade the layers' OPACITY on a SHORT clock of their own (~160ms) rather than the surrounding motion's, so the blur settles before the thing it sits behind has finished moving and the rest of the animation composites a texture that no longer changes. And keep the stack to THREE layers on a full-viewport effect: each layer samples the output of the one below, so it is a chain rather than a sum, and the fourth link is the one a weak mobile GPU shows. `RadialBlurBackdrop` and `SIDEBAR_BACKDROP_BLUR` both follow this; `ChromeFade` is static and does not animate at all
- Do not fade a `backdrop-filter` layer by fading an ANCESTOR — an element with `opacity` below 1 (or `will-change: opacity`, a mask, or a filter) is a **backdrop root**, so its descendants' `backdrop-filter` can only sample inside it. The context preview's `RadialBlurBackdrop` used to sit inside the scrim that fades: for the whole morph the layers blurred nothing, then the full stack snapped on the instant the scrim hit exactly 1 — a hitch at the end of the animation, and the part of that overlay most likely to be felt on a phone. Fade each LAYER's own opacity instead (an element's own opacity is fine — the root is an ancestor boundary), which is how `SIDEBAR_BACKDROP_BLUR` has always done it. A CSS transition there also needs the layers to MOUNT at 0, or there is no previous value to run from
- Do not put a `layout`/`layoutId` prop on a flight card in the LIST to morph the context preview out of it — the rows are VIRTUALISED, and that hands framer every rendered row to measure on every layout change. The preview is a FLIP, but only the OVERLAY carries the projection: the collapsed box is stated outright from the anchor we already measure when the hold fires, so the list is never involved. Anchor it to the card (`[data-slot="card"]`), not the row wrapper — the wrapper carries the per-row top gap and 4px out is a visible jump on the first frame
- Do not use `transition-all` (or `transition: all`) anywhere — name the properties (`transition-colors`, `transition-[background-color,color,scale]`). It includes `visibility`, which is how the kept-alive stack hides pages, so every element carrying it there started a visibility transition — and was restyled every frame — on each tab switch, and it makes each style change compare every animatable property, Tailwind's ~87 registered custom properties included. Tailwind's plain `transition` does not include `visibility` and is fine
- Do not write a custom property on a CONTAINER per frame or per tap — it inherits, so the write restyles the container's whole subtree. The glass's spotlight properties go on its own empty element (`.GlassSpotlight`, reached from outside with `glassSpotlight(root)`); written on the glass root they restyled the entire nav (~170 elements, 45–60ms at 4×) on every tap and every frame a finger moved over it
- Do not drop `content-visibility: hidden` from a hidden kept-alive page. `visibility` alone is inherited, so the tab switch restyled BOTH pages' whole subtrees (~1,400 elements, 155–171ms at 4×); `content-visibility` skips the hidden one entirely and keeps its scroll offsets. `visibility` stays beside it for an engine without `content-visibility` — the result on screen is the same either way
- Do not arm a `SwipeableCard` row on pointerdown or on an ordinary focus, and do not leave it armed — it arms on a sideways move past `ARM_SLOP` (the move starts the drag), on focus of its keyboard stand-in only, and disarms once it has settled shut. An armed row carries framer's drag feature AND the layout-projection node drag brings; every render of it then reads the document's scroll, a forced layout of the app — ~210ms of the tap that opened a flight, and once per keystroke in a flight-form row that had been tapped
- Do not let a `useVirtualizer` measure its scroller with TanStack's default `observeElementRect` — pass `observeElementRect: observeRectAfterLayout` and `initialRect: viewportRect()` (`lib/utils/virtual-scroll.ts`). The default reads `offsetWidth`/`offsetHeight` in the layout phase of the commit that mounts the list, a forced layout of the arriving page (~240ms of the first Crew visit at 4×). And keep `data-index` on every row even where nothing measures: `scrollToIndexSettled` finds the row by it, and without it the A–Z rail's correction never lands (the row stops under the header)
- Do not refresh a kept-alive page's data synchronously in its `usePageActive` callback — wrap the re-read in `whenIdle`. Every write path already updates the shared cache, so the re-read is a safety net, and inside the callback it ran in the tab switch itself. Detail-panel re-syncs and clock updates (`setNow`) stay immediate; only the data re-read waits
- Do not hide a nav layer (the pill's tab row in sidebar shape, the sidebar list in pill shape) with inline `visibility`/`pointer-events` — both INHERIT, so each flip restyled the layer's whole subtree (~170 elements, 53–93ms at 4× on every sidebar open AND close). It takes `.nav-stowed` (`content-visibility: hidden`, with a `visibility` fallback under `@supports not`), which is skipped: not restyled, painted, hit-tested or focusable. Opening still styles the list it reveals; closing costs nothing
- Do not read `window.innerWidth`/`innerHeight` in a render or a mount effect — it forces a layout of a dirty page. `viewportRect()` is CACHED (refreshed on resize) for that reason: as a `useVirtualizer` argument it was evaluated on every render of every list, 111ms at 4× on the tap that opened FDP. And let TanStack's attach-time `scrollTo(0)` go (`scrollToFn: scrollAfterAttach`) on a list that owns its scroller: a new scroller is already at 0, and the call was a 98ms forced layout on the first Airports visit. Not on the roster agenda — its scroller is the page's and may already be scrolled. Likewise a scroll-margin measurement takes its first reading from its ResizeObserver, never a synchronous call in the mount effect
- Do not let the nav re-render with the shell — `NavPill`, `SidebarNav`, `SidebarNavItem` and `PillBarContent` are `memo`ized, and the props handed to them must stay stable (the mobile morph's open-sidebar callback is a `useCallback`). The shell re-renders on every selection change and the morph on every phase; unmemoised, opening the sidebar re-rendered all eleven sidebar links per phase (measured: 48 fibers for the whole open, from several hundred)
- Do not feed the flight form's auto-save from a debounced copy of the form held in STATE (`useDebounce`) — that state change re-rendered the whole form (~300 fibers) half a second after every open and after every pause in typing, to hand the effect a value its own closure already had. It is a timer in an effect keyed on the form, reset by every change, so the closure is the latest form when it fires. And keep `FlightForm` `memo`ized on `flightId`/`isDesktop`/`editingFlight`: every caller passes inline `onFlightAdded`/`onClose` arrows the form never calls, which re-rendered it twice more on each open
- Do not bind a flight-form text input straight to `updateField` — use `DraftInput` / `RemarksField` (`useDraftText`): the field shows its own draft and commits to the form in a transition, so a key does not wait for ~50 rows to re-render. And do not size a growing textarea by `height = auto; height = scrollHeight` — that is a forced layout per key; `RemarksField` grows by a CSS mirror in the same grid cell
- Do not put `transition-all` on a flight card — its visibility is toggled by the context preview, and `transition-all` animates `visibility`. Measured: hidden→visible still computes `hidden` for the FIRST FRAME, so the overlay unmounts and the row is blank for a frame (the flash on collapse); visible→hidden holds `visible` for the whole 150ms, so the source row shows through the opening morph as a second copy of the same flight. `transition-colors` is what the hover/selected states actually wanted
- Do not let the flight card's press-and-hold fire on a row whose SWIPE PANEL is open — the actions are showing and the card has been pushed aside to reveal them, so a press there is aimed at a button, not at holding the card. `SwipeableCard` publishes `data-swipe-open` for exactly this (unconditional, unlike `data-swipe-active`, which is scoped to `separated` rows because it drives their divider morph)
- Do not tear the context preview down on the dismissing tap — the morph runs BOTH ways, so closing collapses it back onto the row first. And keep the source row `invisible` while it is up, or the copy opening on top of it shows the same flight twice through the scrim
- Do not switch a `motion` component's `style` between two differently-shaped objects — a motion component does NOT clear a style property that merely disappears from the object. Measured on the context preview: the collapsed branch set `position`/`top`/`left`/`height` and the expanded branch omitted them, so they stayed on the element for the whole morph, the card never left the row, and there was no layout change for `layout` to animate. Supply every key in BOTH states
- Do not release a `useBackDismiss` marker synchronously in the effect cleanup — `history.back()` lands in a later task, so a teardown immediately followed by a re-run (React StrictMode double-invokes every effect in development, and any fast `active` toggle does the same) issued the `back()` after the new effect had already pushed a fresh marker and attached its listener, and the overlay dismissed ITSELF a few hundred ms after opening. The release is deferred by a task and cancelled if the effect comes straight back, which also stops the stack growing an entry per remount
- Do not let the flight card's hold arm from a press on the row's own CONTROLS — the pointer hooks sit on `SwipeableCard`'s outer container, so the swipe buttons are inside them, and a thumb tap on `…` outlasts `HOLD_MS` on a phone. That opened the context preview instead of the cascade. Bail when the press starts on a `button`/`a`/`input`/`textarea` or inside `[data-swipe-actions]`
- Do not put the flight card's ACTIONS back behind a press-and-hold — they live in the swipe panel behind `…`. A hold is an invisible gesture that nothing advertises, and as the actions menu it competed with the swipe and the scroll for the same pointer. The hold now drives the CONTEXT PREVIEW instead, which is a different job (a look, not a menu) and the one thing a hold has always meant; it still needs the movement cancel and the synthetic `pointercancel`
- Do not let a dismissing tap on the `…` reopen the cascade — the swallow closes it on `pointerup` and the follow-up `click` then arrives with the listeners already gone. Keep `CASCADE_REOPEN_GUARD_MS`: an open request within 350ms of a close is the same tap, whichever order an engine delivers it in
- Do not scroll a row to `--chrome-top` — the quick-scroll rail parks it at `--chrome-clear`, where a list's first card sits, not against the bar's edge
- Do not let the bottom nav hide on scroll — it is the app's primary navigation on a phone, and it disappeared exactly when a long read made you want it, with a scroll UP as the only way back. The machinery for it is GONE, not merely switched off, and that is the point: `ScrollNavbarProvider` sat at the very top of the app tree and flipped a `hideNavbar` state on every scroll direction change past a 10px threshold, so a single flick re-rendered the whole tree — six mounted keep-alive pages, the shell, the virtualised logbook — to compute a value the nav had already stopped reading. Do not reintroduce a scroll handler that writes state anywhere above a page
- Do not revalidate the whole flight list after the flight form saves ONE flight — auto-save runs every half-second of typing, and `mutate(CACHE_KEYS.flights)` read every flight back out of IndexedDB, re-sorted them and had SWR deep-compare the result for each save (~150ms at 4× on 1,200 flights, while typing). `refreshSavedFlight` writes the stored row into the cache with `insertFlightSorted` (`revalidate: false`), which keeps every other row's reference — so SWR's compare short-circuits on them — and still moves a flight whose date or time changed. It falls back to a full revalidation only when it has no stored row to hand
- Do not `refresh` a data hook with `mutate(undefined, { revalidate: true })` — clearing the cache first flips `isLoading` true and flashes the list's skeleton on every background refresh, and it hands out a NEW array even when nothing changed, which defeats SWR's default deep `compare` (`dequal`) and makes every downstream memo recompute (the FDP pipeline, the dashboard aggregates, the calendar's flight-date map). Bare `mutate()` revalidates in place. For the same reason `isLoading` must NOT be `isLoading || isValidating`: SWR's `isLoading` already means "no data yet", and folding in `isValidating` turns every revalidation into a skeleton
- Do not construct an `Intl.DateTimeFormat` per call — go through `lib/utils/tz-format.ts` (`tzFormatter` / `tzOffsetName`). — resolving locale and timezone data is by far the most expensive part of formatting, and `getAirportTimeInfo` built TWO per call while the logbook parser and the roster executor each resolve a departure and an arrival offset PER SECTOR, and the schedule parser's `normalizeTimeToUTC` resolves one per TIME TOKEN (~six a row). Cache the FORMATTER (stateless, and every caller still hands it the current instant), never the resolved offset — a cached offset pins whatever DST was in force the first time that airport was seen. Measured on 800 lookups across 8 zones: 143ms → 8ms
- Do not look a reference record up with `array.find(a => a.code.toUpperCase() === …)` — the airport table is ~10k rows and that allocates an uppercased string for every one of them, per lookup. `getAirportByICAO`/`getAirportByIATA` are backed by a `WeakMap` index keyed on the array itself (no invalidation to get wrong: a new array is a new key), and they must keep `find`'s FIRST-match rule, which `airport-code-index.test.ts` pins. The same shape appears wherever recents are resolved — build the Map once, then look up
- Do not seed a reference table in ONE transaction — Chromium serves every IndexedDB database on an origin from one backing store, so writing the ~29k bundled airports in a single transaction held every request on the origin (the user DB and the sync engine included) for ~26 seconds on a fresh profile. `seedAirportsTable` writes in chunks with a gap between, overwrites in place (no empty-table window), and stamps the version LAST — and do not pace the chunks with a bare `setTimeout(0)` either. Nothing in the app is ONE transaction: adding a flight is a chain of about eight, each started when the last finishes, and with no real gap the next chunk was always queued first, so the chain waited a whole chunk at EVERY step. At 1000-row chunks that made adding a flight take 2–6s for the ~15s after the first flight form opened on a new install (measured; it had been misread as "slow while sync is failing", because offline the seed's fetch fails and it never runs). `SEED_CHUNK` 250 with a `SEED_GAP_MS` 48 gap: adds 0.3–0.7s during the seed, and the seed itself finishes sooner
- Do not seed a `useState` from `syncService.getStatus()` (or any browser-only value) in a server-rendered component — the server renders "offline", the browser knows it is online, and the first render disagrees with the HTML. Read it with `useSyncExternalStore` and an "offline" server snapshot
- Do not push a whole record for an edit — `updateEntity` sends `changedFields` + `baseSeq`, and the server applies only those fields. A whole-record push from a device that hadn't caught up is what reverted other devices' edits
- Do not save an edit form's whole copy of a record — diff it against the form's BASELINE (`formPatch`) and follow the live row with `rebaseForm`. A form open across a pull otherwise sends the stale copy back as an edit and reverts the other device's work with nobody touching the form
- Do not clear a fetch timeout before the body is read — a stalled body wedged the sync lock forever. Read inside the timeout (`fetchWithTimeout(input, init, read)`, `authFetch`)
- Do not dead-letter a batch for a request-level 4xx, and do not wipe unsynced rows in a full resync
- Do not exclude `.pnpm/**/*@gutenye*` (or any pattern that catches `@gutenye/ocr-models`, `onnxruntime-node` or `sharp`) from file tracing — that is what made the deployed `/api/ocr` fail with "Cannot find package '@gutenye/ocr-node'" for months, so every photo paid an upload and a refusal before being read slowly in the browser. Trim onnxruntime-node's OTHER platforms' binaries instead (`next.config.mjs`), and check `GET /api/ocr` reports `available: true` after a deploy
- Do not hand the OCR engine an image larger than `OCR_MAX_SIDE` — detection runs at whatever size it gets, and a 12MP photo took 19s where 1024px took 1s with identical results. Cap it on the client AND in the route, and decide on pixels, never file size
- Do not let the browser OCR engine load its runtime from webpack's hashed URL, or import bare `onnxruntime-web` without the WASM-only alias — the hashed copy cannot be precached (the first offline OCR failed) and the default entry is 24MB of WebGPU build the engine never uses. And keep the alias on the NON-bundled `ort.wasm.min.mjs`: the bundle starts its threads from its own hashed URL, so a threaded engine could not start offline; the plain build takes the glue (and the thread script) from `wasmPaths.mjs` at `/models/`
- Do not send a photo to the server first when the device can read it — the server path (re-encode, upload, a function in `iad1` that may be cold, a session lookup) was ~10s on a phone in Singapore, where the device engine reads it in ~1.5–3.5s. The device goes first, the server is the backstop (`HEDGE_MS`, or a device failure); `ocr-routing.test.ts` pins it
- Do not run the device OCR engine on the page's main thread — it runs in `engine/ocr.worker.ts`, so the UI is not one of its compute threads; and do not give it every core (`ocrThreadCount` leaves one for the UI)
- Do not animate a CSS custom property on a container — not a registered `@property`, not a keyframed `--var`. An inherited custom property changing every frame restyles the container's WHOLE subtree every frame: the glass's specular drift did that on every glass surface, which in the nav and the header is most of the app — ~1.8s of every 2s idle at a 4× CPU throttle, 29 frames in 3s on an idle logbook. And it did not even move the glint: `--glass-rim` is declared on `:root`, where its `var()` resolves, so the animated value never reached the paint. If something must move, animate a transform or opacity on the element that draws it. A spinner left running behind the OCR processing dialog is the same mistake in miniature
- Do not compute something per DAY by filtering every duty period — `generateTimelineData` called `calculateRollingStats` three times per day over all duties (O(days × duties), ~40s at a 4× throttle on a long logbook, in the dashboard's first render, during which the page did not paint). The windows are read off a sorted index now and `timeline-data.test.ts` pins them to the original definition. The same goes for `deriveDutyStatus` (`indexWindows`) and `applyAcclimatisation` (`acclimatisedOffsetsAtEachDuty`): a whole-timeline pass must be one pass, and each keeps the per-item definition as its test oracle
- Do not compute the FDP timeline's rolling line per DAY, or for the whole career — `rollingSeries` evaluates `rollingAt` only at the breakpoints inside what is drawn (a view either side of the screen), off a prefix-summed index (`createRollingIndex`). And do not split it into a second chart with its own zoom again: the owner asked for the limits and the duties in sync, and one scroller is what guarantees it
- Do not leave an unarmed `SwipeableCard` row without its keyboard stand-in. The action panel only mounts once the row is armed, and most rows' content is not focusable, so without the `sr-only` "Show actions" button Tab could never reach Delete or `…`. Focusing it arms the row and hands focus to the first real button a TASK later — the arming render commits inside Tab's own focus change, so a synchronous `focus()` there is overridden and focus lands on `<body>`. The flag is set in the ROOT's `onFocusCapture`, because the stand-in is removed before its own `onFocus` can run
- Do not pass `dragControls` (or `drag`) to an unarmed `SwipeableCard` row — framer mounts its whole drag feature for EITHER prop, and fifty rows of it plus their action panels was ~800ms of the tap that opens a flight. The row arms on first pointerdown/focus and hands that pointerdown to the drag controls, so the first swipe still swipes
- Do not write `?selected=` to history INSIDE the tap — Next applies the write as a router transition, but one made inside a click renders synchronously, in the click, and takes the selection's own transition with it (the whole flight form rendered before the tap could paint: INP 656ms at 4×, 96ms deferred). `writeUrlAfterTap` defers it one task, `pendingUrlWriteRef` covers the gap, and the selection itself commits as a transition. Keep `pushedBaseRef` in the "is it already open" test, or a second tap inside that task pushes a second entry The deferred write is ONE at a time (a second inside the task supersedes the first but keeps its push), is dropped if the pathname changed before it fires (it would put the old page's URL on top of the new route), and a close inside that task cancels the pending push instead of calling `router.back()` — there is no entry to go back over yet, and the back would pop the page before it
- Do not let a navigation link scroll — every nav navigation passes `scroll: false`. Next's scroll-into-view after a route change is a forced layout of all six kept-alive pages to scroll a document that cannot scroll
- Do not read layout (`getBoundingClientRect`, `scrollHeight`, `offsetHeight`) in a ref callback, a layout effect or a mount effect — that is the middle of React's commit, so it forces a synchronous layout of the whole app which the rest of the commit then dirties again. Take the first measurement from a ResizeObserver callback (it fires after the browser's own layout, before paint): the keep-alive stack, the scroll indicator and the remarks textarea all did this, at 90–290ms each per open at a 4× throttle, and the logbook list's one-shot row calibration did it on every cold start (~230ms at 4×, the biggest native cost before the first card painted). During a gesture, reuse the rect the last frame already read (`GlassContainer`'s release ripple)
- Do not let a `<Link>` that only becomes visible during an animation prefetch on visibility — Next's viewport prefetch downloads AND evaluates the route's chunks, and the sidebar's links all came into view on the morph's first frame (~40 requests, ~650ms of long tasks at 4×, on the first open of every session). Sidebar links pass `prefetch={false}` and `prefetchNavRoutesWhenIdle` warms the same routes when nothing is moving. A new nav item goes in `nav-sections.tsx` and is warmed with the rest
- Do not load the whole airport table to find one or two airports — `useAirportByIcao` is a primary-key `get` (answered from the in-memory list when something already loaded it at the current revision). `useAirportDatabase` is for screens that LIST or SEARCH airports; the flight form read all ~29k rows on its first open of every cold start to answer two lookups
- Do not let `useAirportByIcao` report a gap as "no airport". Three rules keep it honest, and the flight form depends on all of them because it computes night time and day/night takeoffs and landings from the two airports and SAVES the result: the effect is keyed on the airports REVISION as well as the code (keyed on the code alone, any write — a custom airport, a favourite, a seed — emptied the peek and nothing ever looked again, so an open form saved zeros); between a write and the re-read it answers with the LAST KNOWN airport, not `undefined`; and a miss before the seed has finished (`isAirportTableSeeded`) is `undefined`, not `null` — a new install writes ~29k rows over ~15s, and a flight opened in that window found VHHH "missing" and saved its landings as 0. The form in turn treats `undefined` as PENDING (`airportsPending`) and holds the stored night and takeoff/landing figures until both airports are known
- Do not parse or write the airport dataset on the main thread when a worker can — `seedFromSource` runs `airport-seed.worker.ts` (the 5.7MB `response.json()` alone was a ~500ms task on a new install's first flight open) and falls back to the page only when no worker starts. Keep `writeAirportRows` the ONE implementation both call, keep its chunking and its version-stamped-LAST rule, and keep the revision bump on the PAGE side when the worker reports done — the worker's module copy of the counter is not the one anything reads
- Do not mount a Radix Accordion/Collapsible OPEN in a screen that opens on a tap — its content measures itself with `getBoundingClientRect` in a layout effect, which is a forced layout of the whole app in the middle of that commit (~100ms at 4× on every signed flight). A disclosure that opens with a `grid-template-rows` 0fr→1fr transition needs no measurement
- Do not slow down `hhmmToMinutes` — it is called inside every flight sort comparator and every duty-period loop. The `H:MM`/`HH:MM` fast path reads character codes; anything else falls through to the general parse, and `hhmm-to-minutes.test.ts` pins the two to each other
- Do not call `toLocaleDateString`/`toLocaleTimeString` per cell or per row — each call builds a new `Intl.DateTimeFormat`. Hoist a formatter to module scope (`CELL_DATE` in the roster month, `DAY_HEADING` in the agenda) or go through `tz-format.ts`. And for the device's own zone or UTC, `Date`'s getters ARE the answer — `dayKeyAt` only reaches for a formatter for a NAMED zone
- Do not let a digit read from a blank (`----`) slot reach the extractors — `dropDashReads` drops a digit-bearing read below 0.75 confidence or 0.55 of the median line height. On the device engine photo 3's empty IN read as "1000"; the `device` fixtures pin it
- Do not swap the OCR models for dynamically quantized int8 ones — measured in onnxruntime-web, recognition got slower and read none of the seven photos correctly
- Do not recognise every detected box — the OCR pipeline reads top to bottom and STOPS at the MCDU screen's last line (`MCDU_STOP`), so the keypad (half the boxes) never reaches the recognition model. A change that sorts, filters or batches the boxes must keep that order and the drop of anything read past the stop
- Do not go back to `@gutenye/ocr-node` / `ocr-browser` — their plumbing recognised the keypad, pulled in 10MB of opencv.js for the browser, and had no way to stop early. The models are the same; `lib/ocr/engine/core.ts` is the plumbing, once for both runtimes
- Do not load a cross-origin resource without CORS (`crossOrigin="anonymous"`, or a CORP header from its server) — every response carries `Cross-Origin-Embedder-Policy: require-corp` so the OCR engine can run multi-threaded, and a no-cors cross-origin image, script or iframe is now BLOCKED, not merely opaque. Do not drop the COOP/COEP headers to get one working, and do not switch to `credentialless` (Safari lacks it, so the platforms would diverge)
- Do not call `skipWaiting()` on install or reload on every `controllerchange` — a new worker waits for the user's "Update"; and do not put `/_next/static` back in the trimmed dynamic cache
- Do not read "today" in a memo keyed only on data — a dashboard left open overnight froze its recency and its period. Depend on `useDayKey()`
- Do not let recency read as met on or after its lapse date, whatever the counts say, and do not count a flight exactly 90 days back — `lapseIso` is the first day NOT current
- Do not parse a date-only string with `new Date("YYYY-MM-DD")` for a LOCAL comparison — it is UTC midnight, the previous day west of UTC. Build it from its parts
- Do not compute night time against an airport without `hasCoordinates` — a blank custom airport is 0°N 0°E — and do not write 00:00 over a stored night when the position is missing
- Do not write a setting's DEFAULT into the synced `settings` record, and do not write a group as one field — a device states only what the user changed (`settingsPatch`), one field per preference, or a new device's untouched defaults overwrite the account and two devices' changes to one group revert each other. Theme, palette and custom palette are the only device settings; everything else goes through `saveUserPreferences`
- Do not hardcode PICUS for a first officer's flown leg — it is the pilot's own setting (Settings › Logging), dated by the check-out, with SIC when unset. Read the role convention through `getLoggingProfile()` / `withLoggingPreferences`, never the bare crew card
- Do not leave a flight with no OFF/ON at a flight time of 00:00 or without takeoffs and landings — `airborneTimes` falls back to OUT/IN for both (the owner's rule: OUT/IN are the next best evidence of when it flew), in `recalculateFlightFields` and the form alike
- Do not recompute any role time once one of the five (PIC, SIC, PICUS, Dual, Instructor) is pinned
- Do not treat an hour category set with USE as a pin — an override whose figure equals the block FOLLOWS the block (`categoryState` "block"); only a different figure is the pilot's. And do not write a new block time except through `updateFlight`, or the categories following it are left behind and read as pins
- Do not mark a session expired on a 401 alone, and do not start a passkey ceremony from a background trigger — probe first, and require user activation
- Do not let a sign-in as a different account inherit this device's data — `dataOwner` decides, and the switch clears it
- Do not compare a pulled record against the local one by clock — rebase it (`planLocalApply`): the server's copy plus whatever this device has pending. Only a pending create or a dead-lettered row falls back to last-write-wins
- Do not revoke a session before pushing — every sign-out path runs `confirmUnsyncedLoss` FIRST, while the session still works
- Do not reload a whole reference table on mount to notice a write — `useAirportDatabase` re-read all ~10k airports from IndexedDB every time it mounted, and the flight form mounts on every flight tap. Writers bump `getAirportsRevision()` and the hook reloads only on a mismatch. Every write to `referenceDb.airports` starts in `airports.store.ts` (the seed — which may run in `airport-seed.worker.ts` and bumps the revision when it reports done — addCustom and toggleFavorite) — a NEW writer must bump it too, or a cached copy goes stale. Capture the revision BEFORE the read, so a write landing mid-load leaves the cache looking stale rather than falsely current
- Do not compute a list twice in JSX — `xs.some(p)` for the section guard and `xs.filter(p)` for the rows is two full passes per render, and on the airports page that was two scans of the whole reference table for a handful of pinned entries. Derive it once in a `useMemo` and test `.length`
- Do not pass a memoized list card an INLINE arrow (`onDelete={() => performDelete(item)}`) — it hands every row new props on each render of the page and defeats the `memo` outright, which is the whole reason the card is memoized. The card takes its own item back (`onDelete: (item) => void`) and the page passes ONE `useCallback`'d handler; a plain function declared in the page body is just as bad as the arrow, so the handler itself has to be stable. This bit the logbook, crew and aircraft lists independently
- Do not put a `backdrop-filter` (`backdrop-blur-*`) on a surface whose backdrop is a FLAT colour — blurring a uniform field returns that same field, so it is pixel-identical to no filter while still forcing a backdrop root, a readback and a blur pass every frame the layer is painted. The dashboard's widget cards each carried `backdrop-blur-sm` over `bg-background`, which has no gradient and nothing behind it (the blocks are stacked in one column, so they never overlap). Glass surfaces, the chrome fade and the modal backdrops keep theirs — those sit over real, moving content, which is the case the filter exists for
- Do not hold gesture bookkeeping in React STATE when nothing renders it. The calendar kept `swipeStartY` / `isSwiping` / `hasTriggeredSwipeStart` as state and read them only inside its touch handlers, so putting a finger on it re-rendered the whole grid — 42 day cells, or 84 in dual mode — up to three times before anything visible happened. Refs, and the same for any drag box that can't move mid-gesture (`fast-scroll` caches the rail's rect for the drag's duration rather than reading it per `touchmove`, while that same drag is driving `scrollToIndex` on a virtualised list)
- Do not do a gesture's work per POINTER EVENT — pointer events fire faster than frames (120Hz+, and coalesced besides) and nothing can show more than one position per frame. `GlassContainer`'s press-follow, the nav drag lens and the signature canvas each accumulate the latest point in a ref and apply it in ONE rAF pass. Within that pass, every layout READ comes before any WRITE: the drag lens used to write nine `left`/`top`/`width`/`height` values and then read a rect for the spotlight, which forces a synchronous layout flush on every event of the one gesture that has to feel stuck to the finger
- Do not accumulate a signature stroke in React state — `signature-canvas.tsx` keeps the in-progress stroke in a REF and repaints once per frame, handing React ONE update when the stroke ends. As state, every point copied the whole array, re-rendered, took a `getBoundingClientRect`, forced a style flush via `getComputedStyle`, and redrew every stroke — so the cost per point grew with the stroke and the line visibly trailed the finger. The box and the resolved colour are cached for the stroke's duration; neither can change while a finger is down
- Do not leave a `setState` in a rAF loop unguarded when the value it writes changes slower than the frame rate. `useCountdownConfirm` ticks at 60fps to drive a MotionValue (free) but `remaining` is whole SECONDS, so it compares before dispatching — ~60 scheduler entries a second for 59 non-changes, for the whole 10s a delete is armed, which is exactly when the user is scrolling the list it was armed from
- Do not run a clock, poll or subscription that a keep-alive page owns without gating it on that page being the ACTIVE route. The dashboard's legality panel ticks at 1Hz to drive one countdown; the dashboard is mounted forever after its first visit, so ungated it re-rendered the whole requirement grid every second for the rest of the session while the user was somewhere else entirely. Gate on `usePageActive` AND on there being something to tick for — the countdown only exists while rest is outstanding, which is most of the time not at all
- Do not answer "is anything queued?" by reading a table — the sync trigger manager polls that every 10 seconds for the whole session, and `getSyncQueue().length` deserialised every pending row to compare a number against zero. Use `getSyncQueueCount()`, which counts off the index
- Do not decide a `useBackDismiss` release is safe at the moment it is SCHEDULED — check at the moment it FIRES, against the shared marker stack (`lib/utils/history-markers.ts`). The release is deferred by a task precisely so other things can happen in between, and one of them is another overlay pushing its own marker: `history.back()` takes whatever is on TOP, so the outgoing dialog popped the incoming one's entry and the incoming one dismissed itself. That is what made a LogTen import report itself cancelled a moment after its review dialog opened. Two dialogs handing off in one commit is the ordinary case, not an exotic one — the import status dialog does it to every review modal it opens
- Do not release a `useBackDismiss` marker without checking the URL is still the one it was pushed at. `history.back()` only takes the marker back while the marker is the TOP of the stack; if something navigated in the meantime — the sidebar's close-on-`pathname` effect is exactly that shape, a route change tears the overlay down — the marker is buried one entry below the new page and the `back()` undoes the navigation. A buried marker is left alone: it is a duplicate entry for a page the user was already on, which is invisible, where undoing a navigation is not
- Do not let an overlay rely on Escape alone — on Android the back gesture is the other half of the same intent, and without `useBackDismiss` the router navigates and the overlay (portalled to `document.body`) is left over whatever page arrives. Every dismissal must go through the hook's `dismiss()`, and an action that navigates has to run as its FOLLOW-UP: closing first and popping the marker entry on the way out issues the `router.push` while our own `back()` is still queued, and the back then undoes it
- Do not give a scroll handler ANY work that isn't per-frame cheap, and never let one write React state above the component that needs it. The logbook's list runs one rAF-throttled listener whose only job is the calendar sync; `topFlightDate` is pushed into state only while the calendar is actually OPEN, because the calendar is collapsed to `height: 0` rather than unmounted and updating it while stowed re-rendered a whole month grid per card scrolled past, for something nobody can see
- Do not let a full-width page (`useMainPanelFullWidth`) take the sidebar toggle's main-width lock — it has no main width to hold, and the inline `max-width` capped the FDP chart at the split's main width for the length of the push
- Do not leave a control above an overlay's backdrop taking taps while the overlay is up — the shell's header sits above the phone sidebar's backdrop and is `inert` while the sidebar is open (`useIsOverlaySidebarOpen`). And do not hide the calendar's date selector when the month/year picker opens: the picker REPLACES the grid in the same box, under the same selector, so the panel's height does not move
- Do not leave a sign-out (or any action that awaits a network round trip before its first visible change) silent until the round trip returns — change its label on the TAP, and bound the wait (`flushBeforeSignOut(maxWaitMs)`)
- Do not hand-roll a spinner — waiting is one thing and should look like one thing. `PageLoading` is the route-level state (every `loading.tsx`, the keep-alive Suspense fallback) and `PanelLoading` is the detail-panel one, both in `components/ui/page-loading.tsx`. The aircraft, airports and crew pages each carried an identical copy of a `border-2 border-primary border-t-transparent` ring, so waiting for a pane looked like a different kind of waiting depending on which tab you were on
- Do not size the mobile bottom pill from `PILL_HEIGHT` — it is `MOBILE_PILL_HEIGHT` (60 against the desktop 44; `--chrome-bottom` clears it with 20px to spare). They are not the same control: one is a row of text tabs in a dense header, the other is the phone's only navigation, aimed at with a thumb
- Do not give the bottom bar a squarer corner than a stadium — `MOBILE_PILL_RADIUS` is half its own height, the same rule the 44px controls follow; it is a separate constant only because the bar is a different height. A third-of-the-height radius was tried (the proportion the reference tab bars use) and rejected on the look: what reads as a squircle there is CONTINUOUS CURVATURE, not a smaller radius, and a circular arc at that radius is just a rounded rectangle. Drawing the real thing needs `corner-shape`, and a corner shape one engine falls back from would leave iOS and Android with different bars
- Do not give the gravity blob a colour of its own — it is `--on-glass-active`, THE selected-thing fill, shared with an action button's active state so the nav and the header say "this is the one you are on" the same way. It must stay a mix of two OPAQUE colours: any translucency shows up as the blob letting the page through, which is the one thing it must not do
- Do not put `--primary` on `--on-glass-active` — a 32% tint of a colour is the same hue at a similar lightness, which is exactly why the active action button read as barely selected. The label is `--on-glass-active-fg`, the primary pushed AWAY from the fill (lighter on dark, darker on light) so it still reads as the accent
- Do not close the flight card's `…` cascade on POINTERDOWN — the overlay unmounts mid-gesture and the click that follows lands on the card underneath, so dismissing it also opened the flight. Close on the lift and swallow the synthesised click at the capture phase
- Do not float a calendar panel over content that is not scrolling under it on purpose — the page reserves its height (`onNaturalHeight` → a spacer on `PANEL_MOTION`, with `overflow-anchor: none` on the scroller), or what sits beneath reads through the glass between the day numbers
- Do not give a page its own copy of the calendar's wrapper — `CalendarPanel` is the one presentation, and the logbook and the dashboard both render it. They drifted into looking like two different calendars once already (radius, width, glass, dual month, and a duplicate month label in the dashboard's action bar)
- Do not derive the calendar's dual/single mode from a ResizeObserver on the page — read `usePanelDualMonth()`. A measurement lands a frame behind the resize, and in that frame the calendar renders the outgoing mode at the incoming width (the "flash" on the collapse)
- Do not scroll a dynamically-measured virtual list by asking the virtualizer where a row is — every offset it can give you is built from `estimateSize` for the rows it has never measured, so `scrollToIndex`/`getOffsetForIndex` are wrong by however far the estimate is off. `scrollToIndexSettled` scrolls roughly, then MEASURES the row in the DOM and corrects by the difference, which is exact
- Do not let the `…` cascade change the flight card's size, and do not drop `keepOpen` from the `…` action — the run is a PORTALLED overlay anchored to the `…` button's own box, and the swipe panel has to stay open beneath it or the buttons appear to come from nothing. A menu that grew the row would move every row below it
- Do not animate the gravity blob in the SIDEBAR — it is placed instantly there. The list's metrics re-measure as a route settles and as the panel morphs, and each re-measure was a chance for the spring to re-fire (the "flashes twice" report)
- Do not carry a flight's OOOI times, takeoffs/landings, signature, lock or import/sync stamps into a derived flight (`deriveFlight`) — those are the record of a specific flight having happened, and copying them forward fabricates a logbook entry
- Do not judge a virtual list's scroll convergence by `virtualizer.scrollOffset` — it is written by the scroll listener, so reading it in the same tick as `scrollToIndex` always says "unchanged" and the retry loop gives up after one pass
- Do not put a control taller than `h-10` inside a `GlassButtonGroup`, or give a highlight more than 2px of capsule round it — the group is `h-11` with `px-0.5`, and what goes in it is `GROUP_ITEM` (`h-10`), so its highlight fills the capsule but for a hairline (the owner's ask, Nov 2026: at 4px in the groups and 6px in the nav a highlight read as a smaller thing floating inside its control). The nav bars (a 56px tab in the 60px bar, 40px in the 44px pill) and `SegmentedTabs` (`p-0.5`, `h-10` segments) keep the same 2px. The glass CLIPS, so a taller child had its icon cut off top and bottom (the dashboard's period filter) and made the group wider than it was tall (the alerts bell). The dashboard's period pills are group items too — `h-10`, the selected-thing fill, not 24px solid accent pills
- Do not size the floating controls or the desktop nav pill independently — they are one 44px family (`CONTROL_RADIUS` 22 = half the height, so a pill stays a stadium — the bottom bar follows the same rule at its own height, see `MOBILE_PILL_RADIUS`), the header row is `h-13` to match, and `--chrome-top` is derived from them. They were 56px, which read as oversized next to the platform's own chrome on the same iPad
- Do not print a four-digit year in the logbook's month label — in dual mode ("Jul – Aug 2026") the left action group grew far enough to reach the centred nav pill
- Do not bring back the three-panel month carousel. It measured its container height from a ref taken "at rest" that had never been taken on the first entry into dual mode, so the calendar collapsed to 8px, and its end-of-animation handler tested `dataset.animAnchor` against `data-anim-anchor=""` — the empty string, which is falsy — so it never recovered. A dual step moves the pair by TWO months, so there is nothing sliding across to animate
- Do not compensate the list's scroll when a floating panel OPENS or CLOSES — that push is the whole point of `overflow-anchor: none`. `absorbSpacerDelta` is only for the calendar changing SHAPE while already open, and that commit must also drop the spacer's transition, or an eased spacer drifts against the one-shot correction
- Do not inset `.GlassBlur` from the face or feather it outward — the fill must be even corner to corner, and `--glass-press` must stay imperative so a scroll's `pointercancel` doesn't kill the spotlight
