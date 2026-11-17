"use client"

import { useRef, useState, useEffect, useCallback } from "react"
import { WheelPicker, WheelPickerWrapper } from "@ncdai/react-wheel-picker"
import "@ncdai/react-wheel-picker/style.css"
import { createPortal } from "react-dom"
import { MODAL_SCRIM } from "@/components/ui/chrome-overlays"
import { WHEEL_FILL, wheelClassNames } from "@/components/ui/wheel-styles"
import { useBackDismiss } from "@/hooks/use-back-dismiss"
import { useDialogFocus } from "@/hooks/use-dialog-focus"
import { SegmentedTabs } from "@/components/ui/segmented-tabs"
import { cn } from "@/lib/utils"
import { formatTimezoneOffset, getCurrentTimeUTC, isValidHHMM, localToUTC, utcToLocal } from "@/lib/utils/time"

interface TimePickerProps {
  isOpen?: boolean
  /** HH:MM, in UTC — whichever frame the wheels show. */
  initialTime?: string
  /** Always UTC: a local edit is converted back before it is handed over. */
  onSelect?: (value: string) => void
  onClose: () => void
  label?: string
  timezoneOffset?: number // In hours for local time display
  /** A length of time rather than a point in time: no NOW, no local clock. */
  duration?: boolean
  /**
   * Which clock the wheels show. "local" edits the time at `timezoneOffset`
   * — the row's local column — and the other clock is shown beneath NOW, so
   * each one is checked against the other while it is being set.
   */
  frame?: "utc" | "local"
  /** The pilot switched clocks inside the picker (the UTC | Local tabs). */
  onFrameChange?: (frame: "utc" | "local") => void
}

function parseClock(hhmm: string): { hours: number; minutes: number } {
  if (!isValidHHMM(hhmm)) return { hours: 0, minutes: 0 }
  const [h, m] = hhmm.split(":").map(Number)
  return { hours: h, minutes: m }
}

const pad = (n: number) => n.toString().padStart(2, "0")

// Generate options for hours (0-23) and minutes (0-59)
const hourOptions = Array.from({ length: 24 }, (_, i) => ({
  value: i,
  label: i.toString().padStart(2, "0"),
}))

const minuteOptions = Array.from({ length: 60 }, (_, i) => ({
  value: i,
  label: i.toString().padStart(2, "0"),
}))

// Constants for wheel sizing
const ITEM_HEIGHT = 44
const VISIBLE_COUNT = 20

