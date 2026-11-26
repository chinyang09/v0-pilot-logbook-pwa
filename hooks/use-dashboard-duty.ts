"use client"

import { useSyncExternalStore } from "react"

/**
 * Which duty the Flight Deck is about — the one under the TIMELINE's pointer
 * (the owner, Nov 2026: "we can scroll and select a duty … when a duty is
 * selected, widgets change according to the selected duty"). It was a menu in
 * the header, and before that a menu over the flights tile's date line.
 *
 * A MODULE STORE, the `useArranging` shape: the timeline sets the duty its
 * pointer is on (`setChosenDuty`, a duty period's id — `null` is the default,
 * the duty in progress, else the next), the page reads it back, and the page
 * publishes what the header's Briefing button needs (`publishDeckDuty`).
 */

export interface DeckDuty {
  /** The duty's report — the key its flights tile remembers the leg on show by. */
  atMs: number
  /** Each leg's briefing id (`briefingId`), and the leg the duty is on. */
  briefings: string[]
  legNow: number
}

let chosen: string | null = null
let deckDuty: DeckDuty | null = null
let deckKey = ""
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())
const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => listeners.delete(l)
}

export function setChosenDuty(id: string | null): void {
  if (chosen === id) return
  chosen = id
  emit()
}

export function useChosenDuty(): string | null {
  return useSyncExternalStore(subscribe, () => chosen, () => null)
}

/** The page's duty for the header — a new object only when it says something new. */
export function publishDeckDuty(next: DeckDuty | null): void {
  const key = next ? JSON.stringify(next) : ""
  if (key === deckKey) return
  deckKey = key
  deckDuty = next
  emit()
}

export function useDeckDuty(): DeckDuty | null {
  return useSyncExternalStore(subscribe, () => deckDuty, () => null)
}
