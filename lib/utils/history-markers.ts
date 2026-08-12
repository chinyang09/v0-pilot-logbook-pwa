/**
 * Who owns the top of the overlay history stack.
 *
 * `useBackDismiss` gives each open overlay a MARKER history entry so the system
 * back gesture has something of ours to consume. Releasing one is only safe
 * while it is still the TOP of the stack — `history.back()` takes back whatever
 * is on top, not whatever you meant.
 *
 * The hook already guarded the case where a NAVIGATION buried a marker (it
 * compares the URL). It could not see the other way a marker gets buried:
 * another overlay pushing one on top. That happens whenever two dialogs hand
 * off in a single commit — a status dialog closing as a review dialog opens.
 * The outgoing one's release is deferred by a task, so by the time its
 * `history.back()` fires the incoming dialog has already pushed, and the back
 * pops the NEW dialog's marker. Its popstate handler then dismisses it: the
 * review dialog closed by itself, milliseconds after opening, and the import
 * reported itself cancelled.
 *
 * A marker's owner therefore has to be tracked across instances, which means a
 * module-level stack. It is deliberately pure — no `window`, no `history` — so
 * the ordering rules can be tested without a DOM.
 */

export type MarkerId = number;

let nextId = 1;
let stack: MarkerId[] = [];

/** A fresh id for one overlay instance. Stable for that instance's lifetime. */
export function createMarkerId(): MarkerId {
  return nextId++;
}

/** Record that `id` just pushed a marker, making it the top of the stack. */
export function pushMarker(id: MarkerId): void {
  // An instance that somehow pushes twice keeps ONE entry, at the top.
  stack = stack.filter((entry) => entry !== id);
  stack.push(id);
}

/** Is `id`'s marker the one `history.back()` would take? */
export function isTopMarker(id: MarkerId): boolean {
  return stack.length > 0 && stack[stack.length - 1] === id;
}

/**
 * Give up `id`'s claim.
 *
 * Returns true when it WAS the top — the only case in which the caller may
 * issue a `history.back()`. A buried marker is dropped from the stack and left
 * on the history stack: it is a duplicate entry for a page the user is already
 * on, so passing back through it looks like nothing happened, where popping it
 * would take away somebody else's overlay (or undo a navigation).
 */
export function dropMarker(id: MarkerId): boolean {
  const wasTop = isTopMarker(id);
  stack = stack.filter((entry) => entry !== id);
  return wasTop;
}

/** How many overlay markers are currently claimed. Diagnostics + tests. */
export function markerDepth(): number {
  return stack.length;
}

/** Tests only — the stack is process-wide state. */
export function resetMarkers(): void {
  stack = [];
  nextId = 1;
}