export function TimePicker({
  isOpen = true,
  initialTime = "",
  onSelect,
  onClose,
  label,
  timezoneOffset = 0,
  duration = false,
  frame: initialFrame = "utc",
  onFrameChange,
}: TimePickerProps) {
  // The clock the wheels show is switchable INSIDE the picker: on an empty
  // row NOW stands where the local column would be, so this is how an empty
  // row is started from local time — and the switch says, in the largest
  // type on the sheet, which clock is being set (a tap on UTC meant for
  // Local used to be noticed only once the wheels had been turned).
  const [frame, setFrame] = useState<"utc" | "local">(initialFrame)
  const local = frame === "local" && !duration
  // Seeded once per open — the sheet mounts each time it opens (and the form
  // keys it on the field and frame), so a sync landing underneath an open
  // picker cannot move the wheels out from under the finger.
  const [initial] = useState(() => parseClock(local ? utcToLocal(initialTime, timezoneOffset) : initialTime))
  const [hours, setHours] = useState(initial.hours)
  const [minutes, setMinutes] = useState(initial.minutes)

  // Lock body scroll when open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden"
      return () => {
        document.body.style.overflow = ""
      }
    }
  }, [isOpen])

  // Every way out goes through the history marker, so Android's back gesture
  // closes the sheet instead of navigating the page out from under it.
  const dismiss = useBackDismiss(isOpen, onClose)

  useEffect(() => {
    if (!isOpen) return
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && dismiss()
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [isOpen, dismiss])

  const shown = `${pad(hours)}:${pad(minutes)}`

  const handleConfirm = useCallback(() => {
    onSelect?.(local ? localToUTC(shown, timezoneOffset) : shown)
    dismiss()
  }, [local, shown, timezoneOffset, onSelect, dismiss])

  const handleSetNow = useCallback(() => {
    const utcNow = getCurrentTimeUTC()
    const now = parseClock(local ? utcToLocal(utcNow, timezoneOffset) : utcNow)
    setHours(now.hours)
    setMinutes(now.minutes)
  }, [local, timezoneOffset])

  // The OTHER clock, read live off the wheels, so a local edit shows the UTC
  // it will store and a UTC edit the local time it means.
  const otherClock = local
    ? { label: "UTC", value: localToUTC(shown, timezoneOffset) }
    : { label: "Local", value: utcToLocal(shown, timezoneOffset) }
  const zoneLabel = formatTimezoneOffset(timezoneOffset)
  // With no offset the two clocks are one, and a switch between them would
  // be a choice that changes nothing.
  const switchable = !duration && timezoneOffset !== 0

  const switchFrame = useCallback(
    (next: "utc" | "local") => {
      if (next === frame) return
      // The wheels keep the INSTANT: 14:30 UTC becomes 22:30 at UTC+8.
      const utc = frame === "local" ? localToUTC(shown, timezoneOffset) : shown
      const moved = parseClock(next === "local" ? utcToLocal(utc, timezoneOffset) : utc)
      setHours(moved.hours)
      setMinutes(moved.minutes)
      setFrame(next)
      onFrameChange?.(next)
    },
    [frame, shown, timezoneOffset, onFrameChange],
  )

  // Focus goes IN to the first wheel (they take the arrow keys), Tab stays
  // inside, and closing hands it back to the row that opened the picker.
  const dialogRef = useRef<HTMLDivElement>(null)
  useDialogFocus(dialogRef, isOpen, '[data-rwp][tabindex="0"]')

  if (!isOpen || typeof document === "undefined") return null

  // Portalled, and above the app chrome (header z-99, nav pill z-100). It used
  // to render in place at z-60: under the nav pill, which covered the bottom
  // of the sheet and stayed tappable over the scrim — and inside the mobile
  // flight overlay's own stacking context, so no z-index could lift it out.
  // Below Radix's popper layer (z-150).
  return createPortal(
    <div
      className={cn("fixed inset-0 z-[120] flex items-end justify-center px-2", MODAL_SCRIM)}
      // Nothing covers the sheet now, so it only has to clear the home
      // indicator — not the nav pill it used to be lifted 4rem above.
      style={{ paddingBottom: "max(0.5rem, env(safe-area-inset-bottom))" }}
      onClick={() => dismiss()}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={label || "Select time"}
        className="w-full max-w-md rounded-2xl bg-card animate-in slide-in-from-bottom duration-300"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Each header button is a 20px line of text; the invisible ::after
            takes the target to ~44px without moving anything.
            Header: Cancel | NOW | Save */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border/50">
          <button
            type="button"
            onClick={() => dismiss()}
            className="text-sm font-medium text-primary active:opacity-70 relative after:absolute after:-inset-3 after:content-['']"
          >
            Cancel
          </button>

          <div className="flex flex-col items-center">
            {label && <span className="text-sm font-semibold text-foreground">{label}</span>}
            {!duration && !switchable && (
              <span className="text-xs text-muted-foreground">UTC</span>
            )}
          </div>

          <button
            type="button"
            onClick={handleConfirm}
            className="text-sm font-semibold text-primary active:opacity-70 relative after:absolute after:-inset-3 after:content-['']"
          >
            Save
          </button>
        </div>

        {!duration && (
          <div className={cn("flex items-center gap-3 px-4 pt-3", switchable ? "justify-between" : "justify-center")}>
            {switchable ? (
              <SegmentedTabs
                className="flex-1"
                tabs={[
                  { value: "utc", label: "UTC" },
                  { value: "local", label: `Local ${zoneLabel}` },
                ]}
                value={frame}
                onChange={switchFrame}
              />
            ) : null}
            <button
              type="button"
              onClick={handleSetNow}
              className="h-9 rounded-full px-4 text-sm font-semibold text-primary control-surface"
            >
              Now
            </button>
          </div>
        )}
        {switchable && (
          <p className="px-4 pt-2 text-center text-xs text-muted-foreground tabular-nums">
            = {otherClock.value} {local ? "UTC" : `Local ${zoneLabel}`}
          </p>
        )}

        {/* Wheel Picker */}
        <div className="relative px-8 py-4">
          {/* Highlight bar */}
          <div
            className={`pointer-events-none absolute left-8 right-8 top-1/2 z-0 -translate-y-1/2 rounded-lg ${WHEEL_FILL}`}
            style={{ height: ITEM_HEIGHT }}
          />
          {/* The clock being set, ON the selected row, where the eye is while
              the wheels turn. */}
          {!duration && (
            <span className="pointer-events-none absolute right-10 top-1/2 z-10 -translate-y-1/2 text-[11px] font-semibold uppercase tracking-wide text-primary">
              {local ? "LT" : "UTC"}
            </span>
          )}

          {/* Colon separator */}
          <div
            className="pointer-events-none absolute left-1/2 top-1/2 z-10 -translate-x-1/2 -translate-y-1/2 flex items-center justify-center"
            style={{ height: ITEM_HEIGHT }}
          >
            <span className="text-xl font-semibold text-foreground">:</span>
          </div>

          <WheelPickerWrapper>
            <div className="flex-1">
              <WheelPicker
                options={hourOptions}
                value={hours}
                onValueChange={(val) => setHours(val as number)}
                infinite
                optionItemHeight={ITEM_HEIGHT}
                visibleCount={VISIBLE_COUNT}
                classNames={wheelClassNames("start")}
              />
            </div>

            {/* Spacer for colon */}
            <div className="w-6 flex-none" />

            <div className="flex-1">
              <WheelPicker
                options={minuteOptions}
                value={minutes}
                onValueChange={(val) => setMinutes(val as number)}
                infinite
                optionItemHeight={ITEM_HEIGHT}
                visibleCount={VISIBLE_COUNT}
                classNames={wheelClassNames("end")}
              />
            </div>
          </WheelPickerWrapper>
        </div>
      </div>
    </div>,
    document.body
  )
}
