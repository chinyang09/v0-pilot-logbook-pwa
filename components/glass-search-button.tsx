"use client"

import { useRef, useEffect } from "react"
import { motion } from "framer-motion"
import { Search, X } from "lucide-react"
import { Button } from "@/components/ui/button"
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
 * into a full search bar. GitHub desktop-style.
 *
 * Closed: [🔍] (glass icon button)
 * Open:   [🔍 ---input--- ✕] (expanded glass search bar)
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
      // Small delay to let the animation start before focusing
      const timer = setTimeout(() => inputRef.current?.focus(), 100)
      return () => clearTimeout(timer)
    }
  }, [isOpen])

  const handleClose = () => {
    onChange("")
    onToggle()
  }

  return (
    <motion.div
      layout
      initial={false}
      animate={{ width: isOpen ? 240 : 40 }}
      transition={springTransition}
      className="overflow-hidden"
    >
      <GlassContainer cornerRadius={22}>
        <div className="flex items-center h-10">
          {isOpen ? (
            /* Expanded state: icon + input + close */
            <div className="flex items-center gap-2 px-3 w-full">
              <Search className="h-4 w-4 text-muted-foreground flex-shrink-0" />
              <input
                ref={inputRef}
                type="text"
                value={value}
                onChange={(e) => onChange(e.target.value)}
                placeholder={placeholder}
                className="flex-1 bg-transparent text-sm outline-none min-w-0 placeholder:text-muted-foreground/60"
              />
              <button
                type="button"
                onClick={handleClose}
                className="flex-shrink-0 text-muted-foreground hover:text-foreground transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          ) : (
            /* Collapsed state: icon button */
            <Button
              variant="ghost"
              size="icon"
              onClick={onToggle}
              className="h-10 w-10 text-foreground/60 hover:text-foreground"
            >
              <Search className="h-4 w-4" />
            </Button>
          )}
        </div>
      </GlassContainer>
    </motion.div>
  )
}
