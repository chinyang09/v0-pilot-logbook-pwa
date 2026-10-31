"use client"

import { CODE_INPUT_PROPS } from "@/lib/utils/input-props"
import type React from "react"
import { useRef } from "react"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { ChevronsUpDown } from "lucide-react"
import { ChoicePicker, type MenuOption } from "@/components/ui/option-menu"
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
  maxLength,
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
  /** A short code ("TR"): the input is sized to it, so the label and its
   *  description keep the row's width instead of a text field's ~200px. */
  maxLength?: number
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
          maxLength={maxLength}
          style={maxLength ? { width: `${maxLength + 2}ch` } : undefined}
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
 * A row displaying a label and a choice — the app's own picker.
 *
 * The whole row is the control (`ChoicePicker`), and it opens the app's menu
 * (`OptionMenu`) hung off the row's trailing edge. It used to lay a native
 * `<select>` over the row, which opened a different control on every platform
 * — the wheel on iOS, a sheet on Android, a plain list on a desktop — and like
 * nothing else in the app.
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
  options: Array<MenuOption<T>>
  disabled?: boolean
}) {
  const selected = options.find((o) => o.value === value)
  return (
    <ChoicePicker
      label={label}
      value={value}
      options={options}
      onValueChange={onValueChange}
      disabled={disabled}
      className="row-divider relative flex w-full items-center justify-between px-4 py-3.5 text-left outline-none focus-visible:outline-2 focus-visible:outline-ring focus-visible:-outline-offset-2 disabled:cursor-default"
    >
      <RowLabel label={label} description={description} disabled={disabled} />
      <span className="flex min-w-0 max-w-[55%] shrink items-center gap-1 text-muted-foreground">
        <span className="truncate">{selected?.label ?? ""}</span>
        <ChevronsUpDown className="h-4 w-4 shrink-0" aria-hidden />
      </span>
    </ChoicePicker>
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
