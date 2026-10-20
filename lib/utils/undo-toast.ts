/**
 * The one "Deleted · Undo" message.
 *
 * Deleting is one tap with no confirmation, and Recently Deleted is the undo
 * (see "Destructive Actions" in CLAUDE.md). That holds — but a holding area
 * nobody knows about is not much of an undo, and a row that simply vanished
 * gave no sign the tap had landed or where the thing went. This puts the same
 * undo where the thumb already is, for a few seconds; after that the row is
 * still in Recently Deleted for the rest of its 30 days.
 *
 * A module store read through `useSyncExternalStore`, like `menu-lock` and
 * `useDBReady`: a delete happens deep in a list card, the message renders in
 * the app shell, and nothing in between should re-render to carry it.
 */

import { useSyncExternalStore } from "react"

/** Long enough to read and reach; short enough not to sit over the list. */
export const UNDO_TOAST_MS = 5000

export interface UndoToast {
  /** Changes with every message, so a second delete restarts the toast. */
  key: number
  message: string
  undo: () => Promise<unknown> | unknown
}

let current: UndoToast | null = null
let timer: ReturnType<typeof setTimeout> | null = null
let nextKey = 1
const listeners = new Set<() => void>()

function emit() {
  for (const l of listeners) l()
}

/** Show (or replace) the message. Only the latest delete is undoable here. */
export function showUndoToast(message: string, undo: UndoToast["undo"]) {
  current = { key: nextKey++, message, undo }
  if (timer) clearTimeout(timer)
  timer = setTimeout(dismissUndoToast, UNDO_TOAST_MS)
  emit()
}

export function dismissUndoToast() {
  if (timer) clearTimeout(timer)
  timer = null
  if (!current) return
  current = null
  emit()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function useUndoToast(): UndoToast | null {
  return useSyncExternalStore(
    subscribe,
    () => current,
    () => null
  )
}
