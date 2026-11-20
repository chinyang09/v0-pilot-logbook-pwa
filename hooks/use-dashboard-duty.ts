"use client"

import { useSyncExternalStore } from "react"
import type { MenuOption } from "@/components/ui/option-menu"

/**
 * Which duty the Flight Deck is about — chosen in the HEADER (the owner,
 * Nov 2026: "decouple flight selection from the flight card"). It was a
 * menu laid over the flights tile's date line, which the tile's card did not
 * carry, so the duty could not be changed once the card was open.
 *
 * A MODULE STORE, the `useArranging` shape: the page publishes the duties it
 * can be about (`publishDutyChoices`), the header's menu reads them and sets
 * the choice, and the page reads the choice back. `null` is the default —
 * the duty in progress, else the next.
 */

export interface DutyMenu {
  options: Array<MenuOption<string>>
  /** The button's two lines: "Next" over "21 Nov". */
  word: string
  day: string
}

let chosen: number | null = null
let menu: DutyMenu | null = null
let menuKey = ""
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())
const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => listeners.delete(l)
}

export function setChosenDuty(atMs: number | null): void {
  if (chosen === atMs) return
  chosen = atMs
  emit()
}

export function useChosenDuty(): number | null {
  return useSyncExternalStore(subscribe, () => chosen, () => null)
}

/** The page's duties, for the header's menu — a new list only when it says something new. */
export function publishDutyChoices(next: DutyMenu | null): void {
  const key = next ? JSON.stringify(next) : ""
  if (key === menuKey) return
  menuKey = key
  menu = next
  emit()
}

export function useDutyMenu(): DutyMenu | null {
  return useSyncExternalStore(subscribe, () => menu, () => null)
}
