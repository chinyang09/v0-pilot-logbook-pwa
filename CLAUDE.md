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
| `lib/utils/roster/__tests__/` | reconciler classification, repeated-route matching, import decisions + retention, report tracking, pilot-role rules, sim dedup, tracked fields, the accepted-comparison stamp |
| `lib/utils/parsers/__tests__/` | PDF row merge, crew-column wrapping, Flt-time/PIC bleed, logbook→sector mapping, aircraft type map, time-reference normalisation |
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

### The 90-Day Undo Window (`lib/utils/retention.ts`)

`RETENTION_MS` is defined **once** and shared by everything reversible-for-a-
while: import decisions, accepted comparisons, and the flight recycle bin.
Roughly three company report cycles — long enough to catch a mistake in a
quarterly review, short enough that what's retained stays a handful of rows.

**Clearing a retention stamp writes `null`, never `undefined`.**
`/api/sync/bulk` applies an update as a `$set` of the payload's keys and
`JSON.stringify` drops undefined ones, so `undefined` leaves the server's stamp
in place and the next pull undoes the undo — a restored flight drops straight
back in the bin. `isWithinRetention` and `isLiveFlight` therefore test `== null`.

### Recycle Bin (deleted flights)

`deleteFlight()` is a **soft delete**: it sets `FlightLog.deletedAt` and pushes
an **update**. That is what makes the bin work across devices — binning and
restoring both ride the ordinary sync path, and only
`purgeExpiredDeletedFlights()` (at 90 days) writes a tombstone.
`app/(app)/recycle-bin/page.tsx` sweeps on load, then lists what's left with the
days remaining; `permanentlyDeleteFlight()` is the explicit "now, not in three
months".

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

- **`ChromeFade`** — the floating-header treatment, identical to the main and
  detail panels in `desktop-layout.tsx`: a single background gradient (solid →
  60% → transparent), **no `backdrop-filter`**. Anchored to a fixed 64px tail so
  taller chrome keeps the same boundary instead of stretching the ramp until
  content shows through the title. If you change the panel header's gradient,
  change both.
- **`MODAL_SCRIM`** — `bg-black/15 dark:bg-black/50`. A flat `bg-black/50` is
  invisible over a dark app and turns the light theme (white panels, glass
  sidebar) into grey mush. Used by every dialog overlay, the nav sidebar
  backdrop and the date/time pickers.
- **`RadialBlurBackdrop`** — heaviest around the dialog, clearing toward the
  screen edges.

On a **translucent** surface (the glass sidebar) a painted scrim would flatten
the material — mask the content out instead.

### Destructive Actions: Countdown, not Hold

Press-and-hold is gone. Tapping a destructive action **arms** it: the row blurs
and a pill reads `Cancel delete 9` while the action counts down (10s default),
the border tracing the time remaining. Left alone it fires; the pill cancels it.

- The timer lives in **`lib/utils/pending-actions.ts`**, at module scope, NOT in
  the card. A virtualised list recycles rows as it scrolls, and an in-component
  timer meant scrolling away silently cancelled the deletion — with the user
  every reason to think it went through. `SwipeableCard` only renders the
  remaining time and offers the cancel; a remount resumes from the stored
  deadline.
- Pass a **data-derived `id`** to any `SwipeableCard` that can be armed. The
  `useId()` fallback changes on recycle and orphans the registry entry.
- The `swipe-card-close-others` handler must close the swipe **panel only**. It
  fires on any interaction with any other row, so clearing the pending confirm
  there made it impossible to arm a delete and move on.
- Tapping outside deliberately does NOT disarm.
- `HoldToConfirmButton` / `useHoldToConfirm` still exist but nothing
  destructive uses them.

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
- **Actions** (`SwipeAction[]`): rendered as **separate, rounded buttons** that
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

