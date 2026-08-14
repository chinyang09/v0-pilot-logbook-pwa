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
| Forms | Custom hooks (`useFormSubmit`, `useCrewForm`) — no form library |
| OCR | @gutenye/ocr-browser with ONNX Runtime |
| Charts | Recharts |
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
| `lib/utils/roster/__tests__/` | reconciler classification, repeated-route matching, the spilled-duty match window, import decisions + retention, report tracking, pilot-role rules, sim dedup, tracked fields, the accepted-comparison stamp |
| `lib/utils/parsers/__tests__/` | PDF row merge, crew-column wrapping, Flt-time/PIC bleed, logbook→sector mapping, aircraft type map, time-reference normalisation |
| `lib/utils/parsers/shared/__tests__/pooled-map.test.ts` | the bounded fan-out both enrichment chains end in |
| `lib/utils/__tests__/history-markers.test.ts` | overlay marker ordering — which dialog `history.back()` would actually take |
| `lib/utils/parsers/logten/__tests__/` | the LogTen Pro migration, run against REAL exports in `fixtures/` — value coercion, the three parsers, UTC-vs-local detection + conversion, duplicate detection, and the cross-file pass |
| `lib/ocr/__tests__/` | both OCR screenshot layouts, from synthetic bounding boxes |
| `lib/utils/__tests__/`, `lib/sync/__tests__/`, `lib/db/.../__tests__/` | pending actions, the 90-day window, the recycle bin, sync compaction, conflict resolution |

Tests that touch a parser must mock `@/lib/db` and
`lib/utils/parsers/shared/airport-enricher` — both reach for IndexedDB at
module scope. See `pdf-schedule-merge.test.ts` for the established stub set.

Note the OCR tests build synthetic OCR boxes, so they catch a **geometry** or
mapping regression but NOT a recognition regression. Changing OCR engine needs
real screenshots as fixtures first.

## Project Structure

```
app/                              # Next.js App Router
├── layout.tsx                    # Root layout (PWA setup, providers)
├── globals.css                   # Tailwind global styles
├── api/                          # API routes
│   ├── auth/                     #   Registration, login, passkey, session
│   ├── sync/                     #   Bulk sync, per-collection sync, TTL setup
│   ├── ocr/                      #   Image OCR processing
│   ├── search/                   #   FR24 proxy routes
│   │   ├── aircraft/             #     Aircraft search + batch lookup
│   │   └── airport/              #     Airport search
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
│   ├── sync-service.ts           #   Main sync orchestration
│   └── sync-trigger-manager.ts   #   Intelligent sync scheduling
├── auth/                         # Authentication
│   ├── server/                   #   Server-only (session, webauthn, totp)
│   └── shared/                   #   Shared utilities (cuid)
├── mongodb/                      # MongoDB client (connection pooling)
├── ocr/                          # OCR service & flight data extraction
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
- The sync engine batches and pushes changes to MongoDB
- Last-write-wins conflict resolution. The delta-pull watermark is **server-authored**:
  `/api/sync/[collection]` filters on the server-assigned `syncedAt` and returns
  the server clock as the new `since`, so device clock skew can't drop updates.
  The client only advances `lastSyncTime` when every collection pulled cleanly.
- Tombstone records track deletions to prevent re-syncing. On the server, the
  tombstone is written **before** the record is deleted (in `/api/sync/bulk`) —
  if the tombstone write fails the delete is skipped and the client retries, so
  a deletion can never be applied without a tombstone (which would resurrect the
  record on other devices).
- Failed push items are retried each cycle and **dead-lettered** after
  `MAX_SYNC_RETRIES` (5) so a poison item can't loop forever; transient
  network/offline failures are not counted toward the cap.

### Sync Triggers

Sync runs automatically on: app focus, network online, debounced data changes (2-5s), manual trigger, and pre-logout.

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

**Per-collection dispatch** (delete/upsert from the server) goes through the
single `COLLECTION_HANDLERS` registry in `sync-service.ts`, keyed by the closed
`SyncCollection` union — add a collection in one compile-checked place, not in
parallel switch/if-else chains.

**`SyncProvider` is the ONE `onDataChanged` → `refreshAllData` subscriber.**
The dashboard and the logbook each had their own as well, and both of those
pages are keep-alive — permanently mounted once visited — so a single sync
cycle ran the entire cache refresh three times over, which is three full reads
of every table plus the re-renders each one triggers. A page that needs its own
data back after a background pull gets it from the shared refresh; a page that
needs it on RE-ACTIVATION uses `usePageActive`'s callback, which is a different
trigger.

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

Sessions are stored in MongoDB (with TTL) and mirrored to IndexedDB. Cookies are HttpOnly + Secure + SameSite=Lax. Each session row also stores the request **`userAgent`** (set in `issueSession`) so the account page can label active sessions by device.

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
- **FR24 APIs** (live): Aircraft search via `/v1/search/web/find`, airport lookup via `/airports/traffic-stats/`
- **Server Enrichment DB** (MongoDB): User-submitted aircraft/airports enriched and shared across users

**Lookup Chain (aircraft):**
1. Local IndexedDB (`referenceDb.aircraftDatabase`) — FR24 + custom + MongoDB-synced records in one unified table
2. Server batch lookup (`/api/search/aircraft/batch`) — checks enriched submissions from other users
3. FR24 live search (`/api/search/aircraft`) — server-side proxy to bypass CORS
4. Manual entry (user types registration + type code)

**Lookup Chain (airport):**
1. Local IndexedDB (`referenceDb.airports`) — includes static + custom airports
2. FR24 live search (`/api/search/airport`) — server-side proxy for airport details
3. Manual entry (user types ICAO + details)

**Enrichment Pipeline:**
- Custom aircraft/airports are submitted fire-and-forget to `/api/submissions/aircraft` or `/api/submissions/airport`
- Server attempts real-time enrichment (FR24 for aircraft, geo-tz for airports)
- Failed enrichments are retried by `/api/enrichment/batch` (cron, max 3 retries)
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

**A soft-deleted reference aircraft must not answer a lookup.** Neither the
single nor the batch lookup filtered `deletedAt`, so a deleted aircraft read as
a live local hit: it stayed invisible in the list AND the enrichment chain
never asked the network for it again, which made it impossible to re-import.

LogTen's per-airframe detail (serial number, operator, owner, year, notes) has
nowhere to go in the app's `Aircraft`, so the type carries five OPTIONAL,
non-indexed fields for it — no Dexie migration, and nothing is populated unless
a source supplies it. `normalizeAircraftFromServer` had to stop being an
explicit allowlist for them to survive a round trip (the same trap
`normalizeFlightFromServer` was rebuilt to avoid).

### Entry Type (flight vs simulator)

`FlightLog.entryType: "flight" | "simulator"` — a union rather than another
boolean so ground duties (standby, leave) can follow. Rows written before it
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

Five bands, in the order a pilot asks:

```
AUG 14 · 12:24 GMT+8              WSSS-VTBS/VTBS-WSSS   ← date, live clock, route
⚠ CAUTION                                               ← master annunciator
  Takeoff within 8d                                     ← what to DO
  Tightest: T/O 90d 8d left                             ← the governing constraint
DUTY  [Table A] [3 sectors]
  5:42                              7:18                ← elapsed / FDP left
  ELAPSED             FDP LEFT · MAX 13:00
  ▬▬▬▬▬▬▬▬░░░░░░░░
  FT 2:11  ⚠ Duty 14d 74/90h  Duty 28d 121/180h  …      ← rolling statutory caps
CURRENCY & LIMITS                                       ← every requirement, urgent first
  ⚠ T/O 90d  8d left    ⚠ Ldg 90d  8d left
  ✓ Since duty Rested   ✓ Duty 28d 121/180h   …
RECENT ›
  Aug 14  SIN → BKK  2.2h
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

#### TWO clocks: FDP and the crew duty period

A pilot can be limited by either and they are different windows — FDP runs
report → last on-blocks, duty runs report → debrief — so the band prints both
and the gauge carries whichever BINDS (the smaller remaining). Showing only one
is how a panel tells a pilot they have three hours left when they have one.

| | Limit | Source |
|---|---|---|
| FDP | `DutyPeriod.maxFdpMinutes` | CAAS Reg 14, per duty, via `calculateMaxFDP` |
| Duty (CDP) | `FTLLimits.maxSingleDutyHours` | the account's FTL preset, the same figure `isDutyExceedingLimits` uses |

Neither is hardcoded, and a missing one reads as a dash rather than a default.

While on duty with nothing flagged, the annunciator headline is the SECTOR
POSITION ("Sector 2 of 2"). "Nothing required" is true and useless at the gate
between sectors.

#### Annunciator, governing constraint, next action

`pilot-status.ts` joins the standing requirements with the duty phase. Three
states on the ECAM vocabulary the reader already has — `CURRENT` / `CAUTION` /
`ACTION REQUIRED`, each with its own icon, never colour alone. An `unknown`
requirement is a caution, not a fourth colour. **An exceeded FDP outranks every
standing requirement** — it is the only thing on the page happening right now
rather than being true today. Outstanding REST also raises an otherwise-clear
pilot to CAUTION: rest lives in the duty state, so it is not one of the
requirements the verdict is drawn from and the annunciator has to fold it in.

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
- **The next action states the REMEDY, not the reading** — "2 landings
  required", not "landings 1 / 3". Phrased in `legality.ts` where the shortfall
  is actually in hand (`Requirement.action`). Triage order: something wrong with
  the duty in progress → rest → the binding requirement → the next report →
  nothing required.

#### Nothing on this page navigates by default

A cell EXPANDS in place and a second tap closes it. The reader came to check a
status; a route change loses the screen they came for and costs a
back-navigation to recover it. The deep link lives INSIDE the expansion, where
it is a deliberate second step rather than the accidental result of a tap.

#### CURRENCY and LIMITS are separate bands

They are two different kinds of thing and sorting them into one urgency-ordered
grid is what made the first version unreadable:

| Band | Question | Unit | Behaviour |
|---|---|---|---|
| Currency | am I qualified and recent | DAYS | expires |
| Limits | how much have I used | HOURS | refills |

- **Recency is ONE requirement, not two.** Takeoffs and landings are two halves
  of one question, and as separate urgency-sorted cells they did not even end up
  beside each other. The cell answers with the binding half; expanding shows
  both counts and the lapse date.
- **Limits are PAIRED by what they limit** — Duty over its 14d and 28d windows,
  then Flight over 28d and 1y. That is how the regulation is written and how a
  pilot holds it; four independent rows sorted by urgency scattered the pairs.
- **Rest is NOT a currency.** It is a property of the duty just flown, so it
  lives in the duty band (`DutyStatus.rest`). Among a column of expiry dates a
  live countdown read as a different kind of thing — because it is one.

#### The duty band and the sector chain

The band shows the FDP gauge, the figures, and the duty's LEGS as a chain of
stops (`deriveSectorLegs`) — filled dot on blocks, ringed dot for the leg being
flown, hollow still to come, with the airport codes beneath. A duty is up to
four sectors across several airports, and "where am I in the pattern" is what a
generic recent-flights list could never answer: it showed history, not this
duty. That list is gone.

**The gauge's tone is STATED, never derived from how full the arc is.** A nearly
full FDP ring is a warning; a nearly full REST ring is good news. Deriving the
colour from the fraction painted a fully-rested pilot amber.

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
What a wider screen buys is DENSITY INSIDE each block — a flight's detail goes
4 → 8 fields per row, the breakdown stacked → side by side.

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
| Rest until legal | a pill in the limits stack **and** the bell | the duty band's rest gauge + the annunciator countdown |
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

#### The flight list opens IN PLACE

A row unfolds under itself rather than navigating. The list exists because the
pilot is reading the period as a whole; a full flight page loses that period and
costs a back-navigation to get it back. `PeriodFlight` carries the detail
(OOOI, air, night, T/O–LDG, reg, type, role, PF/PM) — the aggregator already has
all of it in hand, so it costs field copies rather than a per-row read when a row
opens. The row still offers the full page for anything beyond that.

