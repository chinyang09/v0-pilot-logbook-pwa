"use client"

/**
 * Renders `lib/utils/undo-toast.ts` — "Flight deleted · Undo" above the bottom
 * nav (or the bottom edge, where the nav is at the top).
 *
 * A solid surface, not glass: it floats over a list and has to be read, which
 * is the same reason the flight card's `…` actions are not glass. Motion is
 * opacity and transform only.
 */

import { useState } from "react"
import { AnimatePresence, motion } from "framer-motion"
import { dismissUndoToast, useUndoToast } from "@/lib/utils/undo-toast"

export function UndoToastHost() {
  const toast = useUndoToast()
  const [busy, setBusy] = useState(false)

  const undo = async () => {
    if (!toast || busy) return
    setBusy(true)
    try {
      await toast.undo()
    } catch (error) {
      console.error("[Undo] Restore failed:", error)
    } finally {
      setBusy(false)
      dismissUndoToast()
    }
  }

  return (
    <div
      className="pointer-events-none fixed inset-x-0 z-[95] flex justify-center px-panel"
      style={{ bottom: "calc(var(--chrome-bottom) + 0.5rem)" }}
      role="status"
      aria-live="polite"
    >
      <AnimatePresence>
        {toast && (
          <motion.div
            key={toast.key}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            className="pointer-events-auto flex h-11 max-w-full items-center gap-1 rounded-full border border-border bg-card pl-4 pr-1 text-sm shadow-lg"
          >
            <span className="min-w-0 truncate">{toast.message}</span>
            <button
              type="button"
              onClick={undo}
              disabled={busy}
              className="h-9 shrink-0 rounded-full px-3 font-semibold text-primary transition-colors hover:bg-secondary disabled:opacity-60"
            >
              Undo
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
