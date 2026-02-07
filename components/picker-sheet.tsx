"use client"

import { useEffect, useRef, useState, type ReactNode } from "react"
import { X, Search } from "lucide-react"
import { cn } from "@/lib/utils"

interface PickerSheetProps {
  open: boolean
  onClose: () => void
  title: string
  searchPlaceholder?: string
  searchValue: string
  onSearchChange: (value: string) => void
  children: ReactNode
}

export function PickerSheet({
  open,
  onClose,
  title,
  searchPlaceholder = "Search...",
  searchValue,
  onSearchChange,
  children,
}: PickerSheetProps) {
  const [mounted, setMounted] = useState(false)
  const [visible, setVisible] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) {
      setMounted(true)
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setVisible(true)
          setTimeout(() => searchRef.current?.focus(), 150)
        })
      })
    } else {
      setVisible(false)
      const timer = setTimeout(() => setMounted(false), 200)
      return () => clearTimeout(timer)
    }
  }, [open])

  if (!mounted) return null

  return (
    <div
      className={cn(
        "absolute inset-0 z-[100] flex flex-col",
        "bg-background/95 backdrop-blur-2xl",
        "transition-opacity duration-200",
        visible ? "opacity-100" : "opacity-0"
      )}
    >
      {/* Header */}
      <div className="flex-none h-12 border-b border-border/50 px-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold">{title}</h2>
        <button
          onClick={onClose}
          className="p-1.5 rounded-full hover:bg-muted/50 transition-colors"
        >
          <X className="h-5 w-5 text-muted-foreground" />
        </button>
      </div>

      {/* Search */}
      <div className="flex-none px-4 py-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            ref={searchRef}
            type="text"
            value={searchValue}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder={searchPlaceholder}
            className="w-full h-10 pl-10 pr-4 bg-muted/30 border border-border/50 rounded-xl text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary/50"
          />
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto overscroll-contain">
        {children}
      </div>
    </div>
  )
}
