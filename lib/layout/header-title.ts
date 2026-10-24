/**
 * The page and detail titles that have scrolled under the header.
 *
 * A panel names itself with a large title at the top of its scroller
 * (`PageContainer`'s `title`, `DetailFormPanel`'s heading). Scrolled away it
 * was gone, so a reader halfway down Settings was back to not knowing where
 * they were. The native answer is the collapsing title: once the large one
 * passes under the bar, a small copy appears IN the bar.
 *
 * The large title lives inside a page and the bar lives in the shell, outside
 * every page's tree, so the two meet here: a module store the panel writes and
 * the header reads through `useSyncExternalStore` (the same shape as
 * `useDBReady` / `useIsDesktop`). Only the header's title cell subscribes, and
 * a panel writes only when its title crosses the bar, so scrolling costs a
 * comparison per event and nothing re-renders.
 *
 * Keyed by slot: the MAIN panel's entry by the page's pathname (keep-alive
 * pages stay mounted behind the active one, each holding its own entry, and
 * the header reads the one for the route on screen), the DETAIL panel's by
 * the single key `"detail"` (there is only ever one).
 */

import { useSyncExternalStore } from "react"

export interface HeaderTitleEntry {
  title: string
  /** The large title has scrolled under the bar, so the bar carries it. */
  collapsed: boolean
  /** Whoever wrote it — a panel clears only its own entry on unmount. */
  owner: symbol
}

export const DETAIL_TITLE_KEY = "detail"

const entries = new Map<string, HeaderTitleEntry>()
const listeners = new Set<() => void>()

function emit() {
  for (const l of listeners) l()
}

export function setHeaderTitle(key: string, entry: HeaderTitleEntry) {
  const prev = entries.get(key)
  if (prev && prev.title === entry.title && prev.collapsed === entry.collapsed && prev.owner === entry.owner) return
  entries.set(key, entry)
  emit()
}

export function clearHeaderTitle(key: string, owner: symbol) {
  if (entries.get(key)?.owner !== owner) return
  entries.delete(key)
  emit()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** The entry for a key — the SAME object until it changes, as the store requires. */
export function useHeaderTitle(key: string): HeaderTitleEntry | null {
  return useSyncExternalStore(
    subscribe,
    () => entries.get(key) ?? null,
    () => null
  )
}
