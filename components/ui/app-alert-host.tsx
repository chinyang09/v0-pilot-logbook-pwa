"use client"

/**
 * Renders `lib/utils/app-alert.ts` — the app's own alert, in place of the
 * browser's `confirm`/`alert`.
 *
 * Shaped like a platform alert: a compact card centred over a dimmed screen,
 * the title and message centred, the answers as a row of full-width buttons
 * under a hairline, the affirmative one on the right and in bold. It is the
 * one surface in the app that INTERRUPTS, so it is deliberately unlike a
 * sheet or a form: small, centred, two choices.
 *
 * Every way out goes through `useBackDismiss`, so Android's back gesture and
 * Escape both mean "Cancel" rather than leaving the alert behind a page.
 */

import { useEffect, useId, useRef } from "react"
import { createPortal } from "react-dom"
import { MODAL_SCRIM } from "@/components/ui/chrome-overlays"
import { useBackDismiss } from "@/hooks/use-back-dismiss"
import { settleAppAlert, useAppAlert, type AppAlert } from "@/lib/utils/app-alert"
import { cn } from "@/lib/utils"

export function AppAlertHost() {
  const alert = useAppAlert()
  if (!alert || typeof document === "undefined") return null
  // Keyed: each alert is its own mount, with its own history marker.
  return createPortal(<AlertCard key={alert.id} alert={alert} />, document.body)
}

function AlertCard({ alert }: { alert: AppAlert }) {
  const titleId = useId()
  const messageId = useId()
  const answerRef = useRef(false)
  const dismiss = useBackDismiss(true, () => settleAppAlert(alert.id, answerRef.current))
  const confirmRef = useRef<HTMLButtonElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)

  const answer = (confirmed: boolean) => {
    answerRef.current = confirmed
    dismiss()
  }

  useEffect(() => {
    // A destructive question starts on the SAFE answer, so an Enter typed
    // without reading cannot lose anything.
    ;(alert.destructive && cancelRef.current ? cancelRef.current : confirmRef.current)?.focus()
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && dismiss()
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [alert.destructive, dismiss])

  const twoButtons = alert.cancelLabel != null

  return (
    // Above everything, Radix's popper layer (z-150) included: an alert is
    // asked from anywhere and has to be answered before anything else.
    <div className={cn("fixed inset-0 z-[160] flex items-center justify-center px-6", MODAL_SCRIM)}>
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={alert.message ? messageId : undefined}
        className="w-full max-w-[18rem] overflow-hidden rounded-2xl border border-border bg-card text-center shadow-2xl animate-in fade-in zoom-in-105 duration-200"
      >
        <div className="px-5 pb-4 pt-5">
          <h2 id={titleId} className="text-[17px] font-semibold leading-snug text-foreground">
            {alert.title}
          </h2>
          {alert.message && (
            <p id={messageId} className="mt-1.5 whitespace-pre-line text-sm leading-snug text-muted-foreground">
              {alert.message}
            </p>
          )}
        </div>
        <div className={cn("grid border-t border-border", twoButtons ? "grid-cols-2 divide-x divide-border" : "grid-cols-1")}>
          {twoButtons && (
            <button
              ref={cancelRef}
              type="button"
              onClick={() => answer(false)}
              className="h-11 text-base text-primary transition-colors active:bg-muted focus-visible:bg-muted focus-visible:outline-none"
            >
              {alert.cancelLabel}
            </button>
          )}
          <button
            ref={confirmRef}
            type="button"
            onClick={() => answer(true)}
            className={cn(
              "h-11 text-base font-semibold transition-colors active:bg-muted focus-visible:bg-muted focus-visible:outline-none",
              alert.destructive ? "text-destructive" : "text-primary"
            )}
          >
            {alert.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
