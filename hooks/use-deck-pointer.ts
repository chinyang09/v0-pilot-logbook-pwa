"use client"

import { useSyncExternalStore } from "react"

/**
 * The Flight Deck's TIMELINE pointer (the owner, Nov 2026: "a working
 * timeline, similar to that of FDP … we can scroll and select a duty, and the
 * widgets all work around the scrollable timeline … limits also change as we
 * scroll").
 *
 * A MODULE STORE, the `useArranging` shape, so the one tile that follows the
 * pointer minute by minute (the limits) re-renders on its own and nothing
 * else does: the page reads the DUTY under the pointer (`useChosenDuty`),
 * which changes only when the pointer crosses into another duty.
 *
 * | | |
 * |---|---|
 * | `pointer` | the instant under the timeline's centre line while the pilot has scrolled it; `null` while it follows NOW |
 * | `settled` | the same, once the scroll has come to rest — what the tiles' edges are judged at |
 * | `nowRequest` | bumped by the header's Now button: the timeline scrolls back and follows now again |
 */

let pointer: number | null = null
let settled: number | null = null
let nowRequest = 0
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())
const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => listeners.delete(l)
}

export function setDeckPointer(ms: number | null): void {
  if (pointer === ms) return
  pointer = ms
  emit()
}

export function setDeckSettled(ms: number | null): void {
  if (settled === ms) return
  settled = ms
  emit()
}

/** Back to now: the timeline scrolls home and follows the clock again. */
export function requestDeckNow(): void {
  nowRequest++
  emit()
}

/** The instant under the pointer, or null while it follows now — changes every frame of a scroll. */
export function useDeckPointer(): number | null {
  return useSyncExternalStore(subscribe, () => pointer, () => null)
}

/** The pointer once the timeline has come to rest (null: now). */
export function useDeckSettled(): number | null {
  return useSyncExternalStore(subscribe, () => settled, () => null)
}

/** True while the pointer has been scrolled away from now — the header's Now button shows. */
export function useDeckDetached(): boolean {
  return useSyncExternalStore(subscribe, () => settled !== null, () => false)
}

export function useDeckNowRequest(): number {
  return useSyncExternalStore(subscribe, () => nowRequest, () => 0)
}
