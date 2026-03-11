"use client"

import { useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { SyncStatus } from "@/components/sync-status"
import { ArrowLeft, Search, Plus } from "lucide-react"
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
  /** Extra action buttons rendered between title area and search icon (normal mode only) */
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
        "h-12 bg-background/30 backdrop-blur-xl border-b border-border/50 z-50 overflow-hidden",
        className
      )}
    >
      <div className="relative h-full">
        {/* Normal mode */}
        <div
          className={cn(
            "absolute inset-0 flex items-center justify-between px-4 pl-12 transition-opacity duration-200",
            isSearchActive ? "opacity-0 pointer-events-none" : "opacity-100"
          )}
        >
          <div className="flex items-center gap-2 min-w-0">
            {showBack && (
              <Button variant="ghost" size="icon-sm" onClick={handleBack}>
                <ArrowLeft className="h-4 w-4" />
              </Button>
            )}
            <h1 className="text-lg font-semibold text-foreground truncate">{title}</h1>
          </div>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            {actions}
            <Button variant="ghost" size="icon-sm" onClick={activateSearch}>
              <Search className="h-4 w-4" />
            </Button>
            {onAdd && (
              <Button size="icon-sm" onClick={onAdd}>
                <Plus className="h-4 w-4" />
              </Button>
            )}
            {showSyncStatus && <SyncStatus />}
          </div>
        </div>

        {/* Search mode */}
        <div
          className={cn(
            "absolute inset-0 flex items-center gap-2 px-3 transition-opacity duration-200",
            isSearchActive ? "opacity-100" : "opacity-0 pointer-events-none"
          )}
        >
          <Button
            variant="ghost"
            size="sm"
            className="flex-shrink-0 text-primary px-2"
            onClick={deactivateSearch}
          >
            Cancel
          </Button>
          <Input
            ref={inputRef}
            type="text"
            placeholder={searchPlaceholder}
            value={searchQuery}
            onChange={handleInputChange}
            className="flex-1 h-8 bg-background/30"
          />
          {onAdd && (
            <Button size="icon-sm" onClick={onAdd} className="flex-shrink-0">
              <Plus className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>
    </header>
  )
}
