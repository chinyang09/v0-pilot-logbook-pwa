"use client"

import type React from "react"
import { Suspense } from "react"
import { ScrollNavbarProvider } from "@/hooks/use-scroll-navbar-context"
import { SidebarProvider } from "@/hooks/use-sidebar-context"
import { DetailPanelProvider } from "@/hooks/use-detail-panel"
import { PageActionsProvider } from "@/hooks/use-page-actions"
import { PreferencesProvider } from "@/components/providers/preferences-provider"
import { useDraftGenerator } from "@/hooks/use-draft-generator"
import { AppShell } from "@/components/desktop-layout"
import { KeepAlivePages } from "@/components/keep-alive-pages"

function AppLayoutContent({ children }: { children: React.ReactNode }) {
  // Background draft generation
  useDraftGenerator()

  return (
    <AppShell>
      <KeepAlivePages>{children}</KeepAlivePages>
    </AppShell>
  )
}

/**
 * App layout — providers + responsive shell.
 *
 * SidebarProvider and DetailPanelProvider are always mounted so that
 * state (selected flight, sidebar open/closed) survives breakpoint
 * transitions. The shell itself uses CSS visibility classes (hidden md:flex,
 * md:hidden) to show/hide desktop vs mobile elements without destroying
 * the React tree.
 */
export default function AppLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <PreferencesProvider>
      <ScrollNavbarProvider>
        <SidebarProvider defaultOpen={false}>
          <Suspense>
            <DetailPanelProvider>
              <PageActionsProvider>
                <AppLayoutContent>{children}</AppLayoutContent>
              </PageActionsProvider>
            </DetailPanelProvider>
          </Suspense>
        </SidebarProvider>
      </ScrollNavbarProvider>
    </PreferencesProvider>
  )
}
