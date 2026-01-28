"use client"

import type React from "react"
import { BottomNavbar } from "@/components/bottom-navbar"
import { PWAInstallPrompt } from "@/components/pwa-install-prompt"
import { ScrollNavbarProvider, useScrollNavbarContext } from "@/hooks/use-scroll-navbar-context"
import { useDraftGenerator } from "@/hooks/use-draft-generator"
import { useIsDesktop } from "@/hooks/use-is-desktop"
import { DesktopLayout } from "@/components/desktop-layout"
import { cn } from "@/lib/utils"

interface AppLayoutContentProps {
  children: React.ReactNode
  detail: React.ReactNode
}

function MobileLayoutContent({ children }: { children: React.ReactNode }) {
  const { hideNavbar } = useScrollNavbarContext()

  return (
    <div className="relative h-[100dvh] w-full flex flex-col bg-background overflow-hidden pt-safe">
      {children}

      <div className={cn(
        "fixed bottom-0 left-0 right-0 z-50 transition-transform duration-300 ease-in-out lg:hidden",
        hideNavbar ? "translate-y-full" : "translate-y-0"
      )}>
        <BottomNavbar />
      </div>

      <PWAInstallPrompt />
    </div>
  )
}

function AppLayoutContent({ children, detail }: AppLayoutContentProps) {
  const isDesktop = useIsDesktop()

  // Background draft generation
  useDraftGenerator()

  // On desktop, use the desktop layout with sidebar and detail panel
  if (isDesktop) {
    return (
      <DesktopLayout detail={detail}>
        {children}
      </DesktopLayout>
    )
  }

  // On mobile, use the mobile layout with bottom navbar
  return <MobileLayoutContent>{children}</MobileLayoutContent>
}

/**
 * App layout - provides scroll-based navbar hiding via context
 * Individual pages handle their own headers
 *
 * On mobile (< 1024px): Bottom navbar with single-column layout
 * On desktop (>= 1024px): Sidebar navigation with optional detail panel
 */
export default function AppLayout({
  children,
  detail,
}: {
  children: React.ReactNode
  detail: React.ReactNode
}) {
  return (
    <ScrollNavbarProvider>
      <AppLayoutContent detail={detail}>{children}</AppLayoutContent>
    </ScrollNavbarProvider>
  )
}
