/**
 * Actions that are already happening and can still be stopped.
 *
 * An armed delete has to outlive the row that armed it. The countdown used to
 * live inside the card, so scrolling a virtualised list far enough to unmount
 * the row silently cancelled the deletion — the user had every reason to think
 * it went through. The timer lives here instead: the card only renders the
 * remaining time and offers the cancel.
 *
 * Deliberately module-scope rather than a context. There is no tree position
 * this belongs to — the whole point is that it survives unmounting.
 */

interface PendingAction {
  /** Epoch ms when the action fires. */
  deadline: number
  timer: ReturnType<typeof setTimeout>
  run: () => void
}

const pending = new Map<string, PendingAction>()
const listeners = new Set<() => void>()

function notify(): void {
  for (const listener of listeners) listener()
}

/**
 * Schedule `run` to fire after `delayMs` unless cancelled. Arming the same key
 * twice replaces the first — a row can only have one pending action.
 */
export function armPendingAction(
  key: string,
  delayMs: number,
  run: () => void
): void {
  cancelPendingAction(key)
  const timer = setTimeout(() => {
    pending.delete(key)
    notify()
    run()
  }, delayMs)
  pending.set(key, { deadline: Date.now() + delayMs, timer, run })
  notify()
}

/** Stop a pending action. Returns whether there was one to stop. */
export function cancelPendingAction(key: string): boolean {
  const entry = pending.get(key)
  if (!entry) return false
  clearTimeout(entry.timer)
  pending.delete(key)
  notify()
  return true
}

/** Epoch ms this key fires at, or undefined when nothing is pending. */
export function getPendingDeadline(key: string): number | undefined {
  return pending.get(key)?.deadline
}

/** Subscribe to arm/cancel/fire events. Returns an unsubscribe function. */
export function subscribePendingActions(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
