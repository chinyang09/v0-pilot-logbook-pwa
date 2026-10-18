/**
 * When a sync runs.
 *
 * The regression this pins: the old manager returned "no sync needed" for
 * every trigger whenever THIS device's queue was empty, so foreground, focus,
 * network-online and the periodic check never pulled another device's edits.
 * Only a login did — which is why logging in again was the way to catch up.
 * The manager no longer looks at the queue at all.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  DEFAULT_SYNC_TRIGGER_CONFIG,
  SyncTriggerManager,
  pushDelayMs,
  retryDelayMs,
} from "../sync-trigger-manager"

type Listener = () => void

class FakeTarget {
  listeners = new Map<string, Set<Listener>>()
  addEventListener(type: string, fn: Listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set())
    this.listeners.get(type)!.add(fn)
  }
  removeEventListener(type: string, fn: Listener) {
    this.listeners.get(type)?.delete(fn)
  }
  fire(type: string) {
    this.listeners.get(type)?.forEach((fn) => fn())
  }
}

let win: FakeTarget
let doc: FakeTarget & { visibilityState: string }

beforeEach(() => {
  vi.useFakeTimers()
  win = new FakeTarget()
  doc = Object.assign(new FakeTarget(), { visibilityState: "visible" })
  vi.stubGlobal("window", win)
  vi.stubGlobal("document", doc)
  vi.stubGlobal("navigator", { onLine: true })
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

function setup(outcome: () => { ok: boolean; remaining: number } = () => ({ ok: true, remaining: 0 })) {
  const sync = vi.fn(async () => outcome())
  const unload = vi.fn()
  const manager = new SyncTriggerManager()
  manager.initialize(sync, unload)
  return { manager, sync, unload }
}

describe("lifecycle triggers", () => {
  it("syncs on foreground with NOTHING queued locally", async () => {
    const { sync, manager } = setup()
    doc.fire("visibilitychange")
    await vi.advanceTimersByTimeAsync(0)
    expect(sync).toHaveBeenCalledTimes(1)
    manager.destroy()
  })

  it("syncs when the network comes back and on window focus", async () => {
    const { sync, manager } = setup()
    win.fire("online")
    await vi.advanceTimersByTimeAsync(DEFAULT_SYNC_TRIGGER_CONFIG.lifecycleCoalesceMs + 1)
    win.fire("focus")
    await vi.advanceTimersByTimeAsync(0)
    expect(sync).toHaveBeenCalledTimes(2)
    manager.destroy()
  })

  it("collapses focus + visibility firing together into one sync", async () => {
    const { sync, manager } = setup()
    doc.fire("visibilitychange")
    win.fire("focus")
    win.fire("pageshow")
    await vi.advanceTimersByTimeAsync(0)
    expect(sync).toHaveBeenCalledTimes(1)
    manager.destroy()
  })

  it("flushes the queue when the app goes to the background, and stops polling", async () => {
    const { sync, unload, manager } = setup()
    doc.visibilityState = "hidden"
    doc.fire("visibilitychange")
    expect(unload).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(DEFAULT_SYNC_TRIGGER_CONFIG.pollIntervalMs * 3)
    expect(sync).not.toHaveBeenCalled()
    win.fire("pagehide")
    expect(unload).toHaveBeenCalledTimes(2)
    manager.destroy()
  })
})

describe("polling", () => {
  it("asks the server for changes on an interval while visible", async () => {
    const { sync, manager } = setup()
    await vi.advanceTimersByTimeAsync(DEFAULT_SYNC_TRIGGER_CONFIG.pollIntervalMs * 2)
    expect(sync).toHaveBeenCalledTimes(2)
    manager.destroy()
  })
})

describe("local edits", () => {
  it("pushes a burst of edits once, after the debounce", async () => {
    const { sync, manager } = setup()
    manager.notifyDataChanged()
    await vi.advanceTimersByTimeAsync(500)
    manager.notifyDataChanged()
    await vi.advanceTimersByTimeAsync(500)
    manager.notifyDataChanged()
    expect(sync).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(DEFAULT_SYNC_TRIGGER_CONFIG.pushDebounceMs)
    expect(sync).toHaveBeenCalledTimes(1)
    manager.destroy()
  })

  it("never holds an edit past the max wait, however steadily edits arrive", async () => {
    const { sync, manager } = setup()
    for (let t = 0; t < DEFAULT_SYNC_TRIGGER_CONFIG.pushMaxWaitMs + 1000; t += 1000) {
      manager.notifyDataChanged()
      await vi.advanceTimersByTimeAsync(1000)
    }
    expect(sync).toHaveBeenCalled()
    manager.destroy()
  })
})

describe("retry", () => {
  it("backs off and retries on its own when a cycle fails with work left", async () => {
    let calls = 0
    const { sync, manager } = setup(() => (++calls === 1 ? { ok: false, remaining: 3 } : { ok: true, remaining: 0 }))
    await manager.forceSyncNow()
    expect(sync).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(DEFAULT_SYNC_TRIGGER_CONFIG.retryBaseMs)
    expect(sync).toHaveBeenCalledTimes(2)
    manager.destroy()
  })

  it("does not retry a failure with nothing left to push", async () => {
    const { sync, manager } = setup(() => ({ ok: false, remaining: 0 }))
    await manager.forceSyncNow()
    await vi.advanceTimersByTimeAsync(DEFAULT_SYNC_TRIGGER_CONFIG.retryBaseMs * 2)
    expect(sync).toHaveBeenCalledTimes(1)
    manager.destroy()
  })
})

describe("offline", () => {
  it("does not attempt a sync while offline", async () => {
    vi.stubGlobal("navigator", { onLine: false })
    const { sync, manager } = setup()
    await manager.forceSyncNow()
    expect(sync).not.toHaveBeenCalled()
    manager.destroy()
  })
})

describe("policy helpers", () => {
  it("doubles the retry delay up to the cap", () => {
    const cfg = { retryBaseMs: 1000, retryMaxMs: 5000 }
    expect([0, 1, 2, 3, 10].map((n) => retryDelayMs(n, cfg))).toEqual([1000, 2000, 4000, 5000, 5000])
  })

  it("debounces, but never past the burst's deadline", () => {
    const cfg = { pushDebounceMs: 1500, pushMaxWaitMs: 8000 }
    expect(pushDelayMs(0, 0, cfg)).toBe(1500)
    expect(pushDelayMs(0, 7000, cfg)).toBe(1000)
    expect(pushDelayMs(0, 9000, cfg)).toBe(0)
  })
})
