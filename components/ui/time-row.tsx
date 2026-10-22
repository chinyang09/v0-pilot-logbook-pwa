"use client"

/**
 * A grouped-form row that holds a UTC clock time and opens the app's wheel
 * picker — the flight form's time rows' picker. The time-of-day sibling of
 * `DateRow`.
 *
 * The duty form took its window as text typed into a blended field, where a
 * placeholder "06:00" read as a value already entered and "6" or "0600" were
 * not a time until reformatted by hand.
 */

import { useState } from "react"
import { TimePicker } from "@/components/time-picker"

export function TimeRow({
  label,
  value,
  onChange,
  required = false,
  description,
  placeholder = "Select",
}: {
  label: string
  /** HH:MM in UTC, or "" when unset. */
  value: string
  onChange: (value: string) => void
  required?: boolean
  description?: string
  placeholder?: string
}) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`${label}: ${value || "not set"}`}
        className="row-divider flex w-full items-center justify-between px-4 py-3.5 text-left transition-colors active:bg-muted/50"
      >
        <span className="mr-4 min-w-0 flex-1">
          <span className="text-foreground">
            {label}
            {required && <span className="ml-0.5 text-destructive">*</span>}
          </span>
          {description && <span className="mt-0.5 block text-xs text-muted-foreground">{description}</span>}
        </span>
        <span className={value ? "tabular-nums text-muted-foreground" : "text-muted-foreground/50"}>
          {value || placeholder}
        </span>
      </button>
      {open && (
        <TimePicker initialTime={value} onSelect={onChange} onClose={() => setOpen(false)} label={label} />
      )}
    </>
  )
}
