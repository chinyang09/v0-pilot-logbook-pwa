"use client"

/**
 * THE picker for a choice among a few — every one in the app.
 *
 * It replaced the native `<select>` laid invisibly over a row (Settings, the
 * duty and currency forms, the flight form's Pilot Role, a crew member's role,
 * an approach's type) and the one Radix Select (the signer). Those opened the
 * browser's or the OS's own control — a wheel on iOS, a sheet on Android, a
 * plain list on a desktop — so the same choice looked different on every
 * device and like none of the rest of the app.
 *
 * It is a pull-down MENU hung off the control that opened it, the way an iOS
 * menu hangs off its button: the glass's own face (`.menu-surface`), one
 * 44px row per option, a check beside the chosen one. It opens downward from
 * the control and flips upward when there is no room below; it is clamped to
 * the viewport and scrolls inside itself when the list is long.
 *
 * - A tap outside dismisses it WITHOUT reaching what is underneath (a
 *   transparent scrim takes it), the system back gesture closes it
 *   (`useBackDismiss`), and so does Escape.
 * - A choice is applied as the dismissal's follow-up, so it lands on a clean
 *   history stack (the hook's rule).
 * - Keyboard: it opens with the chosen option focused; arrows, Home/End move;
 *   Enter/Space choose; Tab or Escape close and hand focus back to the
 *   control.
 * - It animates opacity and scale only, from the corner nearest its control.
 */

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react"
import { createPortal } from "react-dom"
import { AnimatePresence, motion } from "framer-motion"
import { Check } from "lucide-react"
import { cn } from "@/lib/utils"
import { useBackDismiss } from "@/hooks/use-back-dismiss"

export interface MenuOption<T extends string> {
  value: T
  label: string
  /** A quieter second line, or a trailing note (a crew member's seat). */
  hint?: string
}

const ROW_H = 44
const MARGIN = 12
const GAP = 6
const MIN_W = 200
const MAX_W = 320

interface Placement {
  left: number
  top?: number
  bottom?: number
  maxHeight: number
  width: number
  originX: "left" | "right"
  originY: "top" | "bottom"
}

/** Where the menu goes for a control at `rect` — read in the tap, never mid-commit. */
function place(rect: DOMRect, count: number, align: "start" | "end"): Placement {
  const vw = window.innerWidth
  const vh = window.innerHeight
  const want = count * ROW_H + 12
  const below = vh - rect.bottom - GAP - MARGIN
  const above = rect.top - GAP - MARGIN
  const down = below >= Math.min(want, 240) || below >= above
  const width = Math.min(MAX_W, Math.max(MIN_W, Math.min(rect.width, MAX_W)), vw - MARGIN * 2)
  const rawLeft = align === "end" ? rect.right - width : rect.left
  const left = Math.min(Math.max(MARGIN, rawLeft), vw - MARGIN - width)
  return {
    left,
    width,
    maxHeight: Math.max(ROW_H * 2, down ? below : above),
    ...(down ? { top: rect.bottom + GAP } : { bottom: vh - rect.top + GAP }),
    originX: align === "end" ? "right" : "left",
    originY: down ? "top" : "bottom",
  }
}

/**
 * A control that opens the menu. Its children are what the control shows
 * (a row's label and value, a bare value with a chevron); it is a real
 * `button`, so the whole area is the target and it is reachable by keyboard.
 */
export function ChoicePicker<T extends string>({
  label,
  value,
  options,
  onValueChange,
  disabled = false,
  align = "end",
  className,
  children,
}: {
  /** What is being chosen — the menu's heading and the control's name. */
  label: string
  value: T
  options: Array<MenuOption<T>>
  onValueChange: (value: T) => void
  disabled?: boolean
  /** Which edge of the control the menu lines up with. */
  align?: "start" | "end"
  className?: string
  children: ReactNode
}) {
  const triggerRef = useRef<HTMLButtonElement>(null)
  // The control's name carries its VALUE too — an aria-label replaces the
  // button's text, so on its own it would announce "Pilot role" and not which.
  const current = options.find((o) => o.value === value)?.label
  const [placement, setPlacement] = useState<Placement | null>(null)
  const listId = useId()

  const open = () => {
    const el = triggerRef.current
    if (!el || disabled) return
    setPlacement(place(el.getBoundingClientRect(), options.length + 1, align))
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={placement !== null}
        aria-controls={placement ? listId : undefined}
        aria-label={current ? `${label}: ${current}` : label}
        onClick={open}
        className={className}
      >
        {children}
      </button>
      <OptionMenu
        id={listId}
        label={label}
        placement={placement}
        options={options}
        value={value}
        onSelect={onValueChange}
        onClosed={() => {
          setPlacement(null)
          triggerRef.current?.focus({ preventScroll: true })
        }}
      />
    </>
  )
}

