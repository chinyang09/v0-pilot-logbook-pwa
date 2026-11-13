import type { BottomNavTab } from "@/types/db/stores.types"

/** The fewest and the most tabs a bar carries. */
export const MIN_NAV_TABS = 2
export const MAX_NAV_TABS = 4

/** Every tab the app knows; anything else stored (a newer build's tab) is dropped here. */
const KNOWN: ReadonlySet<BottomNavTab> = new Set<BottomNavTab>([
  "dashboard",
  "logbook",
  "aircraft",
  "crew",
  "airports",
  "currencies",
  "settings",
  "account",
  "fdp",
  "discrepancies",
  "bin",
])

/** Who fills a slot when fewer than two tabs survive. */
const FILL: readonly BottomNavTab[] = ["dashboard", "logbook", "aircraft", "crew"]

/** Who takes a folded Roster tab's slot, so a bar chosen with one keeps its size. */
const ROSTER_SLOT: readonly BottomNavTab[] = ["aircraft", "crew", "airports", "currencies", "settings", "account", "dashboard", "logbook"]

/**
 * The pilot's chosen tabs as the bar draws them: TWO to FOUR, in their order,
 * none twice. A stored "roster" tab is folded into Logbook — the roster is the
 * logbook with its duties on, not a tab of its own. A bar is never left with
 * fewer than two (one tab is not a choice between places); past four the
 * extras are dropped.
 */
export function normaliseNavTabs(tabs: readonly BottomNavTab[] | null | undefined): BottomNavTab[] {
  const out: BottomNavTab[] = []
  let foldedRoster = false
  for (const tab of tabs ?? []) {
    const t = tab === "roster" ? "logbook" : tab
    if (KNOWN.has(t) && !out.includes(t)) out.push(t)
    else if (tab === "roster") foldedRoster = true
  }
  // A bar chosen when Roster was a tab keeps its size: the slot goes to the
  // first tab not already there (what it always did).
  if (foldedRoster) {
    const r = ROSTER_SLOT.find((t) => !out.includes(t))
    if (r && out.length < MAX_NAV_TABS) out.push(r)
  }
  for (const f of FILL) {
    if (out.length >= MIN_NAV_TABS) break
    if (!out.includes(f)) out.push(f)
  }
  return out.slice(0, MAX_NAV_TABS)
}
