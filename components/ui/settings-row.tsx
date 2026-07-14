"use client"

import type React from "react"
import { useRef } from "react"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
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
  return (
    <div className="min-w-0 flex-1 mr-4">
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
          placeholder={placeholder}
          className={cn(
            // Blend the input into the row: no box/shadow/border, and keep the
            // same font size as the read-only value (override the base md:text-sm).
            "text-right border-0 bg-transparent dark:bg-transparent shadow-none rounded-none h-auto p-0 w-auto max-w-[200px] md:text-base text-muted-foreground placeholder:text-muted-foreground/50 focus-visible:ring-0",
            uppercase && "uppercase"
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
        checked={checked}
        onCheckedChange={readOnly ? undefined : onCheckedChange}
        disabled={readOnly || disabled}
      />
    </div>
  )
}

/**
 * A row displaying a label and an inline select. The trigger is blended into
 * the row (no box) like the other inline inputs; the popover is a standard
 * Select menu.
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
  options: Array<{ value: T; label: React.ReactNode }>
  disabled?: boolean
}) {
  return (
    <div className="flex items-center justify-between px-4 py-3.5 row-divider">
      <RowLabel label={label} description={description} disabled={disabled} />
      <Select value={value} onValueChange={(v) => onValueChange(v as T)} disabled={disabled}>
        <SelectTrigger
          className={cn(
            // Blend into the row like the inline text inputs — no box, right
            // aligned, same type size as the read-only value.
            "border-0 bg-transparent dark:bg-transparent shadow-none rounded-none h-auto p-0 w-auto",
            "justify-end gap-1 text-muted-foreground md:text-base focus-visible:ring-0"
          )}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent align="end">
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

/**
 * A read-only row for display-only fields. Alias for SettingsRow with readOnly=true.
 */
export function ReadOnlyRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between px-4 py-3.5 row-divider">
      <span className="text-foreground">{label}</span>
      <span className="text-muted-foreground">{value || "-"}</span>
    </div>
  )
}
