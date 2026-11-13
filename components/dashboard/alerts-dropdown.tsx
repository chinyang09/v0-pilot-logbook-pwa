"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Bell, AlertCircle } from "lucide-react"

import { createPortal } from "react-dom"
import { AnimatePresence } from "framer-motion"
import { Button } from "@/components/ui/button"
import { MorphSurface, menuHeight, placeOver, type Placement } from "@/components/ui/option-menu"
import { useBackDismiss } from "@/hooks/use-back-dismiss"
import { useUnresolvedDiscrepancies } from "@/hooks/data/use-discrepancies"
import { cn } from "@/lib/utils"
import { openImportNotes } from "@/lib/utils/roster/discrepancy-kinds"
import { DISCREPANCY_TYPE_CONFIG } from "@/components/roster/discrepancy-card"

/**
 * Import notes that still need a decision — and nothing else.
 *
 * This used to also list expiring currencies, high FDP utilisation and
 * outstanding rest. All three are now first-class content in the legality panel
 * a few pixels below the bell, stated with their actual numbers, so carrying
 * them here as well meant the dashboard told the pilot about an expiring
 * medical twice: once as "MEDIC · 5d remaining" behind a tap, and once as a row
 * they could already see.
 *
 * Discrepancies are the one alert class the page does not otherwise show. They
 * are not a legality question — they are a comparison between the pilot's
 * record and the company's that somebody has to settle — so they keep the bell.
 */
export function AlertsDropdown() {
  const { unresolvedDiscrepancies } = useUnresolvedDiscrepancies()

  // Notes only. The PF/PM and day/night COMPARISONS are a standing record,
  // kept whichever way the pilot decided, and never "resolved" — counted here
  // they made the bell read 18 over changes the pilot had already approved.
  // They live on the Discrepancies page's Comparisons tab.
  const notes = React.useMemo(() => openImportNotes(unresolvedDiscrepancies), [unresolvedDiscrepancies])
  const items = notes.slice(0, 8)
  const count = notes.length
  const hasError = items.some((d) => d.severity === "error")

  const buttonRef = React.useRef<HTMLButtonElement>(null)
  const [placement, setPlacement] = React.useState<Placement | null>(null)
  const close = React.useCallback(() => {
    setPlacement(null)
    buttonRef.current?.focus({ preventScroll: true })
  }, [])
  const dismiss = useBackDismiss(placement !== null, close)
  const router = useRouter()
  // The navigation runs as the dismissal's FOLLOW-UP, on a clean history
  // stack (`useBackDismiss`'s rule) — a push issued while the marker's back()
  // is still queued is undone by it.
  const openNotes = React.useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      // Open on the Notes tab — the page keeps its tab in sessionStorage.
      try {
        sessionStorage.setItem("discrepancies:filter", JSON.stringify("notes"))
      } catch {
        /* private mode: the page picks its first non-empty tab */
      }
      dismiss(() => router.push("/discrepancies"))
    },
    [dismiss, router],
  )

  return (
    <>
      <Button
        ref={buttonRef}
        variant="ghost"
        size="icon"
        aria-label={`Import notes${count > 0 ? `, ${count}` : ""}`}
        aria-haspopup="menu"
        aria-expanded={placement !== null}
        className="relative h-10 w-10 rounded-full"
        onClick={() => {
          const r = buttonRef.current?.getBoundingClientRect()
          // Grows out of the bell, its top-right corner on the bell's.
          if (r) setPlacement(placeOver(r, count === 0 ? 116 : menuHeight(Math.min(items.length + (count > items.length ? 1 : 0), 9)) + 12, 288))
        }}
      >
        <Bell className="h-5 w-5" />
        {count > 0 && (
          <span
            className={cn(
              "absolute top-1 right-1 inline-flex h-4 min-w-[16px] items-center justify-center rounded-full px-1 text-[10px] font-semibold text-white",
              hasError ? "bg-destructive" : "bg-chart-4",
            )}
          >
            {count > 9 ? "9+" : count}
          </span>
        )}
      </Button>
      {typeof document !== "undefined" &&
        createPortal(
          <AnimatePresence>
            {placement && (
              <>
                <div key="scrim" aria-hidden className="fixed inset-0 z-[200]" onPointerDown={(e) => (e.preventDefault(), dismiss())} />
                <MorphSurface
                  key="menu"
                  role="menu"
                  label="Import notes"
                  placement={placement}
                  glyph={<Bell className="h-5 w-5" />}
                  className="p-2"
                  onKeyDown={(e) => e.key === "Escape" && dismiss()}
                >
                  <div className="px-2 pb-2 pt-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Import Notes
                  </div>
                  {count === 0 ? (
                    <div className="px-2 py-6 text-center text-sm text-muted-foreground">Nothing to review.</div>
                  ) : (
                    <ul className="flex flex-col gap-1">
                      {items.map((d) => (
                        <li key={d.id}>
                          <Link
                            href="/discrepancies"
                            onClick={openNotes}
                            className="relative z-[2] flex items-start gap-2 rounded-xl px-2 py-2 hover:bg-[var(--on-glass-fill-soft)] focus-visible:bg-[var(--on-glass-fill-soft)]"
                          >
                            <AlertCircle
                              className={cn(
                                "mt-0.5 h-4 w-4 shrink-0",
                                d.severity === "error" ? "text-destructive" : "text-chart-4",
                              )}
                            />
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm font-medium text-foreground">
                                {DISCREPANCY_TYPE_CONFIG[d.type]?.label ?? "Import Note"}
                              </p>
                              <p className="truncate text-xs text-muted-foreground">{d.message ?? "Unresolved"}</p>
                            </div>
                          </Link>
                        </li>
                      ))}
                      {count > items.length && (
                        <li>
                          <Link
                            href="/discrepancies"
                            onClick={openNotes}
                            className="relative z-[2] block rounded-xl px-2 py-2 text-center text-xs text-primary hover:bg-[var(--on-glass-fill-soft)]"
                          >
                            All {count} notes
                          </Link>
                        </li>
                      )}
                    </ul>
                  )}
                </MorphSurface>
              </>
            )}
          </AnimatePresence>,
          document.body,
        )}
    </>
  )
}
