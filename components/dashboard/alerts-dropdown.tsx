"use client"

import * as React from "react"
import Link from "next/link"
import { Bell, AlertCircle } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useUnresolvedDiscrepancies } from "@/hooks/data/use-discrepancies"
import { cn } from "@/lib/utils"

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

  const items = unresolvedDiscrepancies.slice(0, 8)
  const count = unresolvedDiscrepancies.length
  const hasError = items.some((d) => d.severity === "error")

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={`Import notes${count > 0 ? `, ${count}` : ""}`}
          className="relative h-9 w-9 rounded-full"
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
      </DropdownMenuTrigger>
      {/* The app's menu surface (`.menu-surface`, as `OptionMenu` uses) — the
          glass face, not the popover's flat card. The utilities below win
          over the shared popover's own fill, border, corner and shadow. */}
      <DropdownMenuContent
        align="end"
        className="menu-surface w-72 rounded-[18px] border-0 bg-[var(--glass-base)] p-2 shadow-[var(--glass-shadow)]"
      >
        <div className="px-2 pb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Import Notes
        </div>
        {count === 0 ? (
          <div className="px-2 py-6 text-center text-sm text-muted-foreground">
            Nothing to review.
          </div>
        ) : (
          <ul className="flex flex-col gap-1">
            {items.map((d) => (
              <li key={d.id}>
                <Link
                  href="/discrepancies"
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
                      {d.type ?? "Discrepancy"}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {d.message ?? "Unresolved"}
                    </p>
                  </div>
                </Link>
              </li>
            ))}
            {count > items.length && (
              <li>
                <Link
                  href="/discrepancies"
                  className="block rounded-xl px-2 py-2 text-center text-xs text-primary hover:bg-[var(--on-glass-fill-soft)]"
                >
                  All {count} notes
                </Link>
              </li>
            )}
          </ul>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
