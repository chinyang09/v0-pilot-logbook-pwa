"use client"

import { useRef, useEffect, useCallback } from "react"
import { Search, X } from "lucide-react"
import { GlassContainer } from "@/components/ui/glass-container"
import { useIsDesktop } from "@/hooks/use-is-desktop"

interface GlassSearchButtonProps {
  isOpen: boolean
  onToggle: () => void
  value: string
  onChange: (value: string) => void
  placeholder?: string
}

/**
 * Expandable glass search button — compact search icon that CSS-transitions
 * into a full search bar.
 *
 * Uses CSS max-width transition instead of JS-driven spring animation to avoid
 * iOS layout reflow jank. The max-width change is GPU-friendly and doesn't
 * trigger the continuous reflows that Framer Motion width animation does.
 *
 * Mobile: expands to full available width (flex: 1 on parent).
 * Desktop: expands to 240px (sits next to the [+] button).
 */
export function GlassSearchButton({
  isOpen,
  onToggle,
  value,
  onChange,
  placeholder = "Search...",
}: GlassSearchButtonProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const isDesktop = useIsDesktop()

  // Auto-focus input after CSS transition completes.
  // Use transitionend listener for precise timing instead of arbitrary timeout.
  const containerRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!isOpen) return
    const el = containerRef.current
    if (!el) return

    const onEnd = (e: TransitionEvent) => {
      if (e.propertyName === "max-width") {
        inputRef.current?.focus()
      }
    }
    el.addEventListener("transitionend", onEnd)

    // Safety fallback if transition doesn't fire (e.g. reduced motion)
    const fallback = setTimeout(() => inputRef.current?.focus(), 350)

    return () => {
      el.removeEventListener("transitionend", onEnd)
      clearTimeout(fallback)
    }
  }, [isOpen])

  const handleClose = useCallback(() => {
    inputRef.current?.blur()
    onChange("")
    onToggle()
  }, [onChange, onToggle])

  return (
    <div
      ref={containerRef}
      className="overflow-hidden"
      style={{
        maxWidth: isOpen ? (isDesktop ? 240 : "100vw") : 56,
        // Liquid/bounce: an overshoot easing makes the bar spring open/closed.
        // Kept as a CSS max-width transition (GPU-friendly) to avoid the iOS
        // reflow jank that a JS width spring causes.
        transition: "max-width 0.4s cubic-bezier(0.34, 1.3, 0.64, 1)",
        flex: !isDesktop && isOpen ? 1 : undefined,
        minWidth: !isDesktop && isOpen ? 0 : 56,
        willChange: isOpen ? "max-width" : undefined,
      }}
    >
      <GlassContainer cornerRadius={28}>
        <div className="flex items-center h-14 relative">
          {/* Search icon — always visible, acts as button when collapsed */}
          <button
            type="button"
            onClick={isOpen ? undefined : onToggle}
            className="absolute left-0 top-0 h-14 w-14 flex items-center justify-center flex-shrink-0"
            style={{ pointerEvents: isOpen ? "none" : "auto" }}
          >
            <Search className="h-5 w-5 text-foreground/60" />
          </button>

          {/* Expanded content — always rendered, fades in/out */}
          <div
            className="flex items-center gap-2 pl-12 pr-4 w-full transition-opacity duration-150"
            style={{
              opacity: isOpen ? 1 : 0,
              pointerEvents: isOpen ? "auto" : "none",
            }}
          >
            <input
              ref={inputRef}
              type="text"
              value={value}
              onChange={(e) => onChange(e.target.value)}
              placeholder={placeholder}
              tabIndex={isOpen ? 0 : -1}
              className="flex-1 bg-transparent text-sm outline-none min-w-0 placeholder:text-muted-foreground/60"
            />
            <button
              type="button"
              onClick={handleClose}
              tabIndex={isOpen ? 0 : -1}
              className="flex-shrink-0 text-muted-foreground hover:text-foreground transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      </GlassContainer>
    </div>
  )
}
