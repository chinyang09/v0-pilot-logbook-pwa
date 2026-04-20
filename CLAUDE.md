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
| Forms | React Hook Form + Zod validation |
| OCR | @gutenye/ocr-browser with ONNX Runtime |
| Charts | Recharts |
| Package Manager | pnpm (not npm) |
| Bundler | Webpack (not Turbopack) |

## Commands

```bash
pnpm dev          # Start dev server (Next.js with Webpack)
pnpm build        # Production build (8GB heap for OCR models)
pnpm lint         # Run ESLint
pnpm start        # Run production server
pnpm install      # Install dependencies (MUST use pnpm, not npm)
```

**Important:** This project uses **pnpm** as its package manager. Vercel deploys with `frozen-lockfile`, so the `pnpm-lock.yaml` must stay in sync with `package.json`. **Never use `npm install`** to add dependencies — always use `pnpm add <package>` (or `pnpm add -D <package>` for dev deps). Using npm will only update `package-lock.json` and the Vercel build will fail.

There is no test framework configured. No Jest, Vitest, or Playwright.

## Project Structure

```
app/                              # Next.js App Router
├── layout.tsx                    # Root layout (PWA setup, providers)
├── globals.css                   # Tailwind global styles
├── api/                          # API routes
│   ├── auth/                     #   Registration, login, passkey, session
│   ├── sync/                     #   Bulk sync, per-collection sync, TTL setup
│   ├── flights/                  #   Flight CRUD
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
    ├── discrepancies/            #   Schedule conflicts
    ├── fdp/                      #   Flight Duty Period tracking
    └── data/                     #   Data management

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
├── aircraft-preloader.tsx        # Background aircraft DB preloader
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
│       └── reference/            #     Reference data stores
│           ├── aircraft.store.ts #       CDN aircraft DB (615k records)
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
    ├── night-time.ts             #   Night time rules
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
├── models/                       # OCR ONNX models (~16MB)
└── workers/                      # Web workers (aircraft DB decompression)
```

## Architecture

### Offline-First with Dual Database

All user data is stored locally in **IndexedDB via Dexie** and synced to **MongoDB** when online. This means:

- Data hooks read from Dexie first, not the server
- Mutations write to Dexie and enqueue a sync item
- The sync engine batches and pushes changes to MongoDB
- Server timestamps win on conflicts (last-write-wins)
- Tombstone records track deletions to prevent re-syncing

### Sync Triggers

Sync runs automatically on: app focus, network online, debounced data changes (2-5s), manual trigger, and pre-logout.

### Authentication Flow

1. **Registration**: Create callsign → WebAuthn challenge → Register passkey → Setup TOTP
2. **Login**: WebAuthn challenge → Passkey verification → Optional TOTP → Session cookie
3. **Silent reauth**: On page load, checks session → if expired, attempts passkey silent auth

Sessions are stored in MongoDB (with TTL) and mirrored to IndexedDB. Cookies are HttpOnly + Secure + SameSite=Lax.

### Shared Reference Data System

Aircraft and airport reference data is managed through a multi-tier lookup and enrichment pipeline:

**Data Sources:**
- **CDN Aircraft Database** (~615k records): Loaded from `chinyang09/Aircraft-Database` via gzip-compressed chunks, decompressed in a web worker, stored in IndexedDB (`referenceDb.aircraftDatabase`)
- **Airport Database**: Loaded from `public/airports.min.json` into IndexedDB
- **ICAO DOC 8643 Aircraft Types**: Loaded from `public/aircraft-types.json` with memory + IndexedDB two-level caching
- **FR24 APIs** (live): Aircraft search via `/v1/search/web/find`, airport lookup via `/airports/traffic-stats/`
- **Server Enrichment DB** (MongoDB): User-submitted aircraft/airports enriched and shared across users

**Lookup Chain (aircraft):**
1. Local IndexedDB (`referenceDb.aircraftDatabase`) — includes CDN + FR24 + custom records in one unified table
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
- `normalizeReg(reg)` — strips dashes, uppercases for consistent matching
- `recalculateFlightFields()` — respects `manualOverrides`, won't overwrite user's manual entries

### Component Architecture

- Root layout is server-rendered; app content uses `"use client"`
- Context providers: Auth, Sync, Theme (root level), ScrollNavbar (app level)
- `KeepAlivePages` wraps page content in `app/(app)/layout.tsx`, keeping heavy list pages mounted across navigations (see below)
- Desktop uses split-panel layout (sidebar + detail panel via `react-resizable-panels`)
- Mobile uses bottom navbar with swipeable interactions
- Responsive switching via `useIsDesktop()` hook

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
- `DetailPanelProvider` tracks `KEEPALIVE_ROUTES` — does NOT clear `detailContent` when navigating between two keep-alive routes
- Each persistent page re-syncs its detail panel via its `usePageActive` callback (`syncDetailPanel`)
- Selections stored in `sessionStorage` for restoration across full page reloads

**Provider hierarchy:**
```
AppLayout → ScrollNavbarProvider → SidebarProvider → DetailPanelProvider
  → AppShell → KeepAlivePages
    ├── /logbook, /aircraft, /airports, /crew (lazy, persistent)
    └── children (other routes, normal unmount)
```

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

Forms use React Hook Form with Zod schemas for runtime validation. Schemas are defined separately from TypeScript types.

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
| `/api/enrichment/batch` | GET | CRON_SECRET | Background enrichment of pending submissions |
| `/api/timezone?lat=&lng=` | GET | No | Coordinate → IANA timezone via geo-tz |

### Console Logging

Debug logs use prefixed format: `[v0]`, `[Auth]`, `[SW]`, `[UserDB]`, `[Sync]`, etc.

## Configuration Notes

