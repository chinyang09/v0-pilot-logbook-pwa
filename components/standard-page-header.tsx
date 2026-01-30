"use client"

import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { SyncStatus } from "@/components/sync-status"
import { ArrowLeft } from "lucide-react"
import type React from "react"

export interface StandardPageHeaderProps {
  /** Page title */
  title: string
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
    <header className={`flex-none bg-background/30 backdrop-blur-xl border-b border-border/50 z-50 ${className || ""}`}>
      <div className="container mx-auto px-3">
        {/* Always add pl-10 padding to avoid overlap with sidebar toggle button */}
        <div className="flex items-center justify-between h-12 pl-10">
          <div className="flex items-center gap-2">
            {showBack && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleBack}
                className="h-8 w-8 p-0"
              >
                <ArrowLeft className="h-4 w-4" />
              </Button>
            )}
            <h1 className="text-lg font-semibold text-foreground">{title}</h1>
          </div>
          <div className="flex items-center gap-2">
            {actions}
            {showSyncStatus && <SyncStatus />}
          </div>
        </div>
      </div>
    </header>
  )
}