`periodFlights` is ordered by **`sortFlights`**, the one comparator — sorting on
the date alone left same-day sectors in table order, so they could read in a
different order here than in the logbook. `SortableFlight`'s `scheduledOut` is
optional so a projection of a flown flight can use it.

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
logbook's list spacer reserves. The **absorb** logic stays in the logbook
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
- **`PANEL_MOTION` — one clock.** The calendar's collapse and the list
  spacer use the same `height 300ms MORPH_EASE` string. They used to be a
  framer spring and a CSS transition of a different duration, which read as
  two stages: the panel opening, then the list catching up. The calendar is
  therefore always MOUNTED and collapsed to `height: 0` (rather than
  conditionally rendered), so its natural height is always measurable and the
  collapse is a plain px transition the spacer can match exactly.

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

**A month is ALWAYS ONE PANE WIDE in the split layout** — `MONTH_PANE_PX`, 284,
which is the dual panel minus the page's calendar gutter, halved, minus the
pane's own padding. Day cells are square, so a month's width IS its height: a
single month wider than a dual pane made the calendar taller with one month
than with two, and the width toggle then resized the panel under the flight
list every time. Capped, both modes measure **272px** and the list does not
move at all (measured: `scrollTop` 900 before, during and after a round trip).
The single month is therefore centred in its 360px panel rather than filling it.

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

**The header names BOTH months in dual mode** — `Jul – Aug 26`, and both years
when the pair straddles a new year (`Dec 26 – Jan 27`), since "Dec – Jan 27"
would put December in the wrong year. The year is two digits because at four
the dual form pushed the left action group into the centred nav pill. The month/year picker
marks both too. Naming only the anchor left the right-hand pane unaccounted for
in a view that is plainly showing two months.

Going **dual → single** keeps whichever pane the top flight is actually in — if
that is the right-hand month, the LEFT one stows. Going single → dual snaps the
anchor to its pair boundary.

**Single ↔ dual is a horizontal slide, and the pair is treated as two months
stacked on top of each other.** The one that belongs on the right slides out
from under the other; closing, it slides back under. Which pane travels never
changes — it is always the right-hand month — what changes is which one you were
already looking at, and that one holds full opacity while the other arrives:

| Looking at | Opening to dual |
|---|---|
| Jul (the left month) | Jul stays put, Aug emerges from under it and moves right |
| Aug (the right month) | Aug moves right, revealing Jul underneath on the left |

Both directions are the same pair of keyframes (`cal-pane-settle` /
`cal-pane-leave`) parameterised by `--cal-pane-x` and `--cal-pane-o`. The month
you were looking at CANNOT be read off `selectedMonth` when the slide starts —
the page re-anchors the selection to the pair's first month in the same commit
that flips `dualMonth` — hence `lastSingleMonthRef`.

The three-panel month **carousel is gone**, and it was broken as well as being
the wrong motion. It rendered the stepped-to month as an extra absolutely
positioned panel inside a container whose height came from a ref measured "at
rest"; on the FIRST entry into dual mode that measurement had never happened, so
the container fell to `height: undefined` over absolutely positioned children
and the whole calendar collapsed to its padding (**measured: 8px, where two
months are 280**). It never recovered either — the handler that ended the
animation tested `dataset.animAnchor`, and `data-anim-anchor=""` reads back as
the empty string, which is falsy, so it returned on every event. A dual step
moves the pair by TWO months, so there was never a single month sliding across
another to animate in the first place.

What replaced it is simpler and covers **both** modes: stepping slides the whole
view VERTICALLY, because the gesture that steps it is a vertical swipe (and a
wheel) — the months should travel the way the finger does. The single ↔ dual
width slide stays horizontal; that one is the pair opening sideways. The arriving month(s) come in from the side you are heading
toward (`cal-step-in`) while a copy of the outgoing one leaves the other way
(`cal-step-out`). The arriving content is in FLOW and only the outgoing copy is
absolute, so the container keeps its height for the whole slide — which is
exactly what the carousel got wrong. Measured on a single-month step: the
arriving grid starts at `translateX(344px)`, one grid width, and eases to 0.
The width slide sets `suppressStepRef` for its duration, because widening the
panel also re-anchors `selectedMonth` and that would otherwise fire a step slide
on top of the width slide.

**A resize is not a push** (`FlightListRef.absorbSpacerDelta`). The list has
`overflow-anchor: none` because growing the spacer is how the panels push it —
but the spacer also changes when the calendar switches between one month and
two while already open, and with anchoring off that slid the whole logbook under
the reader's eye. So the push stays uncompensated and the RESIZE is absorbed by
a single `scrollTop` write, with the spacer's transition dropped to `none` for
that one commit (an eased spacer would drift against a one-shot correction for
300ms). Measured: toggling the width with the list at scrollTop 900 now lands at
867, exactly the calendar's 313→280 height change, and returns to 900 on the way
back.

### The Flight Card (`components/flight-card-body.tsx`)

One visual definition of "a flight card", shared by the logbook list, the
import review and the discrepancies page. Layout:

```
28   02:30 ──────── 4:00 hrs ──────── 06:30
JUL  WSSS                             WICA        ← "SIMULATOR" for a sim
26   ⧉ 9V-NCE, A21N                  TR318        ← icon only on sims
     Lim Chin Yang                    ☀ 1D ✎
```

- An optional `diffs` map turns any covered slot into `old struck through in
  grey` + `new in the accent colour` — that is how the import review renders.
- Clock times honour `displayPrefs.clockSeparator`; the duration always keeps
  its colon.
- The out—block—in connector is `bg-current` (the same colour as the times it
  joins) and is **hidden entirely** when there are no times — two bare rules
  across a just-created row read as damage.
- `showLandingChips` / `showStatusIcons` / `showPilotRole` let a consumer drop
  parts; the signed (✎) and locked (🔒) icons are how the card says "this entry
  is yours" — do not reintroduce a separate "replaces yours" banner.

### Discrepancies as the Comparison Record

`app/(app)/discrepancies/page.tsx` leads with **Comparisons**: one
`FlightMismatchCard` per flight showing each tracked field with your value and
the company's side by side (`OptionPair`), the held side lit. Tapping the other
side writes it to the flight and updates the row, so this — not the review
modal — is the single home for undoing an import decision, reachable whether
the change was accepted or rejected at import time. One-off notes (duplicates,
stale reports, missing sectors) sit in a second tab.

**Three tabs, not four.** The page holds two kinds of thing, each with an open
and a settled state, so the settled state is never its own tab:

| | Open | Settled |
|---|---|---|
| tracked field difference | **Comparisons** | **Accepted** |
| one-off import note | **Notes** | "Handled", below the open notes in the same tab |

A fourth "Resolved" tab put two synonyms side by side in the tab bar and made
the split look arbitrary — it was only ever the notes' settled half. Both note
lists are scoped to non-mismatch types so a comparison can never fall through
and render as a prose `DiscrepancyCard`, which is the presentation the
comparison cards exist to replace.

`Discrepancy.holding: "logbook" | "schedule"` records which side the flight
currently holds, independently of `resolved`. The comparison tabs split on it:

| Tab | Rows | Retained |
|---|---|---|
| **Comparisons** | `holding: "logbook"` — a standing difference | forever; it IS the licence record |
| **Accepted** | `holding: "schedule"` — the pilot conceded | 90 days, then purged |

Taking the company's value stamps `acceptedAt` and starts the undo window;
taking your own back clears it. Accepting at IMPORT time stamps it too — same
act, same clock — and a re-import keeps the original stamp rather than
restarting it. The card shows the days left, because when
`purgeExpiredAcceptedDiscrepancies()` takes the row the pilot's original value
goes with it. `tracked-mismatch.test.ts` pins the stamp both ways round: on the
wrong row, the sweep eventually deletes a difference the pilot never conceded.

### The Undo Windows (`lib/utils/retention.ts`)

Two clocks, both defined here, and the helpers take the window as an argument
so a caller states which one it is on:

| | Window | What |
|---|---|---|
| `RETENTION_MS` | **90 days** | import decisions, accepted comparisons — roughly three company report cycles, so a quarterly review can still put one back |
| `DELETED_RETENTION_MS` | **30 days** | anything the user DELETED, held in Recently Deleted |

They were one number. A deletion is an ACT, not a difference between two
records: you know within days whether you meant it, and holding every deleted
flight, aircraft and crew member for a quarter turns a safety net into an
archive.

**Clearing a retention stamp writes `null`, never `undefined`.**
`/api/sync/bulk` applies an update as a `$set` of the payload's keys and
`JSON.stringify` drops undefined ones, so `undefined` leaves the server's stamp
in place and the next pull undoes the undo — a restored flight drops straight
back in the bin. `isWithinRetention` and `isLiveFlight` therefore test `== null`.

### Recently Deleted (everything you delete)

**Every delete in the app is a SOFT delete**, not just flights. `deleteEntity`
in `crud-helpers.ts` sets `deletedAt` and pushes an **update** — that is what
makes Recently Deleted work across devices, since binning and restoring both
ride the ordinary sync path. Only `purgeEntity` (and the 30-day sweep) writes a
tombstone.

There is no confirmation on the way out. Deleting is one tap, and the holding
area is the undo — see "Destructive Actions" below for why the countdown went.

| Kind | Store | Synced? |
|---|---|---|
| flights | `flights.store` | yes |
| crew | `crew.store` | yes |
| currencies | `currencies.store` | yes |
| aircraft | **`reference/aircraft.store`** — the aircraft PAGE lists the reference database, not `userDb.aircraft` | no (referenceDb has no sync queue, which is what deleting a custom aircraft has always meant) |

**Discrepancies and schedule entries stay HARD deletes.** They are import
bookkeeping rather than records the pilot authored: a comparison is regenerated
from the next report, and schedule rows are replaced wholesale by the next
import. Putting them in Recently Deleted would fill it with rows nobody thinks
of as things they deleted.

`app/(app)/recently-deleted/page.tsx` sweeps every kind on load, then lists
what's left GROUPED BY KIND with the days remaining. The per-kind
restore/destroy/sweep triple lives in one `OPS` lookup, not a switch at each of
the three call sites.

The cost is that `userDb.flights` now holds rows nothing should show. Read lists
through `getAllFlights()`, or filter with **`isLiveFlight`** when reading the
table directly — the totals (`stats.store`), both reconciliations, the schedule
parser and the import button all do. A binned flight reaching an import match
would silently update, and so resurrect, a flight the user deleted.

`normalizeFlightFromServer` **spreads the server record first** and applies
defaults over it. Building it from an explicit field list quietly dropped every
field added since it was written (`entryType`/`isSimulator` — a simulator came
back from a second device as an ordinary flight — the import decisions, the
report watermarks). Do not go back to an allowlist.

### Chrome Overlays (`components/ui/chrome-overlays.tsx`)

