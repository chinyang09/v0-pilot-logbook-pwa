"use client"

import { useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { SyncStatus } from "@/components/sync-status"
import { ArrowLeft, Search, Plus, X } from "lucide-react"
import type React from "react"
import { cn } from "@/lib/utils"

export interface SearchablePageHeaderProps {
  title: React.ReactNode
  searchQuery: string
  onSearchChange: (query: string) => void
  searchPlaceholder?: string
  onAdd?: () => void
  showBack?: boolean
  onBack?: () => void
  /** Extra action buttons rendered between title and search (normal mode only) */
  actions?: React.ReactNode
  showSyncStatus?: boolean
  className?: string
}

export function SearchablePageHeader({
  title,
  searchQuery,
  onSearchChange,
  searchPlaceholder = "Search...",
  onAdd,
  showBack = false,
  onBack,
  actions,
  showSyncStatus = true,
  className,
}: SearchablePageHeaderProps) {
  const router = useRouter()
  const [isSearchActive, setIsSearchActive] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const handleBack = () => {
    if (onBack) onBack()
    else router.back()
  }

  const activateSearch = () => {
    setIsSearchActive(true)
    requestAnimationFrame(() => inputRef.current?.focus())
  }

  const deactivateSearch = () => {
    setIsSearchActive(false)
    onSearchChange("")
  }

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value
    onSearchChange(value)
    if (!value) {
      setIsSearchActive(false)
    }
  }

  return (
    <header
      className={cn(
        "h-12 bg-background/30 backdrop-blur-xl border-b border-border/50 z-50",
        className
      )}
    >
      <div className="flex items-center h-full gap-1.5 px-4 pl-12">
        {showBack && (
          <Button variant="ghost" size="icon-sm" onClick={handleBack} className="flex-shrink-0">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        )}

        {/* Title — collapses via max-width + fades out when search active */}
        <div
          style={{ maxWidth: isSearchActive ? 0 : 9999 }}
          className={cn(
            "flex-1 min-w-0 overflow-hidden transition-all duration-300 ease-out",
            isSearchActive ? "opacity-0" : "opacity-100"
          )}
        >
          <h1 className="text-lg font-semibold whitespace-nowrap truncate">{title}</h1>
        </div>

        {/* Extra actions (normal mode only) */}
        {actions && (
          <div
            className={cn(
              "flex items-center transition-opacity duration-200",
              isSearchActive ? "opacity-0 w-0 overflow-hidden pointer-events-none" : "opacity-100"
            )}
          >
            {actions}
          </div>
        )}

        {/* Search bar — expands from w-8 icon to full flex-1, with a bouncy
            (overshoot) easing for a springy, liquid feel. */}
        <div
          style={{ transitionTimingFunction: "cubic-bezier(0.34, 1.45, 0.64, 1)" }}
          className={cn(
            "flex items-center gap-2 rounded-lg border overflow-hidden transition-all duration-300 cursor-pointer",
            isSearchActive
              ? "flex-1 border-border/50 bg-background/50 px-2 h-8 cursor-default"
              : "w-8 h-8 border-transparent justify-center flex-shrink-0"
          )}
          onClick={!isSearchActive ? activateSearch : undefined}
        >
          <Search className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
          <input
            ref={inputRef}
            type="text"
            value={searchQuery}
            onChange={handleInputChange}
            placeholder={searchPlaceholder}
            className={cn(
              "bg-transparent text-sm outline-none flex-1 min-w-0 transition-opacity",
              isSearchActive
                ? "opacity-100 duration-150 delay-150"
                : "opacity-0 w-0 pointer-events-none"
            )}
          />
          {isSearchActive && (
            <X
              className="h-4 w-4 flex-shrink-0 text-muted-foreground cursor-pointer"
              onClick={(e: React.MouseEvent) => {
                e.stopPropagation()
                deactivateSearch()
              }}
            />
          )}
        </div>

        {/* + button — always visible */}
        {onAdd && (
          <Button size="icon-sm" onClick={onAdd} className="flex-shrink-0">
            <Plus className="h-4 w-4" />
          </Button>
        )}

        {/* Sync status — hidden during search */}
        {showSyncStatus && (
          <div
            className={cn(
              "transition-all duration-200 overflow-hidden flex-shrink-0",
              isSearchActive ? "opacity-0 w-0" : "opacity-100"
            )}
          >
            <SyncStatus />
          </div>
        )}
      </div>
    </header>
  )
}
