/**
 * The app's own alert — the one place a question is put to the pilot that
 * has to be answered before anything else happens.
 *
 * It replaces `window.confirm` / `window.alert`. Those are the browser's
 * dialogs, not the app's: an installed PWA shows them under the site's
 * ADDRESS as a title ("oooi.app says"), in the platform's web-content style,
 * and they block the page's thread while open. The questions behind them are
 * the most consequential in the app (losing unsynced edits, signing out every
 * device), which is the worst place to look like a web page.
 *
 * A module store read through `useSyncExternalStore`, like `undo-toast` —
 * the question is asked from a provider or a page handler, and it renders in
 * one host at the root. Alerts queue: a second one waits for the first.
 */

import { useSyncExternalStore } from "react"

export interface AppAlertOptions {
  title: string
  message?: string
  /** The affirmative button. */
  confirmLabel?: string
  /** `null` = a one-button alert (acknowledge only). */
  cancelLabel?: string | null
  /** The affirmative action loses something — drawn in the destructive colour. */
  destructive?: boolean
}

export interface AppAlert extends AppAlertOptions {
  id: number
  resolve: (confirmed: boolean) => void
}

let queue: AppAlert[] = []
let nextId = 1
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

function enqueue(options: AppAlertOptions): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    queue = [...queue, { ...options, id: nextId++, resolve }]
    emit()
  })
}

/** Ask a yes/no question. Resolves `true` for the affirmative button. */
export function appConfirm(options: AppAlertOptions): Promise<boolean> {
  return enqueue({ confirmLabel: "OK", cancelLabel: "Cancel", ...options })
}

/** Tell the pilot something they must acknowledge. */
export async function appAlert(options: Omit<AppAlertOptions, "cancelLabel" | "destructive">): Promise<void> {
  await enqueue({ confirmLabel: "OK", ...options, cancelLabel: null })
}

/** Answer the alert on screen and move to the next. */
export function settleAppAlert(id: number, confirmed: boolean) {
  const alert = queue.find((a) => a.id === id)
  if (!alert) return
  queue = queue.filter((a) => a.id !== id)
  alert.resolve(confirmed)
  emit()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

const current = () => queue[0] ?? null
const none = () => null

export function useAppAlert(): AppAlert | null {
  return useSyncExternalStore(subscribe, current, none)
}