- **`ChromeFade`** — THE floating-header treatment, rendered directly by the
  main shell header and the mobile detail overlay header in
  `desktop-layout.tsx` (no more inline copies): a native-style bar of
  progressive **blur + darken**. Three masked backdrop-blur layers (smallest
  radius first, widest coverage, so the stack only ever adds blur toward the
  edge) under a background gradient. It extends `FADE_TAIL` (**41px**) BEYOND
  the bar it sits on, because native bars start softening well before their own
  edge — confined to the bar's height, a card sitting just under the action
  buttons still looked sharp and tappable, which is a lie about what you can
  reach. 41 puts the band's bottom **45px** below the buttons. Apple publishes
  no figure for the scroll-edge effect's falloff, so that is the owner's read
  on device, not a spec number.

  **`--chrome-tap` is a THIRD number**: how far below the action buttons a tap
  still counts as "the header" and scrolls that panel to the top. The header
  row ends level with the buttons, which put the fast-scroll target's lower
  edge exactly where the darkening begins — aim a little low and you hit a
  flight card and open it. 1.5rem claims the strip under the buttons, the same
  idea as iOS's status-bar tap: genuine chrome that the list does not own. It
  is a REAL element, so a drag STARTING in it does not scroll — which is why it
  stays thin rather than covering the whole fade tail.

  **`--chrome-clear` is a DIFFERENT number again and is deliberately larger** (3.5rem
  → 60px below the buttons, ~15px of air under the band). It is where the
  quick-scroll rail parks a row, and a row landing exactly on the band's lower
  edge is sitting against it — the whole point of the target is that the row
  reads as clear of the chrome. Holding the two equal was tried in both
  directions and is wrong both ways: tying the band to the target pushed the
  darkening far down the screen, and tying the target to the band puts the
  scrolled-to row back inside the treatment. The gradient is anchored to a fixed 64px ramp so taller chrome
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

  **That box is re-read per update AND followed per frame while the thumb is
  up.** A cached copy plus a ResizeObserver looks sufficient and is not:
  opening the sidebar SLIDES the main panel across without changing its width
  (measured: `0..360` → `199..559`), so nothing resizes and no observer fires.
  The thumb stayed at the closed layout's right edge — 199px inside the list,
  drawing a grey rule down the middle of the flight cards, and still tracking
  the scroll, which is what made it read as a stray line rather than a
  misplaced scrollbar.

  Re-reading on scroll frames alone still leaves a visible flash, because the
  morph takes ~300ms during which there is no scroll at all — so `follow()` is
  a rAF that tracks the box while the thumb is visible and stops the moment it
  hides (~800ms after the last scroll). It writes nothing unless the box
  actually moved. Measured across the whole morph, sampled every 40ms: the
  thumb is at the scroller's right edge in every frame.
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

**The one exception is "Log out of all devices"** (`app/(app)/account/page.tsx`),
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
| Airbus MCDU AOC VOYAGE RPT | label row above value row, two columns | `extractFromLayout` |
| EFB flight-record **Time Summary** | one labelled row per event, PLANNED and ACTUAL columns | `extractFromTimeSummary` |

Time Summary maps Off Block / Takeoff / Landing / On Block → OUT / OFF / ON /
IN from the ACTUAL column, plus the planned times and the `3h50m` durations.
Two traps it handles explicitly: the yellow **delta** (`+00:05`) sits right
next to each value and parses as a perfectly good time (tokens starting `+`/`-`
are excluded), and the actual cell carries a **date** (`27 Jul 01:25`) that may
arrive as one OCR box or three.

The flight number is deliberately NOT read from the Time Summary header — it is
the ICAO callsign (`TGW216`) where the logbook uses IATA (`TR216`).

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

- **Gesture:** `drag="x"` with `dragDirectionLock` + `touchAction: "pan-y"` — a
  vertical gesture scrolls the list natively and never fights the horizontal
  swipe. Release settles to open/closed with a spring (`SPRING`); a fast flick
  opens via velocity.
