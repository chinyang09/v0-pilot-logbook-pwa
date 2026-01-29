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
      <div className="flex-1 flex min-w-0">
        <ResizablePanelGroup direction="horizontal" className="h-full">
          <ResizablePanel defaultSize={50} minSize={25}>
            <div className="h-full flex flex-col overflow-hidden min-w-[375px]">{children}</div>
          </ResizablePanel>
          <ResizableHandle withHandle />
          <ResizablePanel defaultSize={50} minSize={30}>
            <DetailPanelContent />
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>

      {/* Sidebar toggle button - placed last to render on top */}
      <div className="absolute top-3 left-3 z-[100] mt-safe">
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
