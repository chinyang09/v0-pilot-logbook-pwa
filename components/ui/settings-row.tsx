"use client"

import { CODE_INPUT_PROPS } from "@/lib/utils/input-props"
import type React from "react"
import { useRef } from "react"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { ChevronDown } from "lucide-react"
import { SwipeableCard } from "@/components/swipeable-card"
import { cn } from "@/lib/utils"

/** Shared label block: main label + optional small muted description. */
function RowLabel({
  label,
  description,
  required,
  disabled,
}: {
  label: string
  description?: string
  required?: boolean
  disabled?: boolean
}) {
  // A bare label is a word or two and keeps its line; the INPUT beside it
  // gives way (`min-w-0` on the inputs). As a flex-1 block it was the label
  // that shrank, so "Licence Number" broke over two lines beside an input
  // claiming its full intrinsic width. A label with a description still
  // wraps — that sentence is what is meant to give.
  return (
    <div className={cn("mr-4", description ? "min-w-0 flex-1" : "shrink-0 whitespace-nowrap")}>
      <span className={disabled ? "text-muted-foreground" : "text-foreground"}>
        {label}
        {required && <span className="text-destructive ml-0.5">*</span>}
      </span>
      {description && (
        <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
      )}
    </div>
  )
}

/**
 * A row displaying a label and value, optionally editable via an inline input.
 * Used across detail panels (aircraft, crew, flight) and new-entity forms.
 *
 * When editable, the row is swipeable to reveal a "Clear" action (set
 * `swipeToClear={false}` to opt out — e.g. for fields that must stay filled).
 */
export function SettingsRow({
  label,
  description,
  value,
  onChange,
  onBlur,
  placeholder,
  type = "text",
  inputMode,
  readOnly = false,
  required = false,
  uppercase = false,
  swipeToClear = true,
}: {
  label: string
  /** Optional small muted line under the label. */
  description?: string
  value: string
  onChange?: (value: string) => void
  /** When the field is left — for a value committed once rather than per keystroke. */
  onBlur?: () => void
  placeholder?: string
  type?: string
  inputMode?: "text" | "decimal" | "numeric"
  readOnly?: boolean
  required?: boolean
  uppercase?: boolean
  swipeToClear?: boolean
}) {
  const editable = !readOnly && !!onChange
  const wrapped = editable && swipeToClear
  const inputRef = useRef<HTMLInputElement>(null)

  const inner = (
    <div
      className={cn(
        "flex items-center justify-between px-4 py-3.5",
        !wrapped && "row-divider"
      )}
    >
      <RowLabel label={label} description={description} required={required} />
      {readOnly ? (
        <span className="text-muted-foreground">{value || "-"}</span>
      ) : (
        <Input
          ref={wrapped ? inputRef : undefined}
          type={type}
          inputMode={inputMode}
          value={value}
          onChange={(e) => onChange?.(e.target.value)}
          onBlur={onBlur}
          placeholder={placeholder}
          // The row's label is a sibling span, so the input needs its own name
          // (the Switch and Select rows below say the same thing).
          aria-label={label}
          aria-required={required || undefined}
          {...(uppercase ? CODE_INPUT_PROPS : null)}
          className={cn(
            // Blend the input into the row: no box/shadow/border, and keep the
            // same font size as the read-only value (override the base md:text-sm).
            "text-right border-0 bg-transparent dark:bg-transparent shadow-none rounded-none h-auto p-0 w-auto min-w-0 max-w-[200px] md:text-base text-muted-foreground placeholder:text-muted-foreground/50 focus-visible:ring-0",
            uppercase && "uppercase",
            // A count is a few digits; reserving a text field's width for it
            // is what broke its label over three lines.
            (inputMode === "numeric" || inputMode === "decimal") && "max-w-[6rem]"
          )}
        />
      )}
    </div>
  )

  if (!wrapped) return inner

  return (
    <SwipeableCard
      variant="row"
      separated
      onClick={() => inputRef.current?.focus()}
      actions={[
        { label: "Clear", variant: "destructive", onClick: () => onChange?.("") },
      ]}
    >
      {inner}
    </SwipeableCard>
  )
}

/**
 * A row displaying a label and a boolean toggle switch.
 */
export function ToggleRow({
  label,
  description,
  checked,
  onCheckedChange,
  readOnly = false,
  disabled = false,
}: {
  label: string
  /** Optional small muted line under the label. */
  description?: string
  checked: boolean
  onCheckedChange?: (checked: boolean) => void
  readOnly?: boolean
  disabled?: boolean
}) {
  return (
    <div className="flex items-center justify-between px-4 py-3.5 row-divider">
      <RowLabel label={label} description={description} disabled={disabled} />
      <Switch
        aria-label={label}
        checked={checked}
        onCheckedChange={readOnly ? undefined : onCheckedChange}
        disabled={readOnly || disabled}
      />
    </div>
  )
}

/**
 * A row displaying a label and a choice — the PLATFORM's picker.
 *
 * A native `<select>` is laid over the whole row at opacity 0 (the flight
 * form's Pilot Role does the same), so a tap anywhere on the row opens the
 * operating system's own control: the wheel on iOS, the sheet on Android, a
 * menu on a desktop. It was a Radix Select, whose floating list beside the
 * trigger is a web page's dropdown on every platform — and on a phone, a
 * small target in a corner of the row.
 */
export function SelectRow<T extends string>({
  label,
  description,
  value,
  onValueChange,
  options,
  disabled = false,
}: {
  label: string
  /** Optional small muted line under the label. */
  description?: string
  value: T
  onValueChange: (value: T) => void
  options: Array<{ value: T; label: string }>
  disabled?: boolean
}) {
  const selected = options.find((o) => o.value === value)
  return (
    <div className="relative flex items-center justify-between px-4 py-3.5 row-divider focus-within:outline-2 focus-within:outline-ring focus-within:-outline-offset-2">
      <RowLabel label={label} description={description} disabled={disabled} />
      <span className="flex min-w-0 max-w-[55%] shrink items-center gap-1 text-muted-foreground">
        <span className="truncate">{selected?.label ?? ""}</span>
        <ChevronDown className="h-4 w-4 shrink-0" aria-hidden />
      </span>
      <select
        aria-label={label}
        value={value}
        disabled={disabled}
        onChange={(e) => onValueChange(e.target.value as T)}
        className="absolute inset-0 h-full w-full cursor-pointer appearance-none opacity-0 disabled:cursor-default"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  )
}

/**
 * A read-only row for display-only fields. Alias for SettingsRow with readOnly=true.
 */
export function ReadOnlyRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-3.5 row-divider">
      <span className="shrink-0 text-foreground">{label}</span>
      <span className="min-w-0 text-right text-muted-foreground">{value || "-"}</span>
    </div>
  )
}
