"use client"

import { useRef } from "react"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { SwipeableCard } from "@/components/swipeable-card"
import { cn } from "@/lib/utils"

/**
 * A row displaying a label and value, optionally editable via an inline input.
 * Used across detail panels (aircraft, crew, flight) and new-entity forms.
 *
 * When editable, the row is swipeable to reveal a "Clear" action (set
 * `swipeToClear={false}` to opt out — e.g. for fields that must stay filled).
 */
export function SettingsRow({
  label,
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
        !wrapped && "border-b border-border last:border-b-0"
      )}
    >
      <span className="text-foreground">
        {label}
        {required && <span className="text-destructive ml-0.5">*</span>}
      </span>
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
            "text-right border-0 bg-transparent h-auto p-0 w-auto max-w-[200px] text-muted-foreground placeholder:text-muted-foreground/50 focus-visible:ring-0",
            uppercase && "uppercase",
            // When swipeable, the input ignores pointer events so a horizontal
            // swipe always reaches the swipe layer; a clean tap focuses it via
            // the row's onClick below.
            wrapped ? "pointer-events-none" : "touch-pan-y"
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
  checked,
  onCheckedChange,
  readOnly = false,
  disabled = false,
}: {
  label: string
  checked: boolean
  onCheckedChange?: (checked: boolean) => void
  readOnly?: boolean
  disabled?: boolean
}) {
  return (
    <div className="flex items-center justify-between px-4 py-3.5 border-b border-border last:border-b-0">
      <span className={disabled ? "text-muted-foreground" : "text-foreground"}>
        {label}
      </span>
      <Switch
        checked={checked}
        onCheckedChange={readOnly ? undefined : onCheckedChange}
        disabled={readOnly || disabled}
      />
    </div>
  )
}

/**
 * A read-only row for display-only fields. Alias for SettingsRow with readOnly=true.
 */
export function ReadOnlyRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between px-4 py-3.5 border-b border-border last:border-b-0">
      <span className="text-foreground">{label}</span>
      <span className="text-muted-foreground">{value || "-"}</span>
    </div>
  )
}
