"use client"

/**
 * Says so when the logbook's database could not be opened.
 *
 * Without it a failed open looked exactly like an EMPTY logbook — every page
 * rendered its empty state, and the dashboard read "NO FLIGHTS YET" over a
 * pilot's whole history. The open is retried on a backoff (`use-db.ts`); this
 * is the honest state while it is, with a way to try now or reload.
 *
 * Placed where the undo toast sits and styled the same: a solid surface over
 * content, opacity/transform motion only.
 */

import { useDBReady, retryDBOpen } from "@/hooks/data/use-db"

export function StorageNotice() {
  const { failed } = useDBReady()
  if (!failed) return null
  return (
    <div
      className="pointer-events-none fixed inset-x-0 z-[96] flex justify-center px-panel"
      style={{ bottom: "calc(var(--chrome-bottom) + 0.5rem)" }}
      role="alert"
    >
      <div className="pointer-events-auto flex max-w-full items-center gap-1 rounded-2xl border border-border bg-card py-1 pl-4 pr-1 text-sm shadow-lg">
        <span className="min-w-0 py-1.5">Couldn&apos;t open your logbook on this device.</span>
        <button
          type="button"
          onClick={retryDBOpen}
          className="h-9 shrink-0 rounded-full px-3 font-semibold text-primary transition-colors hover:bg-secondary"
        >
          Retry
        </button>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="h-9 shrink-0 rounded-full px-3 font-semibold text-primary transition-colors hover:bg-secondary"
        >
          Reload
        </button>
      </div>
    </div>
  )
}