function OptionMenu<T extends string>({
  id,
  label,
  placement,
  options,
  value,
  onSelect,
  onClosed,
}: {
  id: string
  label: string
  placement: Placement | null
  options: Array<MenuOption<T>>
  value: T
  onSelect: (value: T) => void
  onClosed: () => void
}) {
  const active = placement !== null
  const dismiss = useBackDismiss(active, onClosed)
  const listRef = useRef<HTMLDivElement>(null)

  // The chosen option takes focus as the menu opens — a DOM call, not a
  // layout read.
  useEffect(() => {
    if (!active) return
    const list = listRef.current
    const target =
      list?.querySelector<HTMLElement>('[aria-selected="true"]') ?? list?.querySelector<HTMLElement>('[role="option"]')
    target?.focus({ preventScroll: true })
  }, [active])

  const choose = useCallback(
    (v: T) => {
      dismiss(() => {
        if (v !== value) onSelect(v)
      })
    },
    [dismiss, onSelect, value]
  )

  const onKeyDown = (e: React.KeyboardEvent) => {
    const items = Array.from(listRef.current?.querySelectorAll<HTMLElement>('[role="option"]') ?? [])
    const at = items.indexOf(document.activeElement as HTMLElement)
    const move = (i: number) => items[(i + items.length) % items.length]?.focus()
    if (e.key === "ArrowDown") (e.preventDefault(), move(at + 1))
    else if (e.key === "ArrowUp") (e.preventDefault(), move(at - 1))
    else if (e.key === "Home") (e.preventDefault(), move(0))
    else if (e.key === "End") (e.preventDefault(), move(items.length - 1))
    else if (e.key === "Escape" || e.key === "Tab") (e.preventDefault(), dismiss())
  }

  if (typeof document === "undefined") return null
  return createPortal(
    <AnimatePresence>
      {placement && (
        <>
          {/* Takes the dismissing tap so it does not land on what is beneath. */}
          <div key="scrim" aria-hidden className="fixed inset-0 z-[200]" onPointerDown={(e) => (e.preventDefault(), dismiss())} />
          <motion.div
            key="menu"
            ref={listRef}
            id={id}
            role="listbox"
            aria-label={label}
            onKeyDown={onKeyDown}
            initial={{ opacity: 0, scale: 0.92 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.96 }}
            transition={{ duration: 0.16, ease: [0.2, 0.9, 0.3, 1] }}
            className="menu-surface fixed z-[201] overflow-y-auto overscroll-contain py-1.5"
            style={{
              left: placement.left,
              top: placement.top,
              bottom: placement.bottom,
              width: placement.width,
              maxHeight: placement.maxHeight,
              transformOrigin: `${placement.originY} ${placement.originX}`,
            }}
          >
            <div className="px-4 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              {label}
            </div>
            {options.map((option) => {
              const selected = option.value === value
              return (
                <button
                  key={option.value}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  onClick={() => choose(option.value)}
                  className={cn(
                    "relative z-[2] flex min-h-11 w-full items-center gap-3 px-4 text-left text-[15px] outline-none",
                    "hover:bg-[var(--on-glass-fill-soft)] focus-visible:bg-[var(--on-glass-fill-soft)] active:bg-[var(--on-glass-fill)]"
                  )}
                >
                  <span className="min-w-0 flex-1 py-2.5">
                    <span className={cn("block truncate", selected && "font-semibold")}>{option.label}</span>
                    {option.hint && <span className="block truncate text-xs text-muted-foreground">{option.hint}</span>}
                  </span>
                  <Check className={cn("h-4 w-4 shrink-0 text-primary", !selected && "invisible")} aria-hidden />
                </button>
              )
            })}
          </motion.div>
        </>
      )}
    </AnimatePresence>,
    document.body
  )
}
