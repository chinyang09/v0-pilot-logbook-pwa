"use client"

import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { SyncStatus } from "@/components/sync-status"
import { ArrowLeft } from "lucide-react"
import type React from "react"
import { cn } from "@/lib/utils"

export interface StandardPageHeaderProps {
  /** Page title (string or ReactNode for dynamic titles) */
  title: React.ReactNode
  /** Show back button */
  showBack?: boolean
  /** Custom back handler (defaults to router.back()) */
  onBack?: () => void
  /** Additional actions to render on the right (before SyncStatus) */
  actions?: React.ReactNode
  /** Show sync status (default: true) */
  showSyncStatus?: boolean
  /** Additional className for the header */
  className?: string
}

export function StandardPageHeader({
  title,
  showBack = false,
  onBack,
  actions,
  showSyncStatus = true,
  className,
}: StandardPageHeaderProps) {
  const router = useRouter()

  const handleBack = () => {
    if (onBack) {
      onBack()
    } else {
      router.back()
    }
  }

  return (
    <header className={cn(
      "flex-none h-12 bg-background/80 backdrop-blur-xl border-b border-border/50 z-50",
      className
    )}>
      <div className="flex items-center justify-between h-full px-4 pl-12">
        <div className="flex items-center gap-2 min-w-0">
          {showBack && (
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={handleBack}
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
          )}
          <h1 className="text-lg font-semibold text-foreground truncate">{title}</h1>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {actions}
          {showSyncStatus && <SyncStatus />}
        </div>
      </div>
    </header>
  )
}
