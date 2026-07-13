# UI/UX Audit — OOOI Pilot Logbook PWA

Audit date: 2026-07-11 · Baseline: `main` @ `f9ce4a5` · `pnpm lint`: **0 errors, 54 warnings** (matches the documented advisory-warning cap)

Scope: UI bugs and errors, dead/duplicated code, performance, motion fluidity, and visual consistency ("whole and as one"). Findings are ranked by impact within each section.

## Implementation status (2026-07-11, same branch)

**Fixed** — lint after fixes: 0 errors, 52 warnings (baseline was 54; no new warnings):

- ✅ §3.1 Dead code deleted (10 files incl. `DutyPeriodCard`, which the audit missed; `ocr-models-preloader` turned out to be **used** in `app/layout.tsx` and was kept) + stale `globals.css` BorderGlow comment.
- ✅ §2.1 Roster page: grouping/sorting memoized, selected-day entries derived (stale/empty restored-day bug gone), `DutyEntryCard` memoized, `ChevronLeft` back button.
- ✅ §1.3/§2.2 One sync button: nav pill now renders the shared `SyncStatus` (theme tokens, pending badge, `ensureValidSession` re-auth path); the hardcoded-color `SyncIconButton` body is gone.
- ✅ §2.4/§4.3 Flight-list: dead props removed; card callbacks made stable (`useCallback` + flight-passing handlers) so the `memo` actually holds.
- ✅ §1.5 Overlay ladder: alert-dialog raised to `z-[80]` (above dialogs/pickers), picker scrims unified to `bg-black/50`; `button.tsx` destructive uses `text-destructive-foreground`; `holdDuration` doc comment corrected; CLAUDE.md Geist-Mono bullet replaced with Inter-only guidance.
- ✅ §1.5 One `PageLoading` for all four `loading.tsx` + the keep-alive Suspense fallback; one `EmptyState` adopted on currencies/discrepancies/roster/FDP/flight-list.
- ✅ §1.4 Semantic status tokens (`--status-valid/-warning/-critical/-error/-info`, light+dark) added and swept through the roster-family pages, `currency-card`, `discrepancy-card`, `quick-check-panel`, account success text, new-form hints. Favorite-star gold and duty-type categorical colors intentionally kept.
- ✅ §3.2 `GlassIconButton`/`GlassButtonGroup`/`GlassGroupButton` extracted and adopted on all 8 pages (geometry now pinned: 56px singles, 48px group buttons, one active style).
- ✅ §3.3 `lib/utils/date.ts` (`parseYMDLocal`, `formatYMD*`, `formatMinutesHM`) replacing the flight-list/logbook/FDP/dashboard/currency-card duplicates (quick-check's "16 Apr" day-first format deliberately kept).
- ✅ §1.1 (partial) + §5.3 `FilterChips` segmented control replaces the "Filter:" dropdowns on currencies/discrepancies; discrepancies KPI axes fixed (Errors/Warnings/Info/Resolved now sum to total); roster quick-access cards got `active:` press feedback.
- ✅ §5.1 (partial) The two overshoot beziers unified into one `OVERSHOOT_BEZIER` constant.

**Round 2 (same branch)** — the previously deferred items, all done. Lint: 0 errors, 53 warnings (still under the original 54 baseline; the +1 is the unavoidable `react-hooks/incompatible-library` on the new roster `useVirtualizer`, same as every other virtualized page):

- ✅ §1.2 Settings page fully on the shared system: `settings-row.tsx` gained `description` support and a blended-trigger `SelectRow`; every section (display, auto-fill, duty defaults, import defaults, appearance, navigation) now renders `FormSection` groups with `SettingsRow`/`ToggleRow`/`SelectRow`; the section list itself is a grouped card with inset `.row-divider`s; loading uses `PageLoading`.
- ✅ §1.2 Account page section chrome converted from `Card`+`CardHeader` to `FormSection` (Profile / Passkeys / Active Sessions) — inner flows untouched.
- ✅ §1.1 Roster date groups render as `FormSection` cards (uppercase date header) instead of `CardHeader`/`CardTitle` chrome.
- ✅ §4.1 Roster date list virtualized with `@tanstack/react-virtual` (one row per date group, scrolling in `PageContainer`'s main via `scrollMargin`; FastScroll drives `scrollToIndex`).
- ❌→↩️ §4.2 Glass `lite` was implemented, then **reverted by owner decision** — every glass control uses the full liquid-glass material. Instead, ALL header/detail controls were unified onto one reusable system in `components/ui/glass-icon-button.tsx`: `GlassIconButton` (56px icon), `GlassTextButton` (Edit/Cancel/Save), `GlassButtonGroup`+`GlassGroupButton` (48px grouped controls), and `GlassSearchButton` (moved to `components/ui/`) — adopted by every page header, the dashboard actions, the detail-panel actions, the desktop-layout back button, and the import/alerts triggers (previously off-size).
- ✅ §1.4 `fdp-timeline-chart.tsx` status classes (red/orange/yellow/green-500 thresholds) and `import-review-modal-v2.tsx` badges/hints swept to `--status-*` tokens (the light-only `bg-blue-100 text-blue-900` badge is now theme-safe `status-info`). Chart *categorical* hex palette (series colors) intentionally kept.
- ✅ §5.1 `lib/motion.ts` — SPRING / POP_SPRING / TAP_SPRING / OVERSHOOT_BEZIER / SETTLE_BEZIER / MORPH_EASE / LIST_ITEM_TRANSITION; adopted by `swipeable-card`, `nav-pill`, `glass-container`.
- ✅ §5.2 Currency and discrepancy lists animate enter/exit/reorder (`AnimatePresence` popLayout + layout) on filter changes and resolve/delete.
- ✅ (reported) **Logbook [+] dead on mobile** — root cause: the mobile detail overlay was gated on `searchParams.has("selected")`, i.e. on the `router.replace` URL round-trip, while desktop renders straight from state. Fix: `DetailPanelProvider` now tracks `selectionExplicit` (set by `setSelectedId`, memory-only) and the overlay opens for explicit selections immediately from state; the URL check remains for deep links/reloads, and sessionStorage-restored selections still don't auto-open (both paths verified in a Playwright mobile run). The [+] handler also gained a re-entrancy guard so repeat taps can't create multiple blank flights.
- ✅ (reported) **[+] dead on mobile for aircraft/airports/crew** — root cause: `KeepAlivePages.routeKeyFromPathname` collapsed EVERY sub-route to its first segment, so `/aircraft/new` (and `/crew/new`, `/airports/new`, and all `/aircraft/[reg]`-style detail deep links) matched a persistent page — KeepAlivePages kept showing the kept-alive list and never rendered `children`. The URL changed, the screen didn't. Desktop worked because `handleAddClick` renders the form into the detail panel without navigating. Fix: only exact top-level paths map to persistent route keys; sub-routes keep their own key and render normally. Verified on mobile via Playwright: all three [+] buttons now open their full-page New forms, keep-alive list survives the round trip, and the logbook [+] overlay flow still passes.
- ✅ (reported) **New-entity pages were still old-format on mobile** — the standalone `/aircraft/new`, `/airports/new`, and `/crew/[id]` routes rendered an embedded `Cancel | Title | Save` header bar instead of the app-wide floating glass actions. The new forms now register the same `GlassTextButton` Cancel/Save with `useRegisterMainActions` in standalone mode (and `useRegisterDetailActions` in panel mode); the crew `[id]` page shows glass Back+Edit (view) / Cancel+Save (edit). Embedded headers deleted.
- ✅ (reported) **Crew [+] on desktop opened in the main panel** — `handleAddCrew` always `router.push`ed `/crew/new`. It now mirrors aircraft/airports: on desktop (non-picker) it renders `CrewDetailPanel` in a new `isNew` create mode into the detail panel; saving selects the new crew member, cancelling restores the previous panel. All flows verified via Playwright (mobile: glass Cancel/Save present, no embedded `h1`; desktop: URL stays `/crew`, form renders in the detail panel).
- ✅ (reported) **Mobile→desktop resize mid-create showed the form in both panels** — the standalone `/aircraft/new`, `/airports/new`, `/crew/new` routes now redirect on a desktop viewport (non-picker) to their list page with `?new=1`; the list page strips the param and opens the create form in the detail panel only. Also guards: a `creatingRef` on each list page stops data-driven `syncDetailPanel` re-runs from clobbering an in-progress create form.
- ✅ (reported) **Mobile [+] slower than opening a card** — the list pages now `router.prefetch` their `/new` routes on mount, removing the RSC fetch from the tap path (a card opens from client state; the create page was paying a full route navigation).

---

---

## 1. Visual consistency — the app has two generations of UI

The strongest overall finding: the app's pages split into a **new design system** (glass headers, `FormSection`/`SettingsRow` grouped cards, inset `.row-divider`, `SwipeableCard`, OKLch theme tokens, gravity nav) and an **older generation** that predates it. The older pages are what make the app feel "not one thing."

### 1.1 Roster / Currencies / Discrepancies pages are the old generation

`app/(app)/roster/page.tsx`, `app/(app)/currencies/page.tsx`, `app/(app)/discrepancies/page.tsx` share a template that appears nowhere else:

- **Stat-card KPI grids** (`grid grid-cols-4 gap-2` of `Card`s with big colored numbers) — e.g. `currencies/page.tsx:92-117`, `discrepancies/page.tsx:70-95`, `roster/page.tsx:141-160`. No other page presents numbers this way (the dashboard uses its own widget system).
- **`Filter:` label + shadcn `Select` dropdown** (`currencies/page.tsx:120-134`, `discrepancies/page.tsx:98-117`) — the rest of the app expresses mode/filter switching as segmented glass/pill buttons (e.g. roster's own list/calendar toggle in the glass header). A dropdown labelled "Filter:" reads as an admin panel, not this app.
- **Raw Tailwind palette colors** (`text-green-500`, `text-yellow-500`, `text-orange-500`, `text-red-500`) instead of theme tokens — same value in light and dark themes, so light-mode contrast is untuned (the codebase already fixed this class of bug for scheduled-flight orange: `orange-600` light / `orange-400` dark, `flight-list.tsx:215`). ~26 files use raw palette colors; the heaviest are the roster-family pages and components (`currency-card.tsx` STATUS_CONFIG, `quick-check-panel.tsx`, `fdp-timeline-chart.tsx`, `roster-calendar.tsx:16-23` legend, `import-review-modal-v2.tsx`).
- **`Card`+`CardHeader`+`CardTitle` chrome** for grouped content instead of `FormSection`'s uppercase-header grouped card.

**Recommendation:** restyle these three pages onto the shared system: `FormSection` groups, segmented pill filters, and a semantic status color set (see §1.4). This is the single highest-leverage "make it whole" change.

### 1.2 Settings and Account pages ignore the shared settings system

The "Unified Settings/Form Layout" (`FormSection` + `SettingsRow`/`ToggleRow`/`ReadOnlyRow`, inset dividers, blended inputs) was built so flight/crew/aircraft detail pages look identical — but the two pages literally named "settings" don't use it:

- `app/(app)/settings/page.tsx` (494 lines): ad-hoc `p-4 space-y-4` sections, `Label` + fixed-width `Select`/`Input` (`w-[160px]`, `w-[100px]`), no row dividers, custom theme-picker tiles (`rounded-lg border-2`, line 124). Row rhythm (padding, font sizes, alignment) differs from every detail panel.
- `app/(app)/account/page.tsx` (982 lines): `Card className="py-4 gap-3"` + `CardHeader`/`CardTitle` sections with hand-rolled `flex justify-between` rows (`:560-580`), while its sessions/passkeys lists *do* use `SwipeableCard` — so the page mixes both generations internally.

**Recommendation:** migrate both pages' rows to `FormSection`/`SettingsRow`/`ToggleRow` (add a `SelectRow` variant to `settings-row.tsx` — several pages need label + select; build it once).

### 1.3 Two sync-status buttons with two color systems

- `components/sync-status.tsx` uses the theme's purpose-built tokens: `--status-synced/-pending/-offline` (tuned per theme in `globals.css:46-49, 85-88`). Used only in `airports/[icao]/page.tsx`.
- `SyncIconButton` in `components/nav-pill.tsx:115-148` — the one users actually see, in the pill/sidebar — hardcodes `text-emerald-400`, `text-orange-400`, `text-red-400/70`. These are dark-theme values; on the light theme emerald-400 on cream fails contrast. It also lacks the pending-count badge and the `ensureValidSession()` re-auth interception that `SyncStatus.handleSync` has (`sync-status.tsx:43-56`) — so a manual sync from the nav pill against a dead session silently no-ops into a 401 path instead of prompting re-auth. That's both an inconsistency and a real UX bug.

**Recommendation:** one component. Give `SyncStatus` a size/variant prop, use it inside the pill, delete `SyncIconButton`. Colors come from `--status-*`.

### 1.4 No semantic status palette

Valid/warning/critical/expired/error colors are re-invented per file (`currency-card.tsx:25-61` STATUS_CONFIG, quick-check red/green pairs at `quick-check-panel.tsx:343-359`, KPI cards, calendar legend). Meanwhile `globals.css` already demonstrates the right pattern with `--status-*` and `--chart-*`.

**Recommendation:** add `--status-valid / --status-warning / --status-critical / --status-error` (light+dark tuned) to `globals.css` + `@theme inline`, and sweep the roster family onto them. This kills most of the ~150 raw palette-color usages in one motion.

### 1.5 Smaller "looks different" items

| Item | Where | Inconsistency |
|---|---|---|
| Empty states | `flight-list.tsx:662-670` (bare div, `h-12` icon), `currencies/page.tsx:146-160` (Card, `h-10` icon + CTA), `fdp/page.tsx:366-374` (Card, `h-8` icon, `text-[10px]`) | Three layouts, three icon sizes, three type scales → build one `EmptyState` component |
| Route `loading.tsx` | logbook & airports return `null`; aircraft shows `h-8` spinner + "Loading aircraft…"; crew shows bare `h-6` spinner | Four different first-paint behaviors for sibling tabs |
| Overlay scrims | pickers `bg-black/60 z-[60]` (`time-picker.tsx:89`, `date-picker.tsx:123`), dialog `bg-black/50 z-[70]`, alert-dialog `bg-black/50 z-50`, swipe confirm `bg-black/45` | Standardize scrim opacity and fix the z ladder — `AlertDialog` (z-50) would render **under** an open date/time picker (z-60) |
| "← Back to Calendar" | `roster/page.tsx:243-245` | Literal `←` text arrow; everywhere else uses `ChevronLeft` icon buttons |
| `button.tsx:14` destructive variant | `text-white` | Should be `text-destructive-foreground` (token bypass; white is correct today but breaks if the destructive shade changes) |
| Glass header buttons | currencies/roster wrap buttons in `div px-1 h-14` with `h-12 w-12` buttons; discrepancies/fdp/aircraft use bare `h-14 w-14` buttons | Same control, two visible sizes across pages (see §3.2 for the extraction fix) |
| Discrepancies KPI cards | `discrepancies/page.tsx:70-95` | "Total / Errors / Warnings / Resolved" mixes axes — errors+warnings are unresolved-only and `info` severity is uncounted, so the numbers visibly don't add up |

The login page is intentionally its own visual world (cockpit Ken Burns, white glass) — fine to leave.

---

## 2. Bugs & errors

### 2.1 Roster page: broken memoization + stale selected-day state

`app/(app)/roster/page.tsx`:

- `entriesByDate` (`:41-50`) and `sortedDates` (`:52`) are computed inline with no `useMemo`, so `sortedDates` is a **new array identity every render** → the `fastScrollItems` `useMemo` (`:55-57`) and `handleFastScrollSelect` `useCallback` (`:61-76`) never cache. The memoization is inert. (This is also the kind of thing the react-hooks v6 advisory rules exist to catch — new code should be compiler-clean per CLAUDE.md.)
- `selectedDate` is persisted in `sessionStorage` via `useSessionState` (`:33`) but `selectedEntries` is plain `useState` (`:34`). After a reload (or session restore), `selectedDate` is restored while `selectedEntries` resets to `[]` → the page renders the selected-day view with a date header and **no entries and no list**, and the only escape is the "Back to Calendar" button. `selectedEntries` is also a stale snapshot — a sync/import that changes that day's duties won't update the open view. **Fix:** don't store entries at all; derive `entriesByDate[selectedDate] ?? []`.

### 2.2 Nav-pill sync button skips re-auth interception

Covered in §1.3 — `SyncIconButton` calls `triggerSync()` directly without `ensureValidSession()`, bypassing the documented resync-interception flow (CLAUDE.md: "a manual resync against a dead session now actually prompts re-auth"). The primary sync affordance in the app is the one that doesn't do this.

### 2.3 First visit to a keep-alive tab can flash blank

`components/keep-alive-pages.tsx:139` uses `<Suspense fallback={null}>` for the lazy page chunk, and logbook/airports `loading.tsx` also return `null`. On a slow connection the first tap on Logbook/Airports shows an empty pane with no signal. A minimal shared skeleton/spinner fallback (same one for all four tabs, per §1.5) fixes both.

### 2.4 Minor

- `components/swipeable-card.tsx:57-58` — doc comment says "Hold duration in ms (default 700)" but the actual default is **2500** (`:423`). Update the comment (or the default; 2.5s is on the long side for a row delete, and the account page's `HoldToConfirmButton` uses its own duration — worth deliberately picking one number app-wide).
- `components/flight-list.tsx` — props `aircraft`, `airports`, `showMonthHeaders`, `hideFilters` (`:50-57`) are accepted and never used; `logbook/page.tsx` still passes data into them. Dead API surface that obscures what the component actually needs.
- CLAUDE.md contradiction: "Things to Avoid" still says *"Do not drop the Geist Mono Google-Fonts `<link>`"* but the Fonts section (and `app/layout.tsx:54-57`, `globals.css:93-96`) says **Inter is the single typeface** and no Geist link exists. Stale bullet — someone following it would "restore" a font the design removed.
- `hooks/use-page-active.tsx` file-naming: hook files are specced as camelCase `.ts` in CLAUDE.md's naming table, but `hooks/` mixes `use-detail-panel.tsx`, `use-db.ts`, `useFlights.ts`-style names. Cosmetic; pick one (kebab-case is the de-facto winner).

---

## 3. Code reduction

### 3.1 Dead code — ~1,650 lines deletable today

Verified unreferenced (no imports anywhere in `app/`, `components/`, `hooks/`, `lib/`):

| File | Lines | Note |
|---|---|---|
| `components/roster/quick-check-dialog.tsx` | 387 | Near-duplicate of `quick-check-panel.tsx` (473-line diff is mostly chrome); panel won |
| `components/roster/import-review-modal.tsx` | 452 | Superseded by `import/import-review-modal-v2.tsx` |
| `components/searchable-page-header.tsx` | 159 | Superseded by glass header actions |
| `components/stats-dashboard.tsx` | 133 | Superseded by `components/dashboard/*` |
| `components/add-passkey-prompt.tsx` | 132 | Account page has its own passkey flow |
| `components/offline-indicator.tsx` | 85 | Sync status conveys offline now |
| `components/standard-page-header.tsx` | 68 | Superseded by glass header actions |
| `components/ui/tabs-pill.tsx` | 60 | Never wired up (ironically the segmented control §1.1 wants) |
| `components/ui/border-glow.tsx` | 58 | Superseded by `border-glide.tsx`; `globals.css:320` comment still references `<BorderGlow/>` |
| `components/ocr-models-preloader.tsx` | 42 | Not mounted anywhere |

Deleting these also removes the confusion of having two `ImportReviewModal`s and two quick-check components. (Update the stale `globals.css` comment when removing border-glow.)

### 3.2 Repeated glass-header action pattern

Every page builds the same block by hand:

```tsx
<GlassContainer cornerRadius={28}>
  <Button variant="ghost" size="icon" className="h-14 w-14" onClick={…}>
    <RefreshCw className={cn("h-5 w-5", isLoading && "animate-spin")} />
  </Button>
</GlassContainer>
```

…8+ times across logbook/aircraft/airports/crew/roster/currencies/discrepancies/fdp, with drifting internals (§1.5). Extract `GlassIconButton` (single action) and `GlassButtonGroup` (multi-action, the `px-1 h-14` + `h-12 w-12` variant) into `components/ui/`, and the per-page code shrinks to one line per action while pinning the geometry.

### 3.3 Duplicated date/time helpers

- `parseDateLocal` — full copies in `components/flight-list.tsx:79-104` and `app/(app)/logbook/page.tsx:36-59`.
- "format a YYYY-MM-DD as short date" — re-implemented in `quick-check-panel.tsx:34`, `duty-period-card.tsx:53`, `currency-card.tsx:75`, `dashboard/period-flights-card.tsx:18`, `dashboard/to-log-card.tsx:19`, `fdp/page.tsx:91`, `account/page.tsx:522` (7+ variants, some UTC-based, some local — a consistency risk, not just duplication).
- `formatMinutesHM` (`fdp/page.tsx:74`) vs `formatHoursHM` (`fdp-timeline-chart.tsx:306`) and similar.

Consolidate into `lib/utils/time.ts` / a new `lib/utils/date.ts`. The mixed local/UTC parsing here is the same class of hazard as the deferred FDP date-convention issue in CLAUDE.md — one canonical `parseYMD`/`formatYMD` pair prevents a future boundary bug.

### 3.4 Status color maps

See §1.4 — `STATUS_CONFIG`-style maps re-declared per component collapse into the semantic token set.

---

## 4. Performance

### 4.1 Roster list is the only unvirtualized long list

`roster/page.tsx:263-280` renders **every date card and every `DutyEntryCard`** for the whole imported history (a year of airline roster ≈ 300+ dates, 600+ entries) — plus the broken memoization from §2.1 recomputing group/sort every render. Logbook/aircraft/airports/crew all use `@tanstack/react-virtual`. For heavy users this makes Roster the jankiest tab (scroll + initial render + every sync-driven re-render).

**Recommendation:** virtualize the date list the same way as `flight-list.tsx` (the FastScroll rail already exists), or at minimum wrap the grouping/sorting in `useMemo` and wrap `DutyEntryCard` in `memo` (`CurrencyCard` and `DiscrepancyCard` are memoized; `DutyEntryCard` — the one rendered hundreds of times — is not). The `useMemo` fix alone is a 5-line change with immediate payoff.

### 4.2 Glass stack cost

Each `GlassContainer` renders **9 stacked `backdrop-filter` layers** (`globals.css:502-594` — edge, emboss, refraction, blur, 2 blends, highlight, contrast, brightness). A typical page shows 2–4 glass containers plus the nav pill; on mobile that's ~30-40 live backdrop-filter surfaces, the most GPU-expensive primitive in CSS. This is the design's signature, and `prefers-reduced-motion` already disables it — but consider:

- A `lite` prop on `GlassContainer` (blur + edge + highlight only, ~3 layers) for the small header buttons where the full material isn't perceptible at 56px;
- Profiling on a mid-range Android device — if the pill morph or page scroll drops frames, this is where the milliseconds are.

### 4.3 Broken `memo` on flight cards

`SwipeableFlightCard` is `memo`-ized, but `flight-list.tsx:757` passes `personnel={personnel}` — a prop the card **never uses** — whose array identity changes on every SWR revalidation, invalidating the memo for every visible card on every sync. Removing the prop makes the memo actually work during background syncs (the moment jank matters most, since sync coincides with user activity).

### 4.4 Minor

- `useViewportMeasure` (`nav-pill.tsx:444-463`) creates/appends/removes a probe `div` on every `resize` event — mobile browsers fire resize on URL-bar show/hide; keep a cached probe or read `env()` once + on orientation change only.
- `roster/page.tsx` `selectedEntries` in state forces a re-render pass that derivation would avoid (same fix as §2.1).
- Dashboard FDP module-level cache, event-driven `SyncStatus`, compositor-driven gravity blob, and `contain: strict` on the virtualized list are all in good shape — no action.

---

## 5. Motion / "fluid yet smooth" review

What's already right (keep): compositor-driven gravity indicator, overlapping per-property nav morph, spring-settled `SwipeableCard`, motion-value hold-to-confirm, `prefers-reduced-motion` handling in glass/ken-burns/gravity/morph.

Gaps that keep it from feeling like one motion system:

1. **No shared motion constants.** Durations/easings are scattered literals: `duration-150/200/300`, `0.16s`, `0.2s ease`, `cubic-bezier(0.34,1.5,0.64,1)` (gravity), `cubic-bezier(0.34,1.56,0.64,1)` (mobile pill re-show), `SPRING {520/42}` (swipe), `{700/24}` (pop), `{400/25}` (glass tap). Extract a `lib/motion.ts` (or CSS custom properties) with the app's canonical spring, overshoot bezier, and 3 durations — then everything animating uses the same physics vocabulary. The two near-identical overshoot beziers should be literally the same constant.
2. **Old-generation pages have no motion at all.** Roster/currencies/discrepancies cards appear/disappear with hard cuts (filter changes, deletes), while flight-list has a choreographed delete (fade+slide, rows glide up). Bringing `AnimatePresence`-style list transitions (or the flight-list delete pattern) to `CurrencyCard`/`DiscrepancyCard` swipes would make the roster family feel like the logbook.
3. **Touch feedback asymmetry:** glass containers scale on tap and sidebar items have `active:scale-[0.98]`, but the roster-family quick-access cards only have desktop `hover:` styles (`roster/page.tsx:166`) — no `active:` state, so on phones they feel inert. Add the same `active:scale`/color treatment.
4. **`SwipeableCard` ignores `useReducedMotion`** — springs and the confirm overlay animate regardless. Low priority (gesture-driven motion is exempt-ish), but the pop-in stagger could respect it cheaply.

---

## 6. Suggested execution order

1. **Delete dead code** (§3.1) — zero-risk, −1,650 lines, removes trap files (someone will eventually edit `quick-check-dialog.tsx` and wonder why nothing changes).
2. **Quick wins:** roster `useMemo`/derived-selection fix (§2.1), remove unused flight-list props + `personnel` memo fix (§4.3), unify sync button (§1.3/§2.2), scrim/z-index ladder (§1.5), CLAUDE.md Geist-Mono bullet (§2.4).
3. **Semantic status tokens** (§1.4) + sweep raw palette colors.
4. **Glass action button extraction** (§3.2) + date/time helper consolidation (§3.3).
5. **Restyle roster/currencies/discrepancies** onto FormSection + segmented filters (§1.1) and migrate settings/account rows (§1.2) — the big "whole and as one" payoff.
6. **Virtualize roster list** (§4.1), motion constants + list transitions (§5), glass `lite` profiling (§4.2).
