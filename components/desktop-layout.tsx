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
  const { detailContent, hasDetailSupport } = useDetailPanel()

  if (!hasDetailSupport) {
    // Page doesn't support detail panel, show nothing
    return null
  }

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
  const { hasDetailSupport } = useDetailPanel()

  return (
    <div className="relative h-[100dvh] w-full flex bg-background overflow-hidden">
      {/* Sidebar toggle button - always visible */}
      <div className="absolute top-3 left-3 z-50">
        <SidebarToggle />
      </div>

      {/* Sidebar */}
      <SidebarNav />

      {/* Main content area */}
      <div className="flex-1 flex flex-col min-w-0">
        {hasDetailSupport ? (
          <ResizablePanelGroup direction="horizontal" className="h-full">
            <ResizablePanel defaultSize={50} minSize={30}>
              <div className="h-full overflow-auto">{children}</div>
            </ResizablePanel>
            <ResizableHandle withHandle />
            <ResizablePanel defaultSize={50} minSize={30}>
              <DetailPanelContent />
            </ResizablePanel>
          </ResizablePanelGroup>
        ) : (
          <div className="flex-1 overflow-auto">{children}</div>
        )}
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