- **Actions** (`SwipeAction[]`): `onClick` receives the BUTTON's own box, so an
  action that opens something can anchor it to itself (the flight card's `…`),
  and `keepOpen` leaves the panel up afterwards — for an action that reveals
  more actions, the row they belong to has to stay put beneath them. Rendered
  as **separate, rounded buttons** that
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
  page's "Log out of all devices". Built on `hooks/use-countdown-confirm.ts` (a
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
- **Gravity nav indicator** (`GravityIndicator` in `components/nav-pill.tsx`) —
  the active-tab/​item highlight blob (pill bar + bottom nav + sidebar). Its
  motion is **two damped harmonic oscillators** (`springTrack()`), solved
  analytically per move and sampled into WAAPI `transform` keyframes:
  - **Travel** is the unit STEP response, damped hard (ζ 0.78 → ~2% overshoot,
    one crossing, monotonic rise). A bouncy position curve reads as the blob
    hunting for its seat — that was the owner's verdict on an earlier version.
  - **Shape** is the IMPULSE response of a SECOND, looser oscillator (ζ 0.32),
    which is the part the travel spring cannot express: a soft body's shape has
    its own stiffness and damping, faster and looser than its centre of mass,
    which is why jelly still wobbles after it has stopped. It stretches ALONG
    the direction of travel, crosses neutral, compresses on landing (~31% of
    the stretch — the ratio e^(−ζπ/√(1−ζ²)) between consecutive extremes) and
    rings down. Measured on a real move: 1.20/0.83 at the stretch, 0.94/1.05
    on the landing squash, then neutral.

  In the SIDEBAR the blob is placed **instantly** — no spring at all. The list
  is a scroller whose metrics re-measure as a route settles and as the panel
  finishes morphing, and every re-measure was another chance for the spring to
  re-fire and read as a double flash; a vertical list also gives the travel
  nothing to say. The pill keeps the physics. (The drag-lens handoff used to
  play the SHAPE oscillator in place as well; that is gone — the lens now
  dissolves onto the blob rather than being swapped for it, so there is no cut
  to cover and a wobble afterwards read as a second arrival.)

  The effect **re-fires only for a new destination** (`animatedToRef`) and, if
  it interrupts a move in flight, resumes from the blob's CURRENT transform
  rather than the last move's origin. `rects` is re-measured by a
  ResizeObserver as a route settles, so without the first guard a second
  spring to the same place started mid-flight — the "blob flashes twice while
  moving" report — and without the second, a tap during a move snapped it back
  to the previous tab before setting off again.

  Driving the squash from the travel spring's own **velocity** is what the
  physics literally gives you, and it was tried first — but at ζ 0.78 the
  velocity barely reverses (−0.02 against a +1.0 peak), so the blob stretched
  out and then just stopped, with no landing squash. Loosening the travel
  damping to grow that lobe brings the hunting back. Two oscillators is both
  the better-looking answer and the more honest model. Both tracks are
  normalised to their own peak, so a one-tab hop deforms as much as a five-tab
  sweep (proportional deformation makes a short move look limp).

  The shape animation lives on a **child** of the positioned element, because
  the parent's `transform` carries the position and one element cannot run two.
  (The standalone `scale` property would have kept it on one element, but Blink
  does not animate `scale` from WAAPI — measured, the animation simply never
  starts. `transform` on a child does, and both layers composite.) Both are
  fired imperatively because they have to RE-FIRE on every move, and a CSS
  animation only restarts if you tear it off and back on. `transform` is
  deliberately absent from the box's CSS `transition` list — the spring owns
  it, and the inline style is already the target, so the animation falls back
  onto it cleanly when it finishes (measured: lands exactly, no drift).
  `instant` places it with NO animation, for the frames where animating is
  wrong rather than pretty: while the sidebar is still morphing (its metrics
  re-measure as the panel grows, so a spring started mid-morph only gets going
  as the panel lands and the blob visibly arrived a beat late), and under the
  drag lens — where the blob also tracks the tab UNDER THE LENS rather than the
  route's, so that when the lens fades it is already exactly where the lens
  landed instead of springing across the whole bar once the route catches up.
  The springs are **solved once and handed to the compositor**, never ticked in
  JS — a Framer/JS spring ticks on the main thread and **hitches** when a heavy
  page (dashboard/FDP) mounts. Only the box's `width`/`height` still ease on a
  CSS transition, a touch quicker than the spring so a widening tab has settled
  before the blob stops moving. Tab metrics are measured with a ResizeObserver
  in **content coordinates** (so it's correct inside the scrollable sidebar).
  Do **not** revert this to a Framer `animate()`/motion-value spring.
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

  **The pill's width is MEASURED (`usePillWidth`), never `auto`.** `width` rides
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

### KeepAlive Navigation

Four heavy pages are kept mounted across navigations for instant tab-switching and scroll preservation:

**Persistent pages** (`components/keep-alive-pages.tsx`):
- `/` (dashboard), `/logbook`, `/aircraft`, `/airports`, `/crew`, `/roster` — the primary tabs, lazy-imported via `React.lazy()`, mounted on first visit, never unmounted. The one list lives in `components/keep-alive-routes.ts`; `PERSISTENT_PAGES` is typed against it
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

**Detail panel integration** (`hooks/use-detail-panel.tsx`):
- The keep-alive route set lives in ONE registry — `components/keep-alive-routes.ts`
  (`KEEPALIVE_ROUTES`, with a `hasDetailPanel` flag per route). `keep-alive-pages.tsx`
  types its `PERSISTENT_PAGES` map against it (compile-checked) and
  `use-detail-panel.tsx` derives `KEEPALIVE_DETAIL_ROUTES` from it — do not
  reintroduce parallel hand-maintained route lists (they drifted once already)
- `DetailPanelProvider` does NOT clear `detailContent` when navigating between two
  keep-alive routes that own detail content; routes without a detail panel
  (dashboard, roster) always clear it
- Each persistent page re-syncs its detail panel via its `usePageActive` callback (`syncDetailPanel`)
- Selections stored in `sessionStorage` for restoration across full page reloads
- `setSelectedId(id, { explicit: false })` is for **programmatic** selections
  (e.g. settings auto-selecting a section to fill the desktop panel): it skips
  the `?selected=` URL write and the explicit-selection flag, both of which
  would auto-open the full-screen mobile overlay when the viewport crosses
  below 720px (iPad Split View / resize). Only real user taps use the default
  explicit path
- **System back undoes the last move.** OPENING a detail — meaning `?selected=`
  is not already in the URL — `router.push`es it; the param going away again is
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
    ├── /, /logbook, /aircraft, /airports, /crew, /roster (lazy, persistent)
    └── children (other routes, normal unmount)
```

**Every provider above `KeepAlivePages` must give a MEMOIZED value**, because
its subtree is all six keep-alive pages at once — a fresh `{...}` per render
re-renders every one of them. `PageActionsProvider` goes further and is **two**
contexts: the registered action nodes (which change on every tab switch, and
are read only by the shell's header) and the SETTERS (which never change, and
are all the register hooks need). Held together, one page registering its
buttons re-rendered the other five.

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

Forms use lightweight custom hooks (`hooks/use-form-submit.ts`, `hooks/use-crew-form.tsx`) for submission/loading/error state rather than a form library. Validation is hand-rolled where needed. There is no React Hook Form or Zod dependency.

### API Routes

Server-side routes in `app/api/` follow Next.js App Router conventions with `route.ts` files exporting HTTP method handlers (`GET`, `POST`, `DELETE`).

Notable route groups:

| Route | Method | Auth | Purpose |
|---|---|---|---|
| `/api/search/aircraft?q=` | GET | No | FR24 aircraft search proxy |
| `/api/search/aircraft/batch` | POST | No | Batch lookup from enriched MongoDB |
| `/api/search/airport?q=` | GET | No | FR24 airport lookup proxy |
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
  class. The only deliberate non-Inter text is the FDP "next reporting time"
  (`font-serif italic`).

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

- **A local night is any 8 contiguous hours inside a TEN-hour window.** Rest
  running 00:30 → 08:30 is a full local night and used to read as none, taking
  the requirement from 10 hours to 12. In the other direction, ANY overlap used
  to count, so rest that merely clipped 22:00 claimed 3(1)(a)'s 10 hours when
  3(1)(b)'s 12 applied. And it is measured **where the crew member actually
  is** (`DutyPeriod.arrivalTimezoneOffset`), not at home base — a Singapore
  night was being tested against a rest period spent in London.
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

#### Paragraph 4 — duties around the window of circadian low

Three First Schedule terms, all defined in **acclimated time**:

| | Definition |
|---|---|
| early start | a scheduled DEPARTURE commencing 0500–0659 |
| late finish | a scheduled ARRIVAL ending 0100–0159 |
| window of circadian low | a TAKE-OFF or LANDING in 0200–0459 |

The last one is defined *in relation to a take-off or landing* — not to a duty
period and not to the cruise. A sector airborne at 2310 and landing at 0650 is
over the window for its whole middle and touches neither end of it.

A duty encompassing any of the three is **disruptive**, and para 4 then asks for
a rest period of **24 hours inclusive of a local night**: 4(1)(a) before the
FIRST of a series, and 4(2) again once two consecutive ones are complete.
Between them, 4(1)(b) hands it back to paragraph 3.

- **The classification happens in `applyAcclimatisation`, not at construction.**
  The duty period producers store the raw instants (`departureMs`, `arrivalMs`,
  `takeoffLandingMs`); only the whole timeline knows what clock to read them in.
- **The run of consecutive disruptive duties is tracked across the timeline**
  (`calculateAllRestPeriods`), because neither duty in a pair can see it — 4(2)
  reacts to the two duties BEFORE the one whose rest is being measured. The
  count is "since the last 24-hour circadian rest": once para 4 has required its
  24 hours, the duty that follows opens a fresh series. An ordinary duty clears
  it outright.
- **Gate times stand in for wheels times when a flight records none.** Every
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
- **`calculateRestUntilLegal` still had the if/else chain** the same pass fixed
  in `calculateRestPeriod` — so the countdown a pilot actually reads off the
  dashboard under-stated an 11-hour duty's rest by an hour, and measured the
  local night at home base rather than where the crew member was. It now builds
  the same candidate set, and folds in para 4 when the NEXT duty is known.

#### Known gaps — these need the OWNER's input, not a guess

- **Standby is not counted as duty at all.** `getDutyPeriodsFromSchedule`
  filters to `dutyType === "flight"`, so standby, training and ground duties
  contribute nothing to the 90h/180h cumulative limits, which para 12 counts as
  duty hours. Para 6(7) says only **20%** of standby at home or in local
  accommodation counts, and para 6(3) says AIRPORT standby is part of the rest
  period with adequate facilities or part of the FDP without. Implementing this
  needs a mapping from the company's own standby codes (BKUP, SBYG, …) to
  home / airport, which only the owner has. Until then the app UNDER-counts
  duty hours.
- **Para 6(2)(a): standby must not exceed 18 hours for flight crew.** Not
  checked, same reason.
- **Para 5: days off.** Not more than 7 consecutive days between days off; at
  least 2 days off every 2 weeks; 8 every 4 weeks (6 permissible with
  make-good); 82 hours at base after 7+ days away. None of this is computed.
  It needs COMPLETE roster coverage to tell a day off from a day with no data,
  and a false "you have worked 8 days straight" is worse than silence.
- **Para 8: positioning is not an operating sector.** A positioning leg
  imported as an ordinary flight row inflates the sector count. `ScheduleEntry`
  has `dutyType: "positioning"` but `FlightLog` carries no equivalent flag.
- **Para 9: simulator then flying in the same duty.** Sim time counts in full
  toward the subsequent FDP but is not a sector. The dashboard's
  `buildPlannedDuties` skips simulators entirely.
- **Para 10: delayed reporting.** A delay under 4h keeps the maximum based on
  the ORIGINAL report time; 4h or more re-bases it on the actual. Not modelled.
- **Para 13 / 3(2): commander's discretion.** +3h FDP and −2h rest are not
  representable, so a duty legitimately extended reads as an exceedance.
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

#### Still deferred — rolling-window date handling

`calculateRollingStats` parses duty dates with `new Date(dp.date + "T00:00:00")`
(runtime-local), while callers build the as-of date in UTC
(`generateTimelineData`, `simulateScenario`, `simulateHypotheticalDuty`) or in
local (`forecastExceedances`). For a non-UTC user a duty on the window boundary
can be silently included or excluded. Settle on one date convention end to end.

### OCR engine (owner is weighing a change)

The offline engine is `@gutenye/ocr-browser` + ONNX (~16MB of models). The
owner has asked about **PaddleOCR JS**, server-when-online / local-when-offline.
Assessment on record:

- The speed gap in the PaddleOCR web demo is mostly **server hardware**, not the
  engine. Locally the cost is dominated by **model load**, and Paddle's JS
  models are comparable in size — swapping engines does not fix that by itself.
- Highest-value first step is **server-first routing**, which is largely already
  built: `/api/ocr` exists and `checkServerOCRAvailability()` is wired. Route
  online requests there, keep the local model as the offline fallback.
- The extractors take `{text, box, confidence}` so they are engine-shaped, but
  the digit repair (`O`→`0`, `I`→`1`) and row-grouping tolerances are tuned to
  gutenye's output. An engine swap needs **real screenshots as fixtures** first
  — the current OCR tests use synthetic boxes and would not catch a recognition
  regression.

### Deferred design work (owner-approved to-do)

- **Populate the split-view detail panel on non-detail routes** (layout audit
  L·8): dashboard, roster, FDP, currencies, discrepancies, and account leave
  the ≥720px right panel on a permanent "Select an item to view details"
  placeholder. Highest-value first step: roster's selected-day view should
  render into the detail panel (today it replaces the main list). To be
  designed together with the owner in a future session — do not implement
  piecemeal.

### Performance work surveyed but NOT actioned (audit trail)

Each of these was measured or read closely during a performance pass and left
alone on purpose. The reason is recorded so the next pass doesn't re-derive it
— and so that anyone who *does* action one knows what they are trading.

- **`.GlassContainer`'s 60s specular drift is the largest continuous cost in
  the app.** `--glass-specular-angle` is a registered `@property` feeding a
  conic gradient, so it REPAINTS every frame rather than compositing, on every
  glass surface, forever — to move 36° over a minute, i.e. ~0.01° per frame.
  Every way to make it cheaper changes the material: stepping it introduces
  visible micro-jumps in a specular highlight, and hoisting it to `:root` so
  all surfaces share one animation puts them in phase (they currently drift
  independently, which is the look). Only touch this with the owner.
- **The glass rim adds three more `backdrop-filter`s per surface** on top of
  `.GlassBlur`'s one (`.GlassEdgeReflection`, `.GlassEmbossReflection`,
  `.GlassRefraction`). They are masked to a ~2px band but the filter still
  processes the whole element box. Same rule as above — this IS the material.
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
- **`SwipeableCard` renders its action buttons for every row**, at `opacity: 0`
  when closed — in the logbook that is ~48 hidden buttons carrying ~144 framer
  motion values, torn down and rebuilt as the virtualiser recycles rows.
  Deferring them to the first drag would cut that, but moves the cost into the
  start of every swipe, which is an experience trade rather than a free win.
- **The OCR preloader fires on a fixed 3s timer** (`ocr-models-preloader.tsx`),
  which lands while the user is making their first interactions. The ~16MB
  fetch itself is done by the service worker, so it is off the main thread and
  this is network contention only — but `requestIdleCallback` (with the 3s as a
  floor and a timeout so it always runs) would be strictly better timed.
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

### Lower-priority items (not yet actioned)

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
- **A sync push can add or change a field, but not REMOVE one** — `/api/sync/bulk`
  applies an update as `$set: {...payload}`, and `JSON.stringify` drops keys
  whose value is `undefined`, so a field the client cleared keeps its old value
  on the server and comes back on the next pull. Worked around per-field with a
  `null` sentinel (`FlightLog.deletedAt`, `Discrepancy.acceptedAt`), which is why
  those test `== null`. **`unresolveDiscrepancy` still has the un-fixed form** —
  it clears `resolvedAt`/`resolvedBy`/`resolutionNotes` with `undefined`, so a
  reopened note keeps its resolution metadata server-side (harmless today: the
  page keys off `resolved`, which is a real `false`).
  The general fix is for the server to `$unset` the keys the payload omits — the
  existing document is already in hand as `existingMap`, and both enqueue sites
  send a COMPLETE entity, so replacement semantics are correct. Deferred because
  a device running an older build sends the field set that build knows about: if
  it pushes an edit before updating, `$unset` would wipe fields a newer device
  had set. Needs a rollout story (and a real Mongo integration test) first.
- **Service worker** (`public/sw.js`) — two items needing offline testing
  before any change (a bad SW is hard to roll back): (1) `install` calls
  `self.skipWaiting()` unconditionally while the registration
  (`hooks/use-service-worker.ts`) is built around an update-*prompt* flow, so
  the prompt is effectively dead and a background update can auto-reload the page
  mid-edit (auto-save mitigates data loss); (2) the Strategy-6 catch-all caches
  any cross-origin `ok` GET (no same-origin guard). Both are latent/hardening,
  not active data bugs. (`DYNAMIC_CACHE` is now FIFO-capped at 150 entries via
  `trimDynamicCache()` after each put — everything in it is re-fetchable, so an
  eviction just falls through to network/shell fallbacks.)

## PWA Details

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
- `components/nav-pill.tsx` — The pill↔sidebar morph, the gravity blob's two springs, and the drag lens
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
    | the review modal's footer controls (over a bottom `ChromeFade`) | the import status dialog's Done button (plain dialog surface) |

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
    iOS-dark app. At 0.05 the face lands around oklch **0.23**, which is where
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
  Each option is a 64px `rounded-lg` tile in `bg-secondary` carrying its icon
  over a `text-xs` word, CENTRED on the `…`, and they travel out from it one
  after another (`STAGGER_MS`) — the panel extending rather than a dialog
  appearing over it. That is literally `swipeable-card.tsx`'s `BUTTON_WIDTH`,
  radius, fill, gap and label size: the run comes out of a control in that
  panel, so anything else read as a different family of control turning up next
  to it. They were 56px circles in `bg-card` for a while, which was closer to
  the grouped-row vocabulary than to the panel they belong to.

  Square rather than the swipe button's full row height — the cascade is a
  COLUMN, and five row-height tiles is most of a screen. The one thing added to
  the swipe button is a shadow, because unlike a swipe button these float over
  the list instead of sitting inside a row. Deliberately NOT glass: glass is
  chrome floating over content and these have to be read; over a list of cards
  a glass slab showed the cards straight through the labels. The word goes
  INSIDE the tile — outside it, floating over a dense list, it landed on a
  flight's route and needed a backing plate of its own to stay legible.

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
- Do not advance the sync watermark from the client clock — `lastSyncTime` must come from the server-returned `syncedAt`, and only after every collection pulls cleanly
- Do not delete a record on the server before its tombstone is written (`/api/sync/bulk`) — that order prevents deleted records resurrecting on other devices
- Do not issue a session from a passkey route without calling `verifyAuthenticationResponse` — a `credential.id` lookup is not proof of possession (credential IDs aren't secret). Same for `register/complete`/`add-passkey`: bind the attestation to the server-issued challenge (`webauthn.create` + matching challenge)
- Do not trust client-supplied `userId`/`callsign`/`totpSecret` in `register/complete` — read them from the consumed server-issued challenge doc
- Do not re-tighten the WebAuthn counter check to always-strict — synced/platform passkeys report `signCount 0` forever; only enforce strict increase when a counter is in use (either side non-zero)
- Do not accept a TOTP code without the `auth.lastTotpCounter` replay check, and keep the OTP comparison constant-time (`verifyTOTPWithCounter`)
- Do not verify a TOTP code with a bare `verifyTOTP` — that wrapper is GONE. It called `verifyTOTPWithCounter` and threw the counter away, which is the replay-protection signal, so an unused export sitting next to the correct one was a footgun with the more obvious name. `verifyTOTPWithCounter` is the only entry point
- Do not reintroduce per-file registration normalizers — use the canonical `normalizeRegistration` in `lib/utils/string.ts` on both client and server
- Do not re-add a bulk CDN aircraft download — the aircraft DB is populated from FR24, custom entries, and the MongoDB enriched pool only
- Do not remove `"use client"` directives — server/client boundary is intentionally designed
- Do not commit `.env` files or MongoDB credentials
- Do not use `npm install` or `npm add` — always use `pnpm` to keep `pnpm-lock.yaml` in sync (Vercel uses frozen-lockfile)
- Do not expose FR24 as the data source in UI — the user explicitly requires online lookups to be transparent (no "Online Results" labels, no Globe icons, no "FlightRadar24" branding)
- Do not add hexdb.io fallback for aircraft lookup — if FR24 fails, manual entry is the only option
- Do not bypass `recalculateFlightFields()` `manualOverrides` — users' manually entered field values must never be overwritten by enrichment
- Do not put the active route back into context as a plain value, and do not render a keep-alive page's element inline in the stack — either one re-renders all six retained pages on every tab switch. The route is a store whose SNAPSHOT is the per-page boolean (`useSyncExternalStore`), and each page is `memo`ized on its route key
- Do not add pages to `PERSISTENT_PAGES` in `keep-alive-pages.tsx` without considering memory impact — only heavy virtualized pages should be persistent
- Do not use `display:none` for hiding keep-alive pages — `visibility:hidden` is required to preserve scroll positions and virtualizer measurements
- Do not re-add swipe "full-swipe to auto-trigger the primary action" to `SwipeableCard` — it was intentionally removed; actions fire only on button tap
- Do not put a confirmation in front of a delete — not a dialog, not a hold, not an armed countdown. Deleting is one tap and `Recently Deleted` is the undo (30 days). The countdown machinery survives for exactly ONE caller, "Log out of all devices", because that genuinely has no undo; do not wire `holdToConfirm` to a delete again
- Do not move the armed-action timer back inside `SwipeableCard` — it lives in `lib/utils/pending-actions.ts` because a virtualised list recycles rows, and an in-component timer meant scrolling away silently cancelled the deletion. And always pass a **data-derived `id`** to a card that can be armed; the `useId()` fallback changes on recycle and orphans the registry entry
- Do not move the sidebar's gravity blob back into a non-scrolling overlay translated from a scroll listener — that is a main-thread reaction to a scroll that already happened, so the blob trails the items by a frame. It belongs inside the scroller, where it moves on the compositor; the top band is masked anyway, so there is no overshoot clipping to protect it from
- Do not give the morph different open and close leads — one `MORPH_LEAD` keeps the two directions exact mirrors, which is what makes the top pill and the bottom pill read as the same animation
- Do not put a `backdrop-filter` back into the sidebar backdrop, the modal backdrop, or a second layer into `ChromeFade`. Progressive BLUR is a chain of full-viewport readbacks that re-rasterise whenever the backdrop or the geometry changes — under the sidebar that is every frame of the morph, and under a header it is every scroll frame. All three are progressive DARKENING now (`SIDEBAR_BACKDROP_RAMP`, `--modal-scrim-core`, and `ChromeFade`'s single 1.8px layer under its veil), which is one paint and a composited opacity
- Do not put `width: auto` back on the nav pill — `width` animates alongside `left`/`transform`, and CSS can't interpolate to `auto`, so it snaps on the morph's first frame and the pill resizes before it moves. Keep the measured px endpoint from `usePillWidth` (measured only while settled as a pill, in a ResizeObserver callback)
- Do not animate the gravity nav indicator with a Framer/JS spring, and do not put its motion back on a bezier — it is two damped harmonic oscillators (`springTrack()`) sampled into WAAPI transform keyframes, so the physics runs on the compositor. A JS spring hitches when a heavy page mounts; a bezier can't express a landing squash that stays in step with the travel. Keep the travel heavily damped (no hunting) and the SHAPE on its own looser oscillator — deriving the squash from the travel spring's velocity gives no landing compression at that damping, and loosening the travel to fix it reintroduces the hunting For the nav morph, keep the overlapping per-property delays (`morphTransition`) with the **asymmetric** open/close leads (closing collapses height almost fully before it moves — do not make it symmetric or simultaneous), and keep the phase advancing on **both** the fallback timer **and** the *delayed* property's `transitionEnd` (keyed to `propertyName` so the delayed group is never cut). The **pill** content stays hidden until settled (it squishes mid-morph), but the **sidebar** content is intentionally visible + interactive for the whole open span with its opacity timed to the height (reveal + growth = one motion) — do not gate it back on the settled phase (drops taps) or fade it on its own timeline (reads as two motions)
- Do not add a rule, material or layout that only one engine gets — iOS and Android must render the app identically. In particular do not reintroduce `@supports (-webkit-touch-callout: none)`, the WebKit-only sniff: it silently made Android's date fields shorter and its focused fields slower to take a tap. A vendor-prefixed property paired with the standard one, or inert elsewhere, is fine. The sole exception is the PWA install prompt, where the OS flow itself differs
- Do not end the glass press on `touchcancel`/`pointercancel` — Chrome fires those the moment a move looks like a scroll, which is what made the Android spotlight die as soon as the finger moved. Track on the window, treat a cancel as bloom-only, and let the grace timer close it out
- Do not set the dark theme's `--glass-veil` back to `transparent` — a backdrop-filter has nothing to work with over pure black (blur/saturate of black is black; brightness is multiplicative), so the veil is the only thing giving the slab a face on an empty screen. Keep it warm rather than plain white, or the material reads grey over content again
- Do not animate `.GlassBlur`'s filter VALUE — no transition on it, and no `data-morphing` surge. The nav morph already interpolates `left`/`width`/`height`, so the backdrop readback runs every frame; changing the blur RADIUS on top of that means the kernel changes too and nothing in the pass can be reused, for the busiest 300ms in the app. That was the mobile sidebar's jank. The swell it produced cannot be rebuilt compositor-side — a second element carrying the surged filter is the stacked-backdrop-filter construct below
- Do not add a second full-face `backdrop-filter` to the glass — `.GlassBlur` carries the only one, as a single filter *list*. Six of them stacked on separate elements is what made the nav pill warm-and-dark on iOS and flat grey on Android: Blink composes the chain, WebKit doesn't, and neither is wrong. Anything the material needs goes into that one list (and the rim layers stay masked to the edge band)
- Do not give the drag lens's `-refract` layer a `backdrop-filter` instead of its background — the lens is portalled to `<body>` and carries its own `scale`, so it forms a backdrop root and a backdrop-filter there does not sample the pill at all (measured — `blur(10px)` leaves the label underneath perfectly sharp). The layer must paint over the pill it duplicates, or the copy and the original show at once. Cutting the pill out with a mask instead was tried and rejected on the look
- Do not minify the drag lens's copy uniformly — the squeeze is `scaleY` ONLY, with the row counter-scaled so the labels keep their size and only the control gets shorter. And do not push `LENS_SQUASH` much below 0.84: the counter-scaled row has to fit the copy's box, and the mobile pill's 44px tab item in a 56px bar is what sets that floor (at 0.72 the icons and labels were clipped away entirely)
- Do not reintroduce an SVG-displacement glass lens (`backdrop-filter: url(#…)`), or any other material that only one engine gets. It was removed on purpose: an SVG backdrop-filter re-rasterises every frame the element resizes or scales, every surface had to raster and PNG-encode megapixel maps on the main thread behind a cache/debounce/stand-in, and Android ended up looking unlike iOS. The owner's verdict was that it made the PWA feel laggy rather than crisp. One ring material, every platform — if the rim needs more presence, change the ring stack
- Do not delete a user record outright — `deleteEntity` is a **soft delete** into Recently Deleted (30 days) and pushes an UPDATE; only `purgeEntity` writes a tombstone. Push a real delete when the user merely binned it and the row is gone on every device with nothing to restore. The two exceptions are discrepancies and schedule entries, which are import bookkeeping and stay hard
- Do not merge the dashboard's two pages back into one. Legal and Summary want opposite layouts — an instrument read in two seconds versus a month's review — and one layout serving both is what makes a dashboard a spreadsheet. They get different containers: Legal is laid out TO the height (no scroll), Summary is an ordinary scrolling page
- Do not change a figure in `fdp-tables.ts` without changing `fdp-tables.test.ts` FROM THE REGULATION first — that test transcribes the Fifth Schedule's own numbers, so it is the check ON the tables rather than a copy of them. Same for `rest-period.test.ts` and paragraph 3
- Do not treat the rest sub-rules of para 3(1) as alternatives — they are joined by "and", so every applicable one must be met and the requirement is the LARGEST of them. As an if/else chain an 11-hour duty resting without a local night asked for 11 hours instead of 12. The same rule holds in `calculateRestUntilLegal`, which had the chain long after `calculateRestPeriod` lost it — that one is the countdown a pilot reads off the dashboard
- Do not reintroduce a definition the FIRST SCHEDULE already gives. `lib/utils/roster/regulation-definitions.ts` is the vocabulary the Fifth Schedule is written in, and the three terms that were assumed were all assumed WRONG: a local night is any 8 contiguous hours in the **2200–0800** window (not a fixed 22:00–06:00 band, and not any overlap with one), a rest period commences **one hour after free of all duties** (not 30 minutes after gate-in), and "acclimated" is **3 consecutive local nights free of duty in a zone** (not proximity to home base)
- Do not measure a local night at home base — it is local time **where the crew member actually is**, which is the preceding duty's `arrivalTimezoneOffset`. Testing a Singapore night against a rest period spent in London picks the wrong rest rule in whichever direction the zones happen to fall
- Do not end a duty period at gate-in. Para 7(2) requires 90 minutes of checks around the flying with at least 60 before it, so at least 30 minutes of post-flight checks are still DUTY — and the rest period commences an hour after that, not 30 minutes after the aeroplane parks
- Do not decide an FDP table from the departure airport's offset alone. `applyAcclimatisation` re-derives each duty against the zone the crew member was acclimated to **as at that duty's report time**, from the duties before it — reading the duty's own arrival zone would let landing somewhere instantly justify its own table. It must run between `mergeDutyPeriods` and `calculateAllRestPeriods`, because the rest calculation reads the corrected figures
- Do not classify a duty's circadian state where the duty period is BUILT — early start, late finish and the window of circadian low are all defined in ACCLIMATED time, and acclimatisation is a property of the whole timeline. The producers store the raw instants (`departureMs`/`arrivalMs`/`takeoffLandingMs`) and `applyAcclimatisation` does the classifying. Carry all three through `mergeAdjacentDutyPeriods` too, or a merged overnight — precisely the shape that lands in the window — is classified against half of itself
- Do not read the window of circadian low against a duty period or a cruise — it is defined "in relation to a **take-off or landing**", 0200–0459. A sector airborne at 2310 and landing at 0650 is over the window for its whole middle and touches neither end of it
- Do not track paragraph 4's disruptive run inside `calculateRestPeriod` — 4(2) reacts to the two duties BEFORE the one whose rest is being measured, so neither duty in a pair can see it. `calculateAllRestPeriods` carries the count, and it is "since the last 24-hour circadian rest": a duty that para 4 already demanded 24 hours before opens a NEW series rather than extending the old one, and an ordinary duty clears it
- Do not treat a flight with no wheels times as never touching the window of circadian low — every PLANNED sector and older logbook rows carry out/in only, so the gate times stand in for them. Silence there is the permissive way to be wrong. A LOCAL_STATION schedule report is the opposite case and is left unclassified on purpose: its departure-side and arrival-side times are in different zones the entry cannot resolve
- Do not count only the LONGEST sector for the para 14(2) adjustment — the schedule says long sectorS. Two 8-hour sectors are 4 effective sectors under Table A, not 3, and under-counting raises the FDP maximum. Pass `sectorMinutes: number[]`, and carry `DutyPeriod.sectorMinutes` through `mergeAdjacentDutyPeriods` or a merged overnight silently loses the adjustment
- Do not apply the para 14(2) long-sector adjustment to an augmented crew or to Table C — it applies where the crew "only consists of 2 pilots", and an augmented crew's ceiling comes from para 15 instead
- Do not grant the augmented-crew extension without `inFlightRestFacilities === true` — para 15(3)(b) forbids any extension without rest facilities, and UNKNOWN must withhold it rather than assume in favour of a longer duty
- Do not swap `DEFAULT_FTL_LIMITS` for the cabin-crew figures. Para 12(1) gives FLIGHT crew 90h/14d and 180h/28d; 12(2) gives cabin crew 100h and 200h. This is a flight-crew logbook
- Do not compute an FDP maximum anywhere but `deriveMaxFDP` — it is the ONE derivation, and every stage (both producers, the overnight merge, the acclimatisation pass, the hypothetical-duty builders) goes through it. Four sites recomputing it from whatever inputs each had is what put 10:15 on a duty the schedule allows 12:15 for
- Do not enter Table A on `reportTime`. That is when the duty STARTED; the table is entered on `fdpStartLocal`, which is the **original** (scheduled) reporting time in the DEPARTURE station's clock. Para 10(a) is explicit — a delay under 4 hours keeps the maximum on the original report while the FDP starts at the actual one — and a 23-minute pushback on a 2150 report crosses into the 2200–0559 band and takes an hour and a half off the maximum, which then reads as an exceedance the pilot never committed
- Do not shift a LOCAL_STATION report time by the departure offset — it is ALREADY the local time where the crew member reports, so shifting double-counts (eight hours, two bands of Table A, on a UTC+0 departure). UTC shifts by the departure offset; LOCAL_BASE shifts from SGT to it
- Do not HARDCODE an FDP maximum, ever. Under CAAS Reg 14 it moves with report time, sectors, crew complement, acclimatisation and the long-sector adjustment; `DutyPeriod.maxFdpMinutes` already holds the figure `calculateMaxFDP` computed for THAT duty, and `fdpTableUsed` is printed beside it so it can be checked. A duty with no computed maximum shows a dash, not a default — a default is a number somebody might fly to
- Do not add a 7-day duty figure to the dashboard. CAAS imposes 14-day and 28-day duty caps (Reg 12) and 28-day/12-month flight caps (Reg 107); a 7-day limit is not in the regulation and printing one is worse than printing none
- Do not turn the legal page back into a stack of glass cards — six cards' borders, radii and margins cost ~120px of a phone's height, which is the difference between it fitting and not. One surface, hairline `divide-y` rules. And keep it `max-h-full`, not `h-full`: stretching makes the one `flex-1` section absorb every spare pixel and leaves a hole under the last requirement
- Do not fall back to the fullest rolling limit for the "tightest" constraint — a limit REFILLS, so 41% of a 12-month flight allowance is not tight, and reporting it named the least urgent thing on the page. With nothing flagged the answer is the nearest EXPIRY, which is why only `currency` requirements carry `daysUntil`
- Do not sort currencies and rolling limits into one grid. They are different kinds of thing (days that expire vs hours that refill) and mixing them is what made the panel unreadable at a glance — separate bands, and keep the limits PAIRED (Duty 14d/28d, then Flight 28d/1y) rather than four rows sorted by urgency
- Do not split 90-day recency back into separate takeoff and landing cells — they are two halves of one question, and urgency-sorted they did not even sit beside each other. One cell answers with the binding half; expanding shows both
- Do not put rest back in the currency band — it is a property of the duty just flown, not a standing qualification, and a live countdown among expiry dates reads as a different kind of thing. It lives in the duty band, and the annunciator has to fold it into the verdict itself since it is no longer one of the requirements
- Do not print the rolling limits in the duty band as well as the limits band — that was the duplication the rework removed. The duty band carries FDP and flight time for THIS duty only
- Do not derive a gauge's colour from how full its arc is — state the tone. A nearly-full FDP ring is a warning and a nearly-full REST ring is good news; deriving it painted a fully-rested pilot amber
- Do not make the legal page's cells navigate on tap — they EXPAND in place and a second tap closes them. The reader came to check a status, and a route change loses the screen they came for. The deep link belongs inside the expansion
- Do not replace the sector chain with a list of recent flights — that list showed history, not THIS duty, and could not answer "where am I in a four-sector day". The chain comes from `deriveSectorLegs` off the duty's own route
- Do not let the summary page's flight list grow the page — it scrolls in its own bounded box, so a year-long period cannot push the breakdown below it out of reach
- Do not read an in-progress duty from the logbook alone. `mergeDutyPeriods` prefers the logbook for today, and mid-duty the logbook holds only the sectors already flown — so a two-sector day with one sector logged reads as a duty that ended at lunchtime and the panel falls through to a rest countdown. Pass `scheduleDutyPeriods` into `deriveDutyStatus`; where the roster runs later, the duty is still on
- Do not treat the FDP pipeline's duty periods as the whole plan. `computeFDPResult` filters to `isFlownFlight`, so a sector sitting in the logbook as `scheduledOut`/`scheduledIn` contributes nothing — on a part-flown day with no roster imported there is no plan anywhere, and the panel reads "Roster Clear" and counts down rest between sectors. `buildPlannedDuties` rebuilds the day from the flight rows with scheduled fallbacks; it is for duty shape and FDP only, never cumulative limits
- Do not show only ONE of FDP and duty remaining — they are different windows (report → last on-blocks vs report → debrief) and either can bind. Print both and gauge the smaller remaining, or the panel tells a pilot they have three hours left when they have one
- Do not take the FDP maximum, sector count or route from the logbook half of a part-flown duty — Reg 14 sets the maximum by the sectors PLANNED, so a one-sector logbook duty carries a one-sector limit that nobody should fly to. Plan supplies the shape and the limit; the record supplies what has been flown
- Do not put a number inside a meter's fill without checking it fits — below `LABEL_FITS_INSIDE` it goes outside the fill instead. A figure clipped by its own bar is worse than no figure
- Do not print "12 / 12 currencies current" — a pilot does not need telling about the eleven that are fine. The panel names the TIGHTEST constraint, and falls back to the fullest rolling limit only when nothing is flagged
- Do not state a problem without its remedy on the legal page. The next-action line is the imperative ("2 landings required"), phrased in `legality.ts` where the shortfall is in hand — not the reading ("landings 1 / 3"), which the requirement cell already shows
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
- Do not send the dashboard's flight rows to a full page to show their detail — they open IN PLACE, because the reader is looking at the period as a whole and navigating away loses it. `PeriodFlight` already carries the detail off the aggregator's existing walk
- Do not order flights anywhere but `lib/utils/flight-sort.ts` — the order must be TOTAL (date, then actual-or-SCHEDULED out time, then departure, then id) or rows move on their own: a new flight sat at the top of the logbook until the next refetch and then jumped, and reading `outTime` alone treated every unflown sector as 00:00 so scheduled flights sank below completed ones on the same day. An optimistic cache write inserts with `insertFlightSorted`, never by prepending
- Do not read a user table for a list, a total or an import match without filtering deleted rows (`isLiveFlight` for flights, `isLiveEntity` for the rest) — a binned row reaching the reconciler silently updates, and so resurrects, something the user deleted. The store's own `getAllX` already filters; go through it rather than hitting the table
- Do not use `RETENTION_MS` for a deletion sweep or `DELETED_RETENTION_MS` for a decision — they are 90 and 30 days and the helpers take the window as an argument precisely so a caller has to say which
- Do not clear a retention stamp (`deletedAt`, `acceptedAt`) by setting it `undefined` — `/api/sync/bulk` `$set`s only the keys the payload carries and `JSON.stringify` drops undefined ones, so the server's stamp survives and the next pull undoes the undo. Write `null` and test with `== null`
- Do not rebuild `normalizeFlightFromServer` as an explicit field allowlist — it must spread the server record first, or every field added since it was written is dropped on the way back down (that is how `entryType`/`isSimulator` were being lost)
- Do not open a detail with `router.replace` — an explicit open must PUSH, or the system back gesture skips the whole section instead of closing the detail. Decide "is it already open" from the URL, not the stored selection (a section keeps its selection while closed). And do not make the "re-sync `?selected=`" effect unconditional: it runs in the same commit as both the open and the back-clear, and will replace the pushed entry / put the param straight back
- Do not remove `overflow-anchor: none` from the logbook scroller — growing the top spacer is how the floating panels push the list, and scroll anchoring exists to cancel exactly that (it bumps `scrollTop` to keep the view still). With it on, the calendar only pushed the list when it was already scrolled to the top, and the compensating adjustment read as a downward scroll that hid the nav pill
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
- Do not collapse `FADE_TAIL` and `--chrome-clear` into one number — the first is how far the DARKENING reaches (41px, i.e. 45 below the buttons), the second is where the quick-scroll rail PARKS a row (60 below, ~15px clear of the band). Equalising them is wrong in both directions: the band ends up far down the screen, or the scrolled-to row ends up inside the treatment
- Do not put the drag-lens (`.PillDragLens`) release settle back on JS (framer `animate()`) or on layout properties — it must stay CSS `translate` + `scale`, which run on the compositor, because the release also fires `router.push` and a main-thread landing stalls against the route mount. Keep the two easings split (position no overshoot, scale overshoot = the splat), keep `--settle` dropping the glass's `backdrop-filter`, and keep the refract clone effect gated on `lensPhase === "drag"` so a deep clone of the pill never runs on the landing's first frame. Keep it clamped to the tab strip (edge overshoot → the liquid bounce) and keep the handoff timer longer than the rebound (or the last wobble is cut)
- Do not re-gate the dashboard's meters / FDP chart behind a deferred-animation flag — the blob is compositor-driven now, so they can animate freely
- Do not reintroduce a second typeface — Inter is the single app font (`--font-sans` and `--font-mono` both resolve to Inter); use `tabular-nums` for aligned numbers, never a `font-mono` class or a new Google-Fonts `<link>`
- Do not give `register/complete`, `add-passkey`, the callsign change, or the TOTP-reveal routes a path that skips `verifyAuthenticationResponse`/`verifyStepUpAssertion` — the TOTP seed must never be revealed without a fresh passkey step-up
- Do not give `SwipeableCard` action panels horizontal padding — the panel must collapse to 0 width when closed (the left gap comes from `openWidth`/`justify-end`), otherwise a sliver of the action button peeks at the card edge
- Do not put row dividers as a full-width `border-b` — use the inset `.row-divider` class so the line aligns with the `px-4` text
- Do not give inline form inputs a visible box — keep `border-0 bg-transparent dark:bg-transparent shadow-none rounded-none` so they blend with the row (and `md:text-base` so the font doesn't shrink in edit mode)
- Do not hardcode `orange-400` for scheduled flight cards — light and dark themes use separate colors (`orange-600` light / `orange-400` dark) for contrast

**Report import:**
- Do not write an imported record with a bare `table.put()` — it is a raw Dexie write with NO sync-queue entry behind it, so the row lives only on the device that ran the import. The importers reached for it because their rows already carry the ids the flight rows point at, which rules out `addPersonnel`/`addCurrency`; `putManyWithSync` (`crud-helpers.ts`) is the shape that keeps the id AND enqueues, in one `bulkPut` + one `enqueueMany` rather than 2N round trips. Crew, currencies and discrepancies were all silently local for exactly this reason
- Do not close the import status dialog when an execution finishes — it is the ONLY surface that renders the summary and the error message, and closing it in the `finally` meant every eCrew import ended in silence with the work done and nothing said. `onDone` closes it; a cancel closes it without setting a summary nobody will see
- Do not fan a per-item enrichment leg out with `Promise.allSettled(remaining.map(…))` — that is every unresolved registration or airport at once, each holding an 8s timeout through one proxy route. Go through `pooledForEach` (`shared/pooled-map.ts`); a roster's handful behaves identically and a career's logbook gets a queue instead of a stampede
- Do not let a schedule report be read without it STATING its time reference — `timeReference` defaults to UTC, and eCrew issues the same report in three frames that differ only by the "All times in …" header line, so a Local Base report read as UTC puts every time in the file eight hours out as an auto-applied `update_safe`. Missing line = refuse the import
- Do not import a report without checking WHOSE it is. The header names its subject; nothing was comparing it, so a colleague's PDF wrote their flights into this pilot's logbook as ordinary creates. Refuse only when BOTH crew ids are present and differ — a missing id is an unknown, not a mismatch
- Do not auto-accept an operation whose sector carries `timesUncertain`. It means a LOCAL_STATION row named an airport nothing could resolve, so the offset fell back to zero and the times may be a whole timezone out. `applyDefaultAcceptance` withholds acceptance regardless of kind — a silently wrong time is exactly the change nobody reviews
- Do not feed the reconciler sectors without deduping them (`dedupeSectors`) — a PDF page break that repeats a row pairs the first copy with the stored flight, leaves the second nothing to claim, and turns it into an auto-accepted `create` duplicating the flight matched a line earlier. The key is date + flight number + route + out time, so a genuine repeated-route day keeps all its legs
- Do not scope an import's MATCH pool to the date range the report's header states — eCrew includes the trailing leg of a duty that starts on the last day, so a `01/01 - 31/01` report carries a `01/02` row. Filtering candidates to the stated range left that flight out of the pool, the sector had nothing to pair with, and `create` fired — auto-accepted, so every re-upload added another copy of the same flight. Widen with `flightMatchWindow` (`roster/flight-window.ts`) and keep handing the reconciler the STATED range: its delete pass re-checks `csvDateRange`, which is what stops a spilled sector turning unrelated flights outside the window into deletion proposals
- Do not match an imported sector to a flight by "first unclaimed on this route" — pairing is decided globally in `match-assign.ts` with time as part of the key. The crew logbook report has no flight-number column, so on a repeated-route day the greedy version pairs every leg with the wrong one (see `repeat-route-day.test.ts`)
- Do not reclassify the company's OOOI/scheduled/block times as CRITICAL — they are the record of when the aircraft moved and apply without asking. Conversely do not make `pilotFlying`/`pilotRole`/day-night TO-LDG safe: they are the pilot's own account, and every difference is kept as a `Discrepancy` for the licence record
- Do not skip `detectEditReasons` before classification — it is what protects a signed/remarked/manually-overridden flight regardless of which fields changed
- Do not dedupe simulator sessions on `date|simSessionCode` alone — recognition must stay structural (no route, no registration), or sims written by an older build duplicate on every import
- Do not read `FlightLog.entryType` directly — go through `getEntryType()`, and write through `entryTypePatch()` so the legacy `isSimulator` flag stays in step for the dashboard and FDP pipeline
- Do not let a simulator's duration reach `blockTime` — it belongs in `simulatedInstrumentTime`, which is what keeps sims out of flight-hour totals

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
- Do not format a clock time with `formatHHMMDisplay` — that is for durations (which always keep their colon). Points in time go through `formatClockDisplay` so `clockSeparator` governs them all
- Do not use a flat `bg-black/50` for a modal overlay — use `MODAL_SCRIM`; black at 50% is invisible over a dark app and turns the light theme into grey mush
- Do not add the sidebar's floating-strip treatment to only one morph — `DesktopPillMorph` and `MobilePillMorph` must both float the toggle/sync strip over the nav with `topInset`, or the scroll-under silently works on desktop and not on a phone. And keep the dissolve mask on the blob overlay as well as the nav (on the OUTER, untranslated element), or the blob stays solid in a band where its own row has faded out
- Do not let the header veil go solid or lean on blur for the treatment — `ChromeFade` is a **darken with a hint of blur**: the gradient tops out at 50% `--background` and the blur ramp peaks at 2.4px. A solid veil hides the content passing under the status bar (reads as the app stopping there — the web-page-in-a-frame look the edge-to-edge work removed), and a heavy blur smears it into an unreadable band. Text sliding under the bar must stay legible enough to make out roughly what it says
- Do not re-enable the native scrollbar on an app scroller — iOS draws its indicator across the scroller's whole box, i.e. from the screen edge over the status bar. Scrollers carry `scrollbar-hide` + `components/ui/scroll-indicator.tsx` as the FIRST CHILD; it draws the same affordance inset to `--chrome-top` / `--nav-bottom-offset`, so it starts below the action buttons like a native scroll view's `scrollIndicatorInsets` while content still scrolls under the chrome. At either end it must **compress against the end of its track**, not ride the rubber-band: progress is clamped so the thumb is already parked, and the overscroll distance squashes it (asymptotically, so a hard fling never collapses it to nothing)
- Do not cache the scroll indicator's scroller box behind a ResizeObserver alone — opening the sidebar SLIDES the main panel across without resizing it (`0..360` → `199..559`), so no observer fires and the thumb stays at the closed layout's right edge, drawing a grey rule down the middle of the flight cards. Re-read the box in the update
- Do not rely on the cascade's event blocking alone to keep cards still — while a menu is open `SwipeableCard` sets `pointer-events: none` on its root and drops `drag` (`lib/utils/menu-lock.ts`). Intercepting events only covers the events you thought of, in the order an engine happens to send them; removing the row as a hit-test target covers all of them, and the touch still reaches the scroller behind it so the list keeps scrolling
- Do not move the scroll indicator's thumb back INSIDE the scroller — it is a `position: fixed` element in `document.body`, placed against the scroller's cached box. It lived on a sticky anchor inside the scroller once, with its drift measured and cancelled per frame: that pinned correctly while a finger dragged, but the rubber-band RELEASE is compositor-animated and the correction runs on the main thread from coalesced scroll events, so the track visibly snapped back with the bounce. Nothing inside the scroller can win that race. The zero-height sticky marker that remains is only a rubber-band **sensor** (its drift is the bounce distance for engines that clamp `scrollTop`) and is read at the TOP only — at the bottom it stays pinned, so measuring there returns the whole scrolled distance and collapses the thumb
- Do not let the logbook's first card butt against the chrome — `LIST_TOP_GAP` (20px) starts it where crew / aircraft / airports start theirs (measured: first card at 72 against `--chrome-top` 52 on both). It is DROPPED while the search or the calendar is open: that panel's own bottom edge is the separation there, and the gap read as slack hanging off the calendar (measured: first card at 415, exactly the calendar's bottom)
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
- Do not give a full-surface overlay `inset-0` on desktop — the sidebar and the nav pill draw above it, so it ends up BEHIND them with its top unreachable (that was the signature pad on iPad). Take the content region: `--chrome-top`/`--chrome-bottom`, plus `SIDEBAR_WIDTH_PX` on the left only while the sidebar is PUSHING (below 1120 it overlays full-width panels and the region has not moved). Mobile keeps `inset-0` — there the dialog is above the bottom nav and the viewport IS the region
- Do not redeclare the sidebar's width — it is `SIDEBAR_WIDTH_PX` in `lib/layout/panel-widths.ts`, part of the same budget as the panel widths (1180 − 199 − 1 = 980 on iPad Air 5 landscape). It had drifted into three separate copies
- Do not hardcode the panel widths — they live in `lib/layout/panel-widths.ts` and are a single budget. `DUAL_MONTH_PX` is 600 rather than 620 because 620 + 360 detail is EXACTLY the space iPad Air 5 landscape has with the sidebar open, so it fit with zero slack and any rounding took the dual-month toggle away on the owner's device
- Do not let a single calendar month be wider than a DUAL pane in the split layout — the cells are square, so its width is its height, and a taller single month means the width toggle resizes the calendar under the flight list on every switch. Cap it at `MONTH_PANE_PX` and give it the same month caption a dual pane has (the caption alone was 12px of the difference). Uncapped entirely it grew from 313px to 519px tall for the frames before the dual-month switch caught up
- Do not thin the rim by dropping the conic's FLANKS — iOS's controls have a hairline you can see ALL THE WAY ROUND, and at flanks of ~0.05 three-quarters of the perimeter had none. Keep the lobes concentrated (that is what reads as light on a curve) and the flanks around 0.22; the ring's WIDTH (`--softness`, and `.Highlight`'s padding with it) is the separate knob, and it is only free to be fine BECAUSE the flanks hold the continuity
- Do not open the flight card's `…` cascade behind a blocking scrim — the page must stay scrollable underneath (a scroll dismisses it) while taps are swallowed at the capture phase so nothing activates. And arm that swallow on a short timer, or the click from the tap that OPENED it closes it on the same gesture
- Do not let the `…` cascade leave `pointerdown`/`touchstart` alone — they must be `stopPropagation`'d in the CAPTURE phase, or a swipe elsewhere still reaches framer-motion and reveals that row's swipe panel with the menu up. And do not add `preventDefault` to them: that is what would kill the compositor's touch scroll, which is the one interaction the menu is supposed to allow (`preventDefault` belongs on `mousedown`, to stop desktop focus, and on the swallowed `click`/`pointerup`)
- Do not build the flight card's extra actions from glass — glass is chrome floating over content, and these have to be read; as a glass slab the flight cards showed straight through the labels. They are the SWIPE PANEL's button repeated (64px `rounded-lg`, `bg-secondary`, icon over a `text-xs` word, the panel's own 8px gap), because the run comes out of a control in that panel; 56px circles in `bg-card` read as a different family of control turning up beside it
- Do not give the context preview's compact body `layout="position"` — it is the one block that exists in BOTH states, so it takes a FULL `layout`. Its height is unchanged either way, which makes its delta scaleX only: the row's content is condensed at the first frame and relaxes out as the card widens. `layout="position"` cancels the horizontal scale too, which lays it out at the RESTING width from frame one and lets the card clip it — on a tablet the arrival time and ICAO are missing until the card widens past them. The detail and the actions DO take `layout="position"`; they exist only while open. And keep the lift a static shadow on its own PROJECTED (`layout`) node faded by opacity, outside the clip: an interpolated `boxShadow` is rebuilt as a string every frame, and `overflow: hidden` on an ancestor eats a shadow entirely
- Do not let the context preview come to rest in the row's own column — it settles CENTRED ON THE VIEWPORT at `MAX_WIDTH`, and only ever GROWS (a row already wider than that keeps its own width rather than shrinking, which would be the same frame-one mismatch in reverse). Keep the detail's own delayed reveal (opacity + y, ~30% of the morph in): the box growing and the content arriving are two things, and running them together reads as a jump. It does NOT animate `blur()` — that is a per-frame filter pass on the busiest frames of the overlay, and the delayed opacity/travel already says "settling into the room"
- Do not give the context preview's backdrop a blur — it is a plain darken (`SCRIM`). Full-viewport `backdrop-filter` layers each sample the one below, so the whole stack recomputes every frame their opacity changes, and that landed on exactly the frames the card is travelling. Giving it its own short clock helped and was not enough; the reference implementation this morph was measured against has no blur either. A DIALOG's backdrop keeps its blur — nothing is animating a card behind it
- Do not unmount the context preview on a timer set to `MORPH_MS` — the collapse only STARTS on the commit after the closing state flips, so that timer is systematically a frame or two early and the overlay disappeared with the card still short of its row, which un-hid underneath and read as a flash on the flight card. The card's own `onLayoutAnimationComplete` is what "closed" means; the timer stays only as a safety net, and longer than the morph (measured: card lands at 459ms, overlay unmounts at 510ms, zero frames with both visible)
- **Blur animation rules, app-wide.** Never ANIMATE `backdrop-filter`, `filter`, `mask-image`, `height` or `top` — they are layout- or paint-bound and re-rasterise every frame. Animate `opacity` and `transform` only. Where a progressive blur has to appear or disappear, fade the layers' OPACITY on a SHORT clock of their own (~160ms) rather than the surrounding motion's, so the blur settles before the thing it sits behind has finished moving and the rest of the animation composites a texture that no longer changes. And keep the stack to THREE layers on a full-viewport effect: each layer samples the output of the one below, so it is a chain rather than a sum, and the fourth link is the one a weak mobile GPU shows. `RadialBlurBackdrop` and `SIDEBAR_BACKDROP_BLUR` both follow this; `ChromeFade` is static and does not animate at all
- Do not fade a `backdrop-filter` layer by fading an ANCESTOR — an element with `opacity` below 1 (or `will-change: opacity`, a mask, or a filter) is a **backdrop root**, so its descendants' `backdrop-filter` can only sample inside it. The context preview's `RadialBlurBackdrop` used to sit inside the scrim that fades: for the whole morph the layers blurred nothing, then the full stack snapped on the instant the scrim hit exactly 1 — a hitch at the end of the animation, and the part of that overlay most likely to be felt on a phone. Fade each LAYER's own opacity instead (an element's own opacity is fine — the root is an ancestor boundary), which is how `SIDEBAR_BACKDROP_BLUR` has always done it. A CSS transition there also needs the layers to MOUNT at 0, or there is no previous value to run from
- Do not put a `layout`/`layoutId` prop on a flight card in the LIST to morph the context preview out of it — the rows are VIRTUALISED, and that hands framer every rendered row to measure on every layout change. The preview is a FLIP, but only the OVERLAY carries the projection: the collapsed box is stated outright from the anchor we already measure when the hold fires, so the list is never involved. Anchor it to the card (`[data-slot="card"]`), not the row wrapper — the wrapper carries the per-row top gap and 4px out is a visible jump on the first frame
- Do not put `transition-all` on a flight card — its visibility is toggled by the context preview, and `transition-all` animates `visibility`. Measured: hidden→visible still computes `hidden` for the FIRST FRAME, so the overlay unmounts and the row is blank for a frame (the flash on collapse); visible→hidden holds `visible` for the whole 150ms, so the source row shows through the opening morph as a second copy of the same flight. `transition-colors` is what the hover/selected states actually wanted
- Do not let the flight card's press-and-hold fire on a row whose SWIPE PANEL is open — the actions are showing and the card has been pushed aside to reveal them, so a press there is aimed at a button, not at holding the card. `SwipeableCard` publishes `data-swipe-open` for exactly this (unconditional, unlike `data-swipe-active`, which is scoped to `separated` rows because it drives their divider morph)
- Do not tear the context preview down on the dismissing tap — the morph runs BOTH ways, so closing collapses it back onto the row first. And keep the source row `invisible` while it is up, or the copy opening on top of it shows the same flight twice through the scrim
- Do not switch a `motion` component's `style` between two differently-shaped objects — a motion component does NOT clear a style property that merely disappears from the object. Measured on the context preview: the collapsed branch set `position`/`top`/`left`/`height` and the expanded branch omitted them, so they stayed on the element for the whole morph, the card never left the row, and there was no layout change for `layout` to animate. Supply every key in BOTH states
- Do not release a `useBackDismiss` marker synchronously in the effect cleanup — `history.back()` lands in a later task, so a teardown immediately followed by a re-run (React StrictMode double-invokes every effect in development, and any fast `active` toggle does the same) issued the `back()` after the new effect had already pushed a fresh marker and attached its listener, and the overlay dismissed ITSELF a few hundred ms after opening. The release is deferred by a task and cancelled if the effect comes straight back, which also stops the stack growing an entry per remount
- Do not let the flight card's hold arm from a press on the row's own CONTROLS — the pointer hooks sit on `SwipeableCard`'s outer container, so the swipe buttons are inside them, and a thumb tap on `…` outlasts `HOLD_MS` on a phone. That opened the context preview instead of the cascade. Bail when the press starts on a `button`/`a`/`input`/`textarea` or inside `[data-swipe-actions]`
- Do not put the flight card's ACTIONS back behind a press-and-hold — they live in the swipe panel behind `…`. A hold is an invisible gesture that nothing advertises, and as the actions menu it competed with the swipe and the scroll for the same pointer. The hold now drives the CONTEXT PREVIEW instead, which is a different job (a look, not a menu) and the one thing a hold has always meant; it still needs the movement cancel and the synthetic `pointercancel`
- Do not let a dismissing tap on the `…` reopen the cascade — the swallow closes it on `pointerup` and the follow-up `click` then arrives with the listeners already gone. Keep `CASCADE_REOPEN_GUARD_MS`: an open request within 350ms of a close is the same tap, whichever order an engine delivers it in
- Do not confine the header's blur to the bar's own height, and do not scroll a row to `--chrome-top` — content has to clear `--chrome-clear` (the bar PLUS the fade's tail). A row parked at the bar's edge sits in the blur and looks sharp enough to tap when it isn't
- Do not let the bottom nav hide on scroll — it is the app's primary navigation on a phone, and it disappeared exactly when a long read made you want it, with a scroll UP as the only way back. The machinery for it is GONE, not merely switched off, and that is the point: `ScrollNavbarProvider` sat at the very top of the app tree and flipped a `hideNavbar` state on every scroll direction change past a 10px threshold, so a single flick re-rendered the whole tree — six mounted keep-alive pages, the shell, the virtualised logbook — to compute a value the nav had already stopped reading. Do not reintroduce a scroll handler that writes state anywhere above a page
- Do not `refresh` a data hook with `mutate(undefined, { revalidate: true })` — clearing the cache first flips `isLoading` true and flashes the list's skeleton on every background refresh, and it hands out a NEW array even when nothing changed, which defeats SWR's default deep `compare` (`dequal`) and makes every downstream memo recompute (the FDP pipeline, the dashboard aggregates, the calendar's flight-date map). Bare `mutate()` revalidates in place. For the same reason `isLoading` must NOT be `isLoading || isValidating`: SWR's `isLoading` already means "no data yet", and folding in `isValidating` turns every revalidation into a skeleton
- Do not construct an `Intl.DateTimeFormat` per call — go through `lib/utils/tz-format.ts` (`tzFormatter` / `tzOffsetName`). — resolving locale and timezone data is by far the most expensive part of formatting, and `getAirportTimeInfo` built TWO per call while the logbook parser and the roster executor each resolve a departure and an arrival offset PER SECTOR, and the schedule parser's `normalizeTimeToUTC` resolves one per TIME TOKEN (~six a row). Cache the FORMATTER (stateless, and every caller still hands it the current instant), never the resolved offset — a cached offset pins whatever DST was in force the first time that airport was seen. Measured on 800 lookups across 8 zones: 143ms → 8ms
- Do not look a reference record up with `array.find(a => a.code.toUpperCase() === …)` — the airport table is ~10k rows and that allocates an uppercased string for every one of them, per lookup. `getAirportByICAO`/`getAirportByIATA` are backed by a `WeakMap` index keyed on the array itself (no invalidation to get wrong: a new array is a new key), and they must keep `find`'s FIRST-match rule, which `airport-code-index.test.ts` pins. The same shape appears wherever recents are resolved — build the Map once, then look up
- Do not reload a whole reference table on mount to notice a write — `useAirportDatabase` re-read all ~10k airports from IndexedDB every time it mounted, and the flight form mounts on every flight tap. Writers bump `getAirportsRevision()` and the hook reloads only on a mismatch. Every write to `referenceDb.airports` lives in `airports.store.ts` (rebuild / addCustom / toggleFavorite) — a NEW writer must bump it too, or a cached copy goes stale. Capture the revision BEFORE the read, so a write landing mid-load leaves the cache looking stale rather than falsely current
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
- Do not hand-roll a spinner — waiting is one thing and should look like one thing. `PageLoading` is the route-level state (every `loading.tsx`, the keep-alive Suspense fallback) and `PanelLoading` is the detail-panel one, both in `components/ui/page-loading.tsx`. The aircraft, airports and crew pages each carried an identical copy of a `border-2 border-primary border-t-transparent` ring, so waiting for a pane looked like a different kind of waiting depending on which tab you were on
- Do not size the mobile bottom pill from `PILL_HEIGHT` — it is `MOBILE_PILL_HEIGHT` (56 against the desktop 44). They are not the same control: one is a row of text tabs in a dense header, the other is the phone's only navigation, aimed at with a thumb
- Do not give the bottom bar a squarer corner than a stadium — `MOBILE_PILL_RADIUS` is half its own height, the same rule the 44px controls follow; it is a separate constant only because the bar is a different height. A third-of-the-height radius was tried (the proportion the reference tab bars use) and rejected on the look: what reads as a squircle there is CONTINUOUS CURVATURE, not a smaller radius, and a circular arc at that radius is just a rounded rectangle. Drawing the real thing needs `corner-shape`, and a corner shape one engine falls back from would leave iOS and Android with different bars
- Do not give the gravity blob a colour of its own — it is `--on-glass-active`, THE selected-thing fill, shared with an action button's active state so the nav and the header say "this is the one you are on" the same way. It must stay a mix of two OPAQUE colours: any translucency shows up as the blob letting the page through, which is the one thing it must not do
- Do not put `--primary` on `--on-glass-active` — a 32% tint of a colour is the same hue at a similar lightness, which is exactly why the active action button read as barely selected. The label is `--on-glass-active-fg`, the primary pushed AWAY from the fill (lighter on dark, darker on light) so it still reads as the accent
- Do not close the flight card's `…` cascade on POINTERDOWN — the overlay unmounts mid-gesture and the click that follows lands on the card underneath, so dismissing it also opened the flight. Close on the lift and swallow the synthesised click at the capture phase
- Do not give a page its own copy of the calendar's wrapper — `CalendarPanel` is the one presentation, and the logbook and the dashboard both render it. They drifted into looking like two different calendars once already (radius, width, glass, dual month, and a duplicate month label in the dashboard's action bar)
- Do not derive the calendar's dual/single mode from a ResizeObserver on the page — read `usePanelDualMonth()`. A measurement lands a frame behind the resize, and in that frame the calendar renders the outgoing mode at the incoming width (the "flash" on the collapse)
- Do not scroll a dynamically-measured virtual list by asking the virtualizer where a row is — every offset it can give you is built from `estimateSize` for the rows it has never measured, so `scrollToIndex`/`getOffsetForIndex` are wrong by however far the estimate is off. `scrollToIndexSettled` scrolls roughly, then MEASURES the row in the DOM and corrects by the difference, which is exact
- Do not let the `…` cascade change the flight card's size, and do not drop `keepOpen` from the `…` action — the run is a PORTALLED overlay anchored to the `…` button's own box, and the swipe panel has to stay open beneath it or the buttons appear to come from nothing. A menu that grew the row would move every row below it
- Do not animate the gravity blob in the SIDEBAR — it is placed instantly there. The list's metrics re-measure as a route settles and as the panel morphs, and each re-measure was a chance for the spring to re-fire (the "flashes twice" report)
- Do not carry a flight's OOOI times, takeoffs/landings, signature, lock or import/sync stamps into a derived flight (`deriveFlight`) — those are the record of a specific flight having happened, and copying them forward fabricates a logbook entry
- Do not judge a virtual list's scroll convergence by `virtualizer.scrollOffset` — it is written by the scroll listener, so reading it in the same tick as `scrollToIndex` always says "unchanged" and the retry loop gives up after one pass
- Do not put a control taller than `h-9` inside a `GlassButtonGroup` — the group is `h-11` with `px-1`, and the glass CLIPS, so a 48px child had its icon cut off top and bottom (the dashboard's period filter) and made the group wider than it was tall, turning a single-button group into an oval (the alerts bell). `GlassGroupButton` is `h-9 w-9`; anything hand-rolled into a group has to match
- Do not size the floating controls or the desktop nav pill independently — they are one 44px family (`CONTROL_RADIUS` 22 = half the height, so a pill stays a stadium — the bottom bar follows the same rule at its own height, see `MOBILE_PILL_RADIUS`), the header row is `h-13` to match, and `--chrome-top` is derived from them. They were 56px, which read as oversized next to the platform's own chrome on the same iPad
- Do not print a four-digit year in the logbook's month label — in dual mode ("Jul – Aug 2026") the left action group grew far enough to reach the centred nav pill
- Do not bring back the three-panel month carousel. It measured its container height from a ref taken "at rest" that had never been taken on the first entry into dual mode, so the calendar collapsed to 8px, and its end-of-animation handler tested `dataset.animAnchor` against `data-anim-anchor=""` — the empty string, which is falsy — so it never recovered. A dual step moves the pair by TWO months, so there is nothing sliding across to animate
- Do not compensate the list's scroll when a floating panel OPENS or CLOSES — that push is the whole point of `overflow-anchor: none`. `absorbSpacerDelta` is only for the calendar changing SHAPE while already open, and that commit must also drop the spacer's transition, or an eased spacer drifts against the one-shot correction
- Do not inset `.GlassBlur` from the face or feather it outward — the fill must be even corner to corner, and `--glass-press` must stay imperative so a scroll's `pointercancel` doesn't kill the spotlight
