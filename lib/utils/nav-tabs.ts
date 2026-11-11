import type { BottomNavTab } from "@/types/db/stores.types"

/**
 * The pilot's chosen tabs with Roster folded into Logbook — the roster is the
 * logbook with its duties on, not a tab of its own. A stored "roster"
 * tab (it was the default third tab) gives its slot to the first tab not
 * already chosen, so four tabs stay four and none appears twice.
 */
const REPLACEMENTS: readonly BottomNavTab[] = [
  "aircraft",
  "crew",
  "airports",
  "currencies",
  "settings",
  "account",
  "dashboard",
  "logbook",
]

export function normaliseNavTabs(
  tabs: readonly BottomNavTab[]
): [BottomNavTab, BottomNavTab, BottomNavTab, BottomNavTab] {
  const out: BottomNavTab[] = []
  for (const tab of tabs) {
    const t = tab === "roster" ? "logbook" : tab
    if (!out.includes(t)) out.push(t)
  }
  for (const r of REPLACEMENTS) {
    if (out.length >= 4) break
    if (!out.includes(r)) out.push(r)
  }
  return out.slice(0, 4) as [BottomNavTab, BottomNavTab, BottomNavTab, BottomNavTab]
}
