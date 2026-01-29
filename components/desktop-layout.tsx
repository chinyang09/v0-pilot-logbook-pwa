"use client"

import type React from "react"
import { SidebarNav, SidebarToggle } from "@/components/sidebar-nav"
import { SidebarProvider } from "@/hooks/use-sidebar-context"
import { DetailPanelProvider, useDetailPanel } from "@/hooks/use-detail-panel"
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable"

interface DesktopLayoutProps {
  children: React.ReactNode
}

function DetailPanelContent() {
  const { detailContent } = useDetailPanel()

  return (
    <div className="h-full overflow-auto bg-background">
      {detailContent || (
        <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
          <p>Select an item to view details</p>
        </div>
      )}
    </div>
  )
}

function DesktopLayoutContent({ children }: DesktopLayoutProps) {
  return (
    <div className="relative h-[100dvh] w-full flex bg-background overflow-hidden pt-safe">
      {/* Sidebar */}
      <SidebarNav />

      {/* Main content area - always show with detail panel */}
      <div className="flex-1 flex min-w-0 overflow-x-auto">
        <ResizablePanelGroup direction="horizontal" className="h-full min-w-[750px]">
          <ResizablePanel defaultSize={50} minSize={30} style={{ minWidth: "375px" }}>
            <div className="h-full flex flex-col overflow-hidden">{children}</div>
          </ResizablePanel>
          <ResizableHandle withHandle />
          <ResizablePanel defaultSize={50} minSize={25}>
            <DetailPanelContent />
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>

      {/* Sidebar toggle button - positioned to align with sidebar header */}
      <div className="absolute left-3 z-[100] top-[calc(env(safe-area-inset-top)+0.875rem)]">
        <SidebarToggle />
      </div>
    </div>
  )
}

export function DesktopLayout({ children }: DesktopLayoutProps) {
  return (
    <SidebarProvider defaultOpen={true}>
      <DetailPanelProvider>
        <DesktopLayoutContent>{children}</DesktopLayoutContent>
      </DetailPanelProvider>
    </SidebarProvider>
  )
}
