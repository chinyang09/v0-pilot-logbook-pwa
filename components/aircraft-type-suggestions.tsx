"use client"

import type { AircraftType } from "@/types/entities/aircraft-type.types"
import { formatAircraftType } from "@/lib/utils/aircraft-type-utils"

/**
 * The ICAO type matches under a Type Code field — the aircraft form, the
 * aircraft panel and the aircraft page each carried their own copy of a
 * bordered web dropdown (`hover:bg-accent`, full-width rules, 32px rows). It is
 * a grouped list now, in the rows' own vocabulary: an inset well, inset
 * dividers, rows a thumb can hit (44px), and the description as a capsule.
 */
export function AircraftTypeSuggestions({
  results,
  onSelect,
}: {
  results: AircraftType[]
  onSelect: (type: AircraftType) => void
}) {
  if (results.length === 0) return null
  return (
    <div
      role="listbox"
      aria-label="Matching aircraft types"
      className="mt-2 max-h-56 overflow-y-auto overscroll-contain rounded-xl bg-muted/40"
    >
      {results.map((type) => (
        <button
          key={type.designator}
          type="button"
          role="option"
          aria-selected={false}
          onClick={() => onSelect(type)}
          className="row-divider block min-h-11 w-full px-4 py-2.5 text-left transition-colors active:bg-muted/60 focus-visible:bg-muted/60 focus-visible:outline-none"
        >
          <span className="flex items-center gap-2">
            <span className="text-sm font-semibold text-foreground">{type.designator}</span>
            <span className="truncate rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">{type.description}</span>
            {type.wtc && <span className="shrink-0 text-xs text-muted-foreground">WTC {type.wtc}</span>}
            {type.wtg && <span className="shrink-0 text-xs text-muted-foreground">WTG {type.wtg}</span>}
          </span>
          <span className="mt-0.5 block truncate text-xs text-muted-foreground">{formatAircraftType(type)}</span>
        </button>
      ))}
    </div>
  )
}