- **Webpack** is used explicitly (`--webpack` flag), not Turbopack
- **TypeScript build errors are ignored** (`ignoreBuildErrors: true` in next.config.mjs)
- **8GB heap** allocated for builds due to OCR model processing
- **shadcn/ui** uses the New York style with CSS variables and RSC support
- **Tailwind CSS v4** via `@tailwindcss/postcss` PostCSS plugin
- **Dark mode** is class-based via `next-themes`

## Environment Variables

- `MONGODB_URI` — MongoDB connection string (required)

## PWA Details

- **Service worker** (`public/sw.js`): precaches static assets, login page, and OCR models; runtime caches app routes and CDN resources; versioned caches (v4)
- **Manifest** (`public/manifest.json`): standalone display mode, window controls overlay for desktop
- **Offline fallback**: full offline operation with cached data; `offline.html` as last resort
- **OCR models** (~16MB): cached by service worker after first load

## Database Schema

### User Database (Dexie — `userDb`)

| Table | Purpose | Key Indexes |
|---|---|---|
| `flights` | Flight log entries | id, date, syncStatus, aircraftReg, userId |
| `aircraft` | Aircraft records | id, registration, type, userId |
| `personnel` | Crew members | id, name, userId, crewId |
| `preferences` | User settings | key |
| `syncQueue` | Pending sync items | id, collection, timestamp |
| `syncMeta` | Sync metadata | key |
| `userSession` | Local session mirror | id |
| `scheduleEntries` | Roster schedule | id, date, dutyType |
| `currencies` | Certificate tracking | id, code, expiryDate, syncStatus |
| `discrepancies` | Schedule conflicts | id, type, resolved |

### Reference Database (Dexie — `referenceDb`)

| Table | Purpose | Key Indexes |
|---|---|---|
| `airports` | Airport reference data (~10k) | icao, iata, [icao+iata] |
| `aircraftDatabase` | Unified aircraft DB (~615k CDN + FR24 + custom) | icao24, registration |
| `aircraftTypes` | ICAO DOC 8643 type designators | designator |
| `metadata` | Version tracking for cache invalidation | key |

### MongoDB Collections (server-side)

| Collection | Purpose |
|---|---|
| `aircraftSubmissions` | User-submitted aircraft with enrichment status (pending/enriched/failed) |
| `airportSubmissions` | User-submitted airports with enrichment status |
| `sessions` | User sessions with TTL |
| `flights`, `aircraft`, `personnel`, etc. | Synced user data collections |

## Critical Files

When making changes, be aware of these high-impact files:

**Core Infrastructure:**
- `app/layout.tsx` — Root layout, provider hierarchy, PWA preloaders
- `app/(app)/layout.tsx` — Authenticated app layout, responsive nav
- `lib/db/user-db.ts` — Dexie user database schema (schema changes affect migrations)
- `lib/sync/sync-service.ts` — Core sync logic (changes affect data integrity)
- `components/providers/auth-provider.tsx` — Auth context, login/logout flows
- `components/providers/sync-provider.tsx` — Sync initialization
- `public/sw.js` — Service worker caching strategies
- `lib/mongodb/client.ts` — MongoDB connection pool (shared across API routes)

**Navigation & Keep-Alive:**
- `components/keep-alive-pages.tsx` — Persistent page shell (changes affect all four main pages)
- `hooks/use-page-active.tsx` — Active route context and `usePageActive` hook
- `hooks/use-detail-panel.tsx` — Detail panel provider (keep-alive route awareness)
- `components/desktop-layout.tsx` — Responsive app shell (sidebar + detail panel)

**Reference Data System:**
- `lib/db/reference-db.ts` — Dexie reference database schema (airports, aircraft, types)
- `lib/db/stores/reference/aircraft.store.ts` — CDN aircraft DB loader (615k records, web worker decompression)
- `lib/db/stores/reference/airports.store.ts` — Airport reference data, favorites, timezone utilities
- `lib/db/stores/reference/aircraft-types.store.ts` — ICAO DOC 8643 type designator lookup
- `lib/submissions/submit.ts` — Fire-and-forget client→server submission with flight reconciliation
- `lib/utils/aircraft-type-utils.ts` — ICAO type code parsing (description → category/engines)
- `components/aircraft-new-form.tsx` — Aircraft creation form with FR24 auto-populate
- `components/airport-new-form.tsx` — Airport creation form with FR24 auto-populate
- `components/aircraft-preloader.tsx` — Background aircraft DB initializer (in root layout)

## Things to Avoid

- Do not introduce Turbopack — the project explicitly uses Webpack due to OCR/ONNX compatibility
- Do not add a test framework without discussion — none exists currently
- Do not modify the Dexie schema without considering IndexedDB migration implications
- Do not change sync conflict resolution strategy without understanding the tombstone system
- Do not remove `"use client"` directives — server/client boundary is intentionally designed
- Do not commit `.env` files or MongoDB credentials
- Do not use `npm install` or `npm add` — always use `pnpm` to keep `pnpm-lock.yaml` in sync (Vercel uses frozen-lockfile)
- Do not expose FR24 as the data source in UI — the user explicitly requires online lookups to be transparent (no "Online Results" labels, no Globe icons, no "FlightRadar24" branding)
- Do not add hexdb.io fallback for aircraft lookup — if FR24 fails, manual entry is the only option
- Do not bypass `recalculateFlightFields()` `manualOverrides` — users' manually entered field values must never be overwritten by enrichment
- Do not add pages to `PERSISTENT_PAGES` in `keep-alive-pages.tsx` without considering memory impact — only heavy virtualized pages should be persistent
- Do not use `display:none` for hiding keep-alive pages — `visibility:hidden` is required to preserve scroll positions and virtualizer measurements
