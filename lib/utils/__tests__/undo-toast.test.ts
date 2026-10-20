import { describe, it, expect, vi, afterEach } from "vitest"
import { UNDO_TOAST_MS, dismissUndoToast, showUndoToast, useUndoToast } from "../undo-toast"

// The hook is a thin useSyncExternalStore wrapper; read the store through the
// same snapshot it uses by rendering nothing — the getter is what matters.
vi.mock("react", () => ({ useSyncExternalStore: (_s: unknown, get: () => unknown) => get() }))

afterEach(() => {
  dismissUndoToast()
  vi.useRealTimers()
})

describe("undo toast", () => {
  it("shows, then clears itself after the window", () => {
    vi.useFakeTimers()
    showUndoToast("TR600 deleted", () => {})
    expect(useUndoToast()?.message).toBe("TR600 deleted")
    vi.advanceTimersByTime(UNDO_TOAST_MS - 1)
    expect(useUndoToast()).not.toBeNull()
    vi.advanceTimersByTime(1)
    expect(useUndoToast()).toBeNull()
  })

  it("a second delete replaces the first and restarts the window", () => {
    vi.useFakeTimers()
    const first = vi.fn()
    showUndoToast("A deleted", first)
    const firstKey = useUndoToast()!.key
    vi.advanceTimersByTime(UNDO_TOAST_MS - 100)
    showUndoToast("B deleted", () => {})
    expect(useUndoToast()!.message).toBe("B deleted")
    expect(useUndoToast()!.key).not.toBe(firstKey)
    vi.advanceTimersByTime(UNDO_TOAST_MS - 1)
    expect(useUndoToast()?.message).toBe("B deleted")
    expect(first).not.toHaveBeenCalled()
  })
})
