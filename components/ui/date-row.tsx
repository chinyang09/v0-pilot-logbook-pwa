"use client"

/**
 * A grouped-form row that holds a DATE and opens the app's wheel picker —
 * the one the flight form uses for its date.
 *
 * It replaces `<input type="date">` in the sheet forms. A native date field
 * is the browser's control, not the app's: on a desktop it is a boxed
 * "mm/dd/yyyy" with a calendar glyph, in the browser's locale rather than the
 * app's ("03/14/2027" beside a list reading "Mar 14, 2027"), and every
 * platform draws it differently.
 */

import { useState } from "react"
import { DatePicker } from "@/components/date-picker"
import { SwipeableCard } from "@/components/swipeable-card"
import { formatYMDMedium } from "@/lib/utils/date"

export function DateRow({
  label,
  value,
  onChange,
  required = false,
  description,
  placeholder = "Select",
  futureYears,
  clearable = false,
}: {
  label: string
  /** YYYY-MM-DD, or "" when unset. */
  value: string
  onChange: (value: string) => void
  required?: boolean
  description?: string
  placeholder?: string
  futureYears?: number
  /** Swipe to clear, like the text rows — for a date that may be left unset. */
  clearable?: boolean
}) {
  const [open, setOpen] = useState(false)
  const swipe = clearable && !!value
  const row = (
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`${label}: ${value ? formatYMDMedium(value) : "not set"}`}
        className={`${swipe ? "" : "row-divider "}flex w-full items-center justify-between px-4 py-3.5 text-left transition-colors active:bg-muted/50`}
      >
        <span className="mr-4 min-w-0 flex-1">
          <span className="text-foreground">
            {label}
            {required && <span className="ml-0.5 text-destructive">*</span>}
          </span>
          {description && <span className="mt-0.5 block text-xs text-muted-foreground">{description}</span>}
        </span>
        <span className={value ? "text-muted-foreground tabular-nums" : "text-muted-foreground/50"}>
          {value ? formatYMDMedium(value) : placeholder}
        </span>
      </button>
  )
  return (
    <>
      {swipe ? (
        <SwipeableCard
          variant="row"
          separated
          onClick={() => setOpen(true)}
          actions={[{ label: "Clear", variant: "destructive", onClick: () => onChange("") }]}
        >
          {row}
        </SwipeableCard>
      ) : (
        row
      )}
      {open && (
        <DatePicker
          initialDate={value}
          onSelect={onChange}
          onClose={() => setOpen(false)}
          label={label}
          futureYears={futureYears}
        />
      )}
    </>
  )
}
