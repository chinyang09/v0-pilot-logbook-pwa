"use client"

import { useRef, useEffect, useCallback } from "react"
import { motion } from "framer-motion"
import { Search, X } from "lucide-react"
import { GlassContainer } from "@/components/ui/glass-container"
import { useIsDesktop } from "@/hooks/use-is-desktop"

const COLLAPSED_SIZE = 56
const DESKTOP_EXPANDED = 240

const springTransition = {
  type: "spring" as const,
  stiffness: 400,
  damping: 30,
}

interface GlassSearchButtonProps {
  isOpen: boolean
  onToggle: () => void
  value: string
  onChange: (value: string) => void
  placeholder?: string
}

/**
 * Expandable glass search button — compact search icon that spring-animates
 * into a full search bar.
 *
 * Mobile: expands to full available width (100% of parent).
 * Desktop: expands to 240px (sits next to the [+] button).
 *
 * Focus is delayed until the spring animation settles to prevent
 * iOS keyboard/layout jank during expansion.
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

  // Auto-focus input after animation settles.
  // iOS fires keyboard + layout shift during spring animation causing jank,
  // so we wait for the spring to mostly settle (~250ms).
  useEffect(() => {
    if (isOpen) {
      const delay = isDesktop ? 80 : 280
      const timer = setTimeout(() => inputRef.current?.focus(), delay)
      return () => clearTimeout(timer)
    }
  }, [isOpen, isDesktop])

  const handleClose = useCallback(() => {
    inputRef.current?.blur()
    onChange("")
    onToggle()
  }, [onChange, onToggle])

  // Mobile: animate to full width via CSS flex; Desktop: fixed 240px
  const expandedWidth = isDesktop ? DESKTOP_EXPANDED : "100%"

  return (
    <motion.div
      initial={false}
      animate={{ width: isOpen ? expandedWidth : COLLAPSED_SIZE }}
      transition={springTransition}
      className="overflow-hidden"
      style={!isDesktop && isOpen ? { flex: 1, minWidth: 0 } : undefined}
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
    </motion.div>
  )
}
