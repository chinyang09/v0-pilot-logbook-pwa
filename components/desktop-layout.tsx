"use client"

import type React from "react"
import { SidebarNav, SidebarToggle } from "@/components/sidebar-nav"
import { SidebarProvider } from "@/hooks/use-sidebar-context"
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable"

interface DesktopLayoutProps {
  children: React.ReactNode
  detail?: React.ReactNode
}

function DesktopLayoutContent({ children, detail }: DesktopLayoutProps) {
  const hasDetail = detail !== null && detail !== undefined

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
        {hasDetail ? (
          <ResizablePanelGroup direction="horizontal" className="h-full">
            <ResizablePanel defaultSize={50} minSize={30}>
              <div className="h-full overflow-hidden">{children}</div>
            </ResizablePanel>
            <ResizableHandle withHandle />
            <ResizablePanel defaultSize={50} minSize={30}>
              <div className="h-full overflow-hidden">{detail}</div>
            </ResizablePanel>
          </ResizablePanelGroup>
        ) : (
          <div className="flex-1 overflow-hidden">{children}</div>
        )}
      </div>
    </div>
  )
}

export function DesktopLayout({ children, detail }: DesktopLayoutProps) {
  return (
    <SidebarProvider defaultOpen={true}>
      <DesktopLayoutContent detail={detail}>{children}</DesktopLayoutContent>
    </SidebarProvider>
  )
}
