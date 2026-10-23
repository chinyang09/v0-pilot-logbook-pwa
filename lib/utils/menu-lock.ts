"use client"

import { useSyncExternalStore } from "react"

/**
 * Is a press-and-hold menu currently open?
 *
 * The menu already stops the app being OPERATED by cutting `pointerdown` at
 * the capture phase (see `components/flight-quick-actions.tsx`), and on paper
 * that is enough: framer-motion binds its drag on pointerdown, so an event it
 * never receives cannot start one.
 *
 * On paper. In practice a card still moved a little on iOS while the menu was
 * up, and chasing that through WebKit's touch→pointer emulation is guesswork —
 * Chromium cannot reproduce it, so any fix aimed at a specific delivery path
 * would be unverifiable. This is the answer that does not depend on the path:
 * while a menu is open `SwipeableCard` passes `drag={false}`, which makes
 * framer tear the gesture down and unbind its listeners entirely. There is
 * then no session for any engine to feed, whatever it chooses to deliver.
 *
 * A module store rather than context because the two live in different trees
 * (the menu is portalled to `document.body`; the cards are in the list), and
 * because `useSyncExternalStore` gives the cards the new value in the same
 * commit the menu opens rather than a frame later.
 */
// A COUNT, not a flag: two menus can overlap for a commit (one closing as the
// other opens), and with a flag whichever cleanup ran last decided the answer
// — the closing one could unlock the rows under the one still open.
let holders = 0
let open = false
const listeners = new Set<() => void>()

/** Take (`true`) or release (`false`) one hold on the lock. Pair every take with a release. */
export function setMenuOpen(next: boolean): void {
  holders = Math.max(0, holders + (next ? 1 : -1))
  const now = holders > 0
  if (now === open) return
  open = now
  listeners.forEach((l) => l())
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Server snapshot is `false` — a menu only ever opens from an interaction. */
export function useMenuOpen(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => open,
    () => false
  )
}
