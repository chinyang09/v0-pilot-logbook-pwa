"use client"

import { cn } from "@/lib/utils"

export interface FilterChipOption<T extends string> {
  value: T
  label: string
  /** Optional count shown after the label. */
  count?: number
}

/**
 * Horizontally scrollable segmented filter chips — the app-wide replacement for
 * the old `Filter:` label + <Select> dropdown on list pages. Active chip uses
 * the same `text-primary bg-primary/15` treatment as the glass toggle buttons;
 * chips get `active:scale` press feedback like the rest of the touch UI.
 */
export function FilterChips<T extends string>({
  options,
  value,
  onChange,
  className,
}: {
  options: FilterChipOption<T>[]
  value: T
  onChange: (value: T) => void
  className?: string
}) {
  return (
    <div
      role="tablist"
      className={cn(
        // Bleed to the page edge so the row scrolls under the page padding.
        // The bleed has to be the panel gutter itself, and the strip contains
        // its own overscroll so a horizontal flick can never reach the page.
        "flex items-center gap-1.5 overflow-x-auto overscroll-x-contain scrollbar-hide -mx-panel px-panel",
        className
      )}
    >
      {options.map((option) => {
        const active = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(option.value)}
            className={cn(
              "shrink-0 rounded-full px-3 py-1.5 text-xs font-medium",
              "transition-[background-color,color,transform] active:scale-[0.96]",
              active
                ? "bg-primary/15 text-primary"
                : "bg-secondary/50 text-muted-foreground hover:bg-secondary hover:text-foreground"
            )}
          >
            {option.label}
            {option.count !== undefined && (
              <span className={cn("ml-1 tabular-nums", active ? "text-primary/70" : "text-muted-foreground/60")}>
                {option.count}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
