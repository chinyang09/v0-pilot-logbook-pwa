/**
 * Who owns the top of the overlay history stack.
 *
 * The case this exists for: two dialogs handing off in one commit. The
 * outgoing one's release is deferred by a task, so by the time its
 * `history.back()` would fire, the incoming dialog has already pushed a marker
 * of its own — and `back()` takes whatever is on TOP, not whatever the caller
 * meant. That popped the new dialog's entry and its popstate handler dismissed
 * it, which is how a LogTen import came back reporting itself cancelled a
 * moment after the review dialog opened.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  createMarkerId,
  dropMarker,
  isTopMarker,
  markerDepth,
  pushMarker,
  resetMarkers,
} from "../history-markers";

beforeEach(() => resetMarkers());

describe("history markers", () => {
  it("hands each instance its own id", () => {
    expect(createMarkerId()).not.toBe(createMarkerId());
  });

  it("makes the most recent push the top", () => {
    const first = createMarkerId();
    const second = createMarkerId();
    pushMarker(first);
    expect(isTopMarker(first)).toBe(true);

    pushMarker(second);
    expect(isTopMarker(second)).toBe(true);
    expect(isTopMarker(first)).toBe(false);
    expect(markerDepth()).toBe(2);
  });

  it("refuses the back() when another overlay pushed on top", () => {
    // The dialog handoff, exactly: the status dialog pushes, the review dialog
    // pushes, and only THEN does the status dialog's deferred release run.
    const status = createMarkerId();
    const review = createMarkerId();
    pushMarker(status);
    pushMarker(review);

    // dropMarker's return value is the caller's licence to call history.back().
    expect(dropMarker(status)).toBe(false);
    // …and the review dialog still owns the top, so its entry survives.
    expect(isTopMarker(review)).toBe(true);
    expect(markerDepth()).toBe(1);
  });

  it("allows the back() for the overlay that is actually on top", () => {
    const only = createMarkerId();
    pushMarker(only);
    expect(dropMarker(only)).toBe(true);
    expect(markerDepth()).toBe(0);
  });

  it("unwinds a stack of overlays in order", () => {
    const a = createMarkerId();
    const b = createMarkerId();
    const c = createMarkerId();
    pushMarker(a);
    pushMarker(b);
    pushMarker(c);

    expect(dropMarker(c)).toBe(true);
    expect(dropMarker(b)).toBe(true);
    expect(dropMarker(a)).toBe(true);
    expect(markerDepth()).toBe(0);
  });

  it("is idempotent, so a double release can't pop twice", () => {
    const id = createMarkerId();
    pushMarker(id);
    expect(dropMarker(id)).toBe(true);
    expect(dropMarker(id)).toBe(false);
  });

  it("keeps one entry per instance if it somehow pushes twice", () => {
    const id = createMarkerId();
    const other = createMarkerId();
    pushMarker(id);
    pushMarker(other);
    pushMarker(id);
    expect(markerDepth()).toBe(2);
    expect(isTopMarker(id)).toBe(true);
  });

  it("reports no top when nothing is claimed", () => {
    expect(isTopMarker(createMarkerId())).toBe(false);
    expect(markerDepth()).toBe(0);
  });
});
