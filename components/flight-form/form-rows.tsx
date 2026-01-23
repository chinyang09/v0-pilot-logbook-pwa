"use client"

import type React from "react"
import { useState, useRef } from "react"
import { ChevronRight } from "lucide-react"
import { Switch } from "@/components/ui/switch"
import { Button } from "@/components/ui/button"
import {
  formatTimeShort,
  utcToLocal,
  formatTimezoneOffset,
  isValidHHMM,
} from "@/lib/utils/time"

/**
 * Swipeable row component for clearing field values
 */
export function SwipeableRow({
  children,
  onClear,
}: {
  children: React.ReactNode
  onClear: () => void
}) {
  const [offset, setOffset] = useState(0)
  const [isDragging, setIsDragging] = useState(false)
  const startX = useRef(0)
  const currentOffset = useRef(0)

  const handleTouchStart = (e: React.TouchEvent) => {
    startX.current = e.touches[0].clientX
    currentOffset.current = offset
    setIsDragging(true)
  }

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!isDragging) return
    const diff = startX.current - e.touches[0].clientX
    const newOffset = Math.max(0, Math.min(80, currentOffset.current + diff))
    setOffset(newOffset)
  }

  const handleTouchEnd = () => {
    setIsDragging(false)
    if (offset > 40) {
      setOffset(80)
    } else {
      setOffset(0)
    }
  }

  return (
    <div className="relative overflow-hidden">
      <div
        className="absolute right-0 top-0 bottom-0 w-20 bg-destructive flex items-center justify-center"
        onClick={() => {
          onClear()
          setOffset(0)
        }}
      >
        <span className="text-destructive-foreground text-sm font-medium">
          Clear
        </span>
      </div>
      <div
        className="relative bg-card transition-transform"
        style={{ transform: `translateX(-${offset}px)` }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        {children}
      </div>
    </div>
  )
}

/**
 * Settings row component for displaying a label and value
 */
export function SettingsRow({
  label,
  value,
  placeholder,
  onClick,
  showChevron = false,
  icon,
  children,
}: {
  label: string
  value?: string
  placeholder?: string
  onClick?: () => void
  showChevron?: boolean
  icon?: React.ReactNode
  children?: React.ReactNode
}) {
  return (
    <div
      className={`flex items-center justify-between py-3.5 px-4 border-b border-border last:border-b-0 ${
        onClick ? "cursor-pointer active:bg-muted/50" : ""
      }`}
      onClick={onClick}
    >
      <span className="text-foreground">{label}</span>
      <div className="flex items-center gap-2">
        {children || (
          <span className={value ? "text-foreground" : "text-muted-foreground"}>
            {value || placeholder || "-"}
          </span>
        )}
        {icon && <span className="text-muted-foreground">{icon}</span>}
        {showChevron && (
          <ChevronRight className="h-5 w-5 text-muted-foreground/50" />
        )}
      </div>
    </div>
  )
}

/**
 * Time row with UTC and Local display
 */
export function TimeRow({
  label,
  utcValue,
  timezoneOffset,
  onTap,
  onNow,
  showNow = true,
}: {
  label: string
  utcValue: string
  timezoneOffset: number
  onTap: () => void
  onNow?: () => void
  showNow?: boolean
}) {
  const localValue = utcToLocal(utcValue, timezoneOffset)
  const tzLabel = formatTimezoneOffset(timezoneOffset)
  const hasValue = isValidHHMM(utcValue)

  return (
    <div className="flex items-center justify-between py-3.5 px-4 border-b border-border last:border-b-0">
      <span className="text-foreground">{label}</span>
      <div className="flex items-center gap-3">
        <div className="flex flex-col items-end cursor-pointer" onClick={onTap}>
          <span
            className={`text-lg ${
              hasValue ? "text-foreground" : "text-muted-foreground"
            }`}
          >
            {hasValue ? utcValue : "--:--"}
          </span>
          <span className="text-xs text-muted-foreground">UTC</span>
        </div>
        <div className="flex flex-col items-end">
          {showNow && !hasValue ? (
            <Button
              variant="outline"
              size="sm"
              className="h-7 px-2 text-xs border-primary text-primary bg-transparent"
              onClick={(e) => {
                e.stopPropagation()
                onNow?.()
              }}
            >
              NOW
            </Button>
          ) : (
            <>
              <span
                className={`text-lg ${
                  hasValue ? "text-foreground" : "text-muted-foreground"
                }`}
              >
                {hasValue ? localValue : "--:--"}
              </span>
              <span className="text-xs text-muted-foreground">{tzLabel}</span>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

/**
 * Time display row for calculated values
 */
export function TimeDisplayRow({
  label,
  value,
  secondaryLabel,
  secondaryValue,
  onUse,
  useLabel,
  showUseButton = false,
}: {
  label: string
  value: string
  secondaryLabel?: string
  secondaryValue?: string
  onUse?: () => void
  useLabel?: string
  showUseButton?: boolean
}) {
  return (
    <div className="flex items-center justify-between py-3.5 px-4 border-b border-border last:border-b-0">
      <span className="text-foreground">{label}</span>
      <div className="flex items-center gap-4">
        {secondaryLabel && secondaryValue ? (
          <>
            <span className="text-foreground">{formatTimeShort(value)}</span>
            <div className="h-4 w-px bg-border" />
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground text-sm">
                {secondaryLabel}
              </span>
              <span className="text-foreground">
                {formatTimeShort(secondaryValue)}
              </span>
            </div>
          </>
        ) : showUseButton && onUse ? (
          <Button
            variant="outline"
            size="sm"
            className="h-7 px-2 text-xs border-primary text-primary bg-transparent"
            onClick={onUse}
          >
            {useLabel || "USE"}
          </Button>
        ) : (
          <span className="text-foreground">{formatTimeShort(value)}</span>
        )}
      </div>
    </div>
  )
}

/**
 * Number row for counts (takeoffs, landings, etc.)
 */
export function NumberRow({
  label,
  value,
  onChange,
}: {
  label: string
  value: number
  onChange: (value: number) => void
}) {
  return (
    <div className="flex items-center justify-between py-3.5 px-4 border-b border-border last:border-b-0">
      <span className="text-foreground">{label}</span>
      <div className="flex items-center gap-3">
        <Button
          variant="outline"
          size="icon"
          className="h-8 w-8 rounded-full bg-transparent"
          onClick={() => onChange(Math.max(0, value - 1))}
        >
          -
        </Button>
        <span className="text-foreground w-8 text-center">{value}</span>
        <Button
          variant="outline"
          size="icon"
          className="h-8 w-8 rounded-full bg-transparent"
          onClick={() => onChange(value + 1)}
        >
          +
        </Button>
      </div>
    </div>
  )
}

/**
 * Toggle row with switch
 */
export function ToggleRow({
  label,
  checked,
  onCheckedChange,
}: {
  label: string
  checked: boolean
  onCheckedChange: (checked: boolean) => void
}) {
  return (
    <div className="flex items-center justify-between py-3.5 px-4 border-b border-border last:border-b-0">
      <span className="text-foreground">{label}</span>
      <Switch checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  )
}
