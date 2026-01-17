"use client"

import type React from "react"
import { BottomNavbar } from "@/components/bottom-navbar"
import { PWAInstallPrompt } from "@/components/pwa-install-prompt"
import { ScrollNavbarProvider, useScrollNavbarContext } from "@/hooks/use-scroll-navbar-context"
import { useDraftGenerator } from "@/hooks/use-draft-generator"
import { cn } from "@/lib/utils"

function AppLayoutContent({ children }: { children: React.ReactNode }) {
  const { hideNavbar } = useScrollNavbarContext()

  // Background draft generation
  useDraftGenerator()

  return (
    <div className="relative h-[100dvh] w-full flex flex-col bg-background overflow-hidden">
      {children}

      <div className={cn(
        "fixed bottom-0 left-0 right-0 z-50 transition-transform duration-300 ease-in-out",
        hideNavbar ? "translate-y-full" : "translate-y-0"
      )}>
        <BottomNavbar />
      </div>

      <PWAInstallPrompt />
    </div>
  )
}

/**
 * App layout - provides scroll-based navbar hiding via context
 * Individual pages handle their own headers
 */
export default function AppLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <ScrollNavbarProvider>
      <AppLayoutContent>{children}</AppLayoutContent>
    </ScrollNavbarProvider>
  )
}
