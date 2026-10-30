"use client"

/**
 * A row whose value is LOOKED UP when tapped — gates, where the aeroplane
 * is — rather than stored. Untapped it reads "Check"; while it asks,
 * "Checking…"; then one or two lines of answer, and a tap asks again.
 *
 * The same row shape as `ReadOnlyRow` (label left, value right, inset
 * divider), but a real button, so it is reached from a keyboard and named by
 * its label and value together.
 */

import type { ReactNode } from "react"
import { cn } from "@/lib/utils"

export interface CheckRowValue {
  primary: string
  secondary?: string
}

export function CheckRow({
  label,
  value,
  loading = false,
  onCheck,
  icon,
}: {
  label: string
  /** null until checked. */
  value: CheckRowValue | null
  loading?: boolean
  onCheck: () => void
  icon?: ReactNode
}) {
  const primary = loading ? "Checking…" : value?.primary ?? "Check"
  return (
    <button
      type="button"
      onClick={onCheck}
      disabled={loading}
      aria-label={`${label}: ${[primary, value?.secondary].filter(Boolean).join(", ")}`}
      className="flex w-full items-center justify-between gap-3 px-4 py-3.5 text-left row-divider active:bg-muted/50 focus-visible:outline-2 focus-visible:outline-ring focus-visible:-outline-offset-2"
    >
      <span className="shrink-0 text-foreground">{label}</span>
      <span className="flex min-w-0 items-center gap-2">
        <span className="min-w-0 text-right">
          <span className={cn("block truncate", value && !loading ? "text-foreground" : "text-muted-foreground")}>{primary}</span>
          {value?.secondary && !loading && (
            <span className="block truncate text-xs text-muted-foreground">{value.secondary}</span>
          )}
        </span>
        {icon && <span className="shrink-0 text-muted-foreground">{icon}</span>}
      </span>
    </button>
  )
}
