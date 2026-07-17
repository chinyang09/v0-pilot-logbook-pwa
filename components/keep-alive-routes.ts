/**
 * The single registry of keep-alive (persistent) routes.
 *
 * `keep-alive-pages.tsx` (which pages stay mounted) and
 * `use-detail-panel.tsx` (which routes re-sync their own detail content on
 * activation) both derive from this map — previously they kept two parallel
 * hand-maintained lists, and they had already drifted (dashboard and roster
 * joined the keep-alive set without joining the detail-panel list).
 *
 * `hasDetailPanel`: true when the page populates the split-view detail panel
 * itself (via its `usePageActive` → syncDetailPanel callback). Navigating
 * between two such routes must NOT clear `detailContent` (the activated page
 * re-sets it — clearing would flash). Routes without a detail panel must
 * clear it, or they'd show the previous route's stale panel.
 */
export const KEEPALIVE_ROUTES = {
  "/": { hasDetailPanel: false },
  "/logbook": { hasDetailPanel: true },
  "/aircraft": { hasDetailPanel: true },
  "/airports": { hasDetailPanel: true },
  "/crew": { hasDetailPanel: true },
  "/roster": { hasDetailPanel: false },
} as const

export type KeepAliveRouteKey = keyof typeof KEEPALIVE_ROUTES

export const KEEPALIVE_ROUTE_KEYS = Object.keys(KEEPALIVE_ROUTES) as KeepAliveRouteKey[]

/** Keep-alive routes that own detail-panel content (see above). */
export const KEEPALIVE_DETAIL_ROUTES: string[] = KEEPALIVE_ROUTE_KEYS.filter(
  (key) => KEEPALIVE_ROUTES[key].hasDetailPanel,
)