- **`components/ui/hold-to-confirm-button.tsx`** (`HoldToConfirmButton`) — the
  shared press-and-hold confirm control (used by the swipe confirm overlay and
  the account "Log out of all devices" button). Built on
  `hooks/use-hold-to-confirm.ts` (a `MotionValue` progress 0→1 via rAF). The fill
  is a soft red left→right gradient revealed by a CSS mask; an optional
  `HoldProgressBorder` draws the perimeter. Accepts an external `progress`
  MotionValue so a surrounding surface can advance in lock-step. `showBorder={false}`
  when the surrounding element owns the border (the swipe overlay puts the border
  on the card, not the pill).
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
  the active-tab/​item highlight blob (pill bar + bottom nav + sidebar). It moves
  via a **CSS `transform` transition** (compositor-driven), NOT a Framer/JS spring
  — Framer springs tick on the main thread and **hitch** when a heavy page
  (dashboard/FDP) mounts. Position uses a bouncy overshoot bezier; size settles a
  touch faster for a subtle stretch. Tab metrics are measured with a
  ResizeObserver in **content coordinates** (so it's correct inside the scrollable
  sidebar). Do **not** revert this to a Framer `animate()`/motion-value spring.
- **Nav morph** (`useMorphPhase` + `DesktopPillMorph`/`MobilePillMorph` +
  `morphTransition`) — the pill ↔ sidebar morph is a single `opening`/`closing`
  transition whose two geometry groups (**position+width** and **height**)
  **overlap** via per-property CSS `transition-delay` (no phase stall, no
  "stuck"). Order is deliberate and the leads are **asymmetric** (module consts
  `MORPH_DUR` / `MORPH_OPEN_LEAD` / `MORPH_CLOSE_LEAD`, picked per phase as
  `lead`):
  - **opening** (pill→sidebar) moves position+width first (delay 0), then grows
    height (delay `OPEN_LEAD`) — it slides into place then expands.
  - **closing** (sidebar→pill) collapses height first (delay 0), then moves
    position+width (delay `CLOSE_LEAD`, **near-full** so the sidebar collapses
    almost completely *before* it slides to the pill — owner feedback: they must
    not move at once).

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

  **Both morphs use this arrangement** — `DesktopPillMorph` AND
  `MobilePillMorph`. The mobile one used to lay the strip out as an ordinary
  flex row above the nav, so the scroll-under existed only on desktop; on a
  phone the list simply stopped at the icons. If you touch one, touch both.

  The mask is a plain ramp (`transparent 0 → black topInset`) and it goes on the
  **blob overlay too**. The gravity blob lives in its own non-scrolling layer
  (so its overshoot spring isn't clipped) and was therefore the one thing not
  masked — it stayed solid in a band where its own row had already dissolved,
  which is the state that gets reported as "I can see the blob but not the nav
  contents". The mask belongs on the OUTER element of that layer: the inner one
  is translated by `-scrollTop`, and a mask on it would scroll with the blob
  instead of staying put. The ramp also has no dead zone at the top — holding
  fully transparent for the first third made the band under the icons simply
  blank, which reads as the list stopping rather than running beneath.
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
  - **Drop-splat settle:** on release the lens descends onto the tab with a
    **no-overshoot ease** on position (never springs left/right) and **splats** —
    `jump()` to a squashed shape then `set()` to neutral so the underdamped
    springs rebound (a bird's-eye slime drop that "springs to shape"). A CSS
    `--settle` crossfade swaps the glass material for the grey blob; a timer
    (must outlast the springy rebound) hands off to the real blob invisibly.
    Do **not** put the settle back on a bouncy geometry spring (that was the
    left/right springing that got removed).

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
- `/logbook`, `/aircraft`, `/airports`, `/crew` — lazy-imported via `React.lazy()`, mounted on first visit, never unmounted
- All other pages (currencies, roster, etc.) unmount normally via Next.js `children`

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

**Provider hierarchy:**
```
AppLayout → ScrollNavbarProvider → SidebarProvider → DetailPanelProvider
  → AppShell → KeepAlivePages
    ├── /logbook, /aircraft, /airports, /crew (lazy, persistent)
    └── children (other routes, normal unmount)
```

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

### FDP / roster legality calculations (DEFERRED — needs domain review before changing)

A subsystem audit surfaced three issues in `lib/utils/roster/fdp-calculator.ts`.
These drive the **legality/limits dashboard**, so they are intentionally left
untouched until reviewed with the user — a wrong "fix" to regulatory math is
worse than the current behavior. Do **not** change these casually.

1. **Rolling-limit windows mix UTC and local date parsing** (`~:787`).
   `calculateRollingStats` parses duty dates with `new Date(dp.date +
   "T00:00:00")` (runtime-local TZ), but callers build the as-of date in UTC
   (`generateTimelineData ~:1080`, `simulateScenario ~:1560`,
   `simulateHypotheticalDuty ~:1354` all use `…T23:59:59Z`), while
   `forecastExceedances ~:928` uses local `…T23:59:59`. For a non-UTC user
   (the app targets SGT/UTC+8) a duty period on the inclusive/exclusive window
   boundary can be silently included or excluded. Fix is to settle on one date
   convention end-to-end.
2. **`includesLocalNight` ignores a past-midnight debrief** (`~:641-668`, called
   from `calculateRestPeriod ~:711`). The raw `previous.debriefTime` + un-wrapped
   `previous.date` are passed even when the prior duty crossed midnight, so the
   rest-window night test runs against the wrong day → wrong rest rule (3a vs 3b).
   `calculateRestPeriod` already wraps `prevDebriefAbsolute` for the rest-minutes
   math but not before this call.
3. **`mergeAdjacentDutyPeriods` drops the long-sector FDP adjustment**
   (`~:499-503`). The merged-duty max-FDP recompute omits `longestSectorMinutes`
   (the `DutyPeriod` type doesn't even carry it), so `applyLongSectorAdjustment`
   never runs on a merged overnight duty — an over-long merged duty can read as
   compliant.

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

The **one** legitimate exception is `components/pwa-install-prompt.tsx`. Adding
to the home screen is a genuinely different flow per OS (iOS: Share → Add to
Home Screen; Android: browser menu → Install app, via `beforeinstallprompt`),
so it detects the platform to show the right instructions. That is a difference
in the OS, not in the app's look — do not "unify" it, or iOS users lose the
only path to installing.

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
  - **`--glass-face-blur` is one blur, not three.** The old stack blurred
    2px + 2.4px + 0.52px on three elements; sequential Gaussians compose as
    the root-sum-square, so 3.2px is identical optics for a third of the work.
  - **Even face:** `.GlassBlur` spans the WHOLE face, corner to corner. It used
    to be inset by the ring widths, leaving the perimeter a shade darker than
    the middle — the material read as a grey slab inside a darker frame instead
    of one even fill (iOS Control Center controls are uniform edge to edge). Do
    not reintroduce the inset, and do not feather the face outward either —
    that pulls the tone DOWN at the edges, which is the opposite problem.
  - **Morph surge:** `data-morphing` on the container drives a heavier
    `.GlassBlur` backdrop-filter in CSS, so the material swells as the pill and
    sidebar merge and settles when it lands. Compositor-friendly — it is one
    filter value changing, not a filter graph being rebuilt.
  - **Press glow survives a scroll:** `--glass-press` is set **imperatively**
    on pointer down/up, not through framer's `whileTap`. A native scroll inside
    the surface (the sidebar list) steals the pointer and fires
    `pointercancel`, which ends a tap gesture — so the glow died the instant
    you started scrolling with your finger still on the glass. `pointercancel`
    now only drops the bloom/pull (scaling a scrolling surface janks) and
    `touchmove` keeps feeding the spotlight position until the real lift. The
    fade lives on `.GlassContent::after`'s `transition`.

**Report Import:**
- `lib/utils/roster/reconciler.ts` — classification + the global match assignment
- `lib/utils/roster/match-assign.ts` — cost-ranked pairing shared with cross-hydrate
- `lib/utils/roster/classification.ts` — SAFE / CRITICAL / `TRACKED_FIELDS`
- `lib/utils/roster/executor.ts` — applies a confirmed plan (flights, sims, aircraft, discrepancies)
- `lib/utils/roster/import-decisions.ts` — decision memory, on the shared window
- `lib/utils/roster/report-tracking.ts` — per-source "generated on" watermarks
- `lib/utils/roster/sim-sessions.ts` — structural simulator recognition/dedup
- `lib/utils/parsers/cross-hydrate.ts` — merge a logbook plan with a schedule plan
- `components/import/import-review-modal-v2.tsx` — the consent surface
- `components/flight-card-body.tsx` — the one flight-card definition
- `lib/utils/retention.ts` — the single 90-day undo window (decisions, accepted comparisons, recycle bin)
- `lib/db/stores/user/flights.store.ts` — soft delete / restore / purge + `isLiveFlight`

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
- Do not add a test framework without discussion — none exists currently
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
- Do not reintroduce per-file registration normalizers — use the canonical `normalizeRegistration` in `lib/utils/string.ts` on both client and server
- Do not re-add a bulk CDN aircraft download — the aircraft DB is populated from FR24, custom entries, and the MongoDB enriched pool only
- Do not remove `"use client"` directives — server/client boundary is intentionally designed
- Do not commit `.env` files or MongoDB credentials
- Do not use `npm install` or `npm add` — always use `pnpm` to keep `pnpm-lock.yaml` in sync (Vercel uses frozen-lockfile)
- Do not expose FR24 as the data source in UI — the user explicitly requires online lookups to be transparent (no "Online Results" labels, no Globe icons, no "FlightRadar24" branding)
- Do not add hexdb.io fallback for aircraft lookup — if FR24 fails, manual entry is the only option
- Do not bypass `recalculateFlightFields()` `manualOverrides` — users' manually entered field values must never be overwritten by enrichment
- Do not add pages to `PERSISTENT_PAGES` in `keep-alive-pages.tsx` without considering memory impact — only heavy virtualized pages should be persistent
- Do not use `display:none` for hiding keep-alive pages — `visibility:hidden` is required to preserve scroll positions and virtualizer measurements
- Do not re-add swipe "full-swipe to auto-trigger the primary action" to `SwipeableCard` — it was intentionally removed; actions fire only on button tap
- Do not bring back press-and-hold for destructive actions. A `holdToConfirm` action ARMS a countdown that only its own Cancel button stops — tapping outside must not disarm, and the `swipe-card-close-others` handler must close the swipe panel only (it fires on any interaction with any other row, so clearing the pending confirm there makes it impossible to arm a delete and move on)
- Do not move the armed-action timer back inside `SwipeableCard` — it lives in `lib/utils/pending-actions.ts` because a virtualised list recycles rows, and an in-component timer meant scrolling away silently cancelled the deletion. And always pass a **data-derived `id`** to a card that can be armed; the `useId()` fallback changes on recycle and orphans the registry entry
- Do not animate the gravity nav indicator with a Framer/JS spring — it must use a CSS `transform` transition (compositor) or it hitches when a heavy page mounts. For the nav morph, keep the overlapping per-property delays (`morphTransition`) with the **asymmetric** open/close leads (closing collapses height almost fully before it moves — do not make it symmetric or simultaneous), and keep the phase advancing on **both** the fallback timer **and** the *delayed* property's `transitionEnd` (keyed to `propertyName` so the delayed group is never cut). The **pill** content stays hidden until settled (it squishes mid-morph), but the **sidebar** content is intentionally visible + interactive for the whole open span with its opacity timed to the height (reveal + growth = one motion) — do not gate it back on the settled phase (drops taps) or fade it on its own timeline (reads as two motions)
- Do not add a rule, material or layout that only one engine gets — iOS and Android must render the app identically. In particular do not reintroduce `@supports (-webkit-touch-callout: none)`, the WebKit-only sniff: it silently made Android's date fields shorter and its focused fields slower to take a tap. A vendor-prefixed property paired with the standard one, or inert elsewhere, is fine. The sole exception is the PWA install prompt, where the OS flow itself differs
- Do not add a second full-face `backdrop-filter` to the glass — `.GlassBlur` carries the only one, as a single filter *list*. Six of them stacked on separate elements is what made the nav pill warm-and-dark on iOS and flat grey on Android: Blink composes the chain, WebKit doesn't, and neither is wrong. Anything the material needs goes into that one list (and the rim layers stay masked to the edge band)
- Do not reintroduce an SVG-displacement glass lens (`backdrop-filter: url(#…)`), or any other material that only one engine gets. It was removed on purpose: an SVG backdrop-filter re-rasterises every frame the element resizes or scales, every surface had to raster and PNG-encode megapixel maps on the main thread behind a cache/debounce/stand-in, and Android ended up looking unlike iOS. The owner's verdict was that it made the PWA feel laggy rather than crisp. One ring material, every platform — if the rim needs more presence, change the ring stack
- Do not delete a flight outright — `deleteFlight` is a **soft delete** into the 90-day recycle bin and pushes an UPDATE; only `purgeExpiredDeletedFlights` writes a tombstone. Push a delete when the user merely binned it and the flight is gone on every device with nothing to restore
- Do not read `userDb.flights` for a list, a total or an import match without `isLiveFlight` — a binned flight reaching the reconciler silently updates, and so resurrects, a flight the user deleted
- Do not clear a retention stamp (`deletedAt`, `acceptedAt`) by setting it `undefined` — `/api/sync/bulk` `$set`s only the keys the payload carries and `JSON.stringify` drops undefined ones, so the server's stamp survives and the next pull undoes the undo. Write `null` and test with `== null`
- Do not rebuild `normalizeFlightFromServer` as an explicit field allowlist — it must spread the server record first, or every field added since it was written is dropped on the way back down (that is how `entryType`/`isSimulator` were being lost)
- Do not put the drag-lens (`.PillDragLens`) release settle back on a bouncy geometry spring — position eases in with **no overshoot** (never springs left/right); the "spring to shape" is the underdamped `SQUISH_SPRING` squash-and-stretch (drop-splat). Keep it clamped to the tab strip (edge overshoot → the liquid bounce), keep the transform imperative (constant className so drag re-renders can't strip it), and keep the handoff timer longer than the springy rebound (or the last wobble is cut)
- Do not re-gate the dashboard rings / FDP chart behind a deferred-animation flag — the blob is compositor-driven now, so the charts can animate freely
- Do not reintroduce a second typeface — Inter is the single app font (`--font-sans` and `--font-mono` both resolve to Inter); use `tabular-nums` for aligned numbers, never a `font-mono` class or a new Google-Fonts `<link>`
- Do not give `register/complete`, `add-passkey`, the callsign change, or the TOTP-reveal routes a path that skips `verifyAuthenticationResponse`/`verifyStepUpAssertion` — the TOTP seed must never be revealed without a fresh passkey step-up
- Do not give `SwipeableCard` action panels horizontal padding — the panel must collapse to 0 width when closed (the left gap comes from `openWidth`/`justify-end`), otherwise a sliver of the action button peeks at the card edge
- Do not put row dividers as a full-width `border-b` — use the inset `.row-divider` class so the line aligns with the `px-4` text
- Do not give inline form inputs a visible box — keep `border-0 bg-transparent dark:bg-transparent shadow-none rounded-none` so they blend with the row (and `md:text-base` so the font doesn't shrink in edit mode)
- Do not hardcode `orange-400` for scheduled flight cards — light and dark themes use separate colors (`orange-600` light / `orange-400` dark) for contrast

**Report import:**
- Do not match an imported sector to a flight by "first unclaimed on this route" — pairing is decided globally in `match-assign.ts` with time as part of the key. The crew logbook report has no flight-number column, so on a repeated-route day the greedy version pairs every leg with the wrong one (see `repeat-route-day.test.ts`)
- Do not reclassify the company's OOOI/scheduled/block times as CRITICAL — they are the record of when the aircraft moved and apply without asking. Conversely do not make `pilotFlying`/`pilotRole`/day-night TO-LDG safe: they are the pilot's own account, and every difference is kept as a `Discrepancy` for the licence record
- Do not skip `detectEditReasons` before classification — it is what protects a signed/remarked/manually-overridden flight regardless of which fields changed
- Do not dedupe simulator sessions on `date|simSessionCode` alone — recognition must stay structural (no route, no registration), or sims written by an older build duplicate on every import
- Do not read `FlightLog.entryType` directly — go through `getEntryType()`, and write through `entryTypePatch()` so the legacy `isSimulator` flag stays in step for the dashboard and FDP pipeline
- Do not let a simulator's duration reach `blockTime` — it belongs in `simulatedInstrumentTime`, which is what keeps sims out of flight-hour totals

**Formatting & chrome:**
- Do not format a clock time with `formatHHMMDisplay` — that is for durations (which always keep their colon). Points in time go through `formatClockDisplay` so `clockSeparator` governs them all
- Do not use a flat `bg-black/50` for a modal overlay — use `MODAL_SCRIM`; black at 50% is invisible over a dark app and turns the light theme into grey mush
- Do not add the sidebar's floating-strip treatment to only one morph — `DesktopPillMorph` and `MobilePillMorph` must both float the toggle/sync strip over the nav with `topInset`, or the scroll-under silently works on desktop and not on a phone. And keep the dissolve mask on the blob overlay as well as the nav (on the OUTER, untranslated element), or the blob stays solid in a band where its own row has faded out
- Do not give `ChromeFade` a `backdrop-filter` — it is the main panel's plain gradient, deliberately. And do not paint a `--background` scrim over a translucent glass surface (the sidebar) — mask the content out instead
- Do not inset `.GlassBlur` from the face or feather it outward — the fill must be even corner to corner, and `--glass-press` must stay imperative so a scroll's `pointercancel` doesn't kill the spotlight
