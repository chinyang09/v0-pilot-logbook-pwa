"use client"

import { useRef, useEffect } from "react"
import { motion } from "framer-motion"
import { Search, X } from "lucide-react"
import { GlassContainer } from "@/components/ui/glass-container"

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
 * Both states are always rendered (no conditional mount/unmount) to prevent
 * two-stage jank. The outer width animates via spring, inner elements
 * crossfade with opacity.
 */
export function GlassSearchButton({
  isOpen,
  onToggle,
  value,
  onChange,
  placeholder = "Search...",
}: GlassSearchButtonProps) {
  const inputRef = useRef<HTMLInputElement>(null)

  // Auto-focus input when opening
  useEffect(() => {
    if (isOpen) {
      const timer = setTimeout(() => inputRef.current?.focus(), 80)
      return () => clearTimeout(timer)
    }
  }, [isOpen])

  const handleClose = () => {
    onChange("")
    onToggle()
  }

  return (
    <motion.div
      initial={false}
      animate={{ width: isOpen ? 240 : 56 }}
      transition={springTransition}
      className="overflow-hidden"
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
