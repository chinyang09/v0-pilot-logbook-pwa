"use client"

import { ReactNode } from "react"
import { useScrollNavbar } from "@/hooks/use-scroll-navbar"
import { BottomNavbar } from "./bottom-navbar"
import { PWAInstallPrompt } from "./pwa-install-prompt"
import { cn } from "@/lib/utils"

interface PageContainerProps {
  children: ReactNode
  header?: ReactNode
  className?: string
}

export function PageContainer({ children, header, className }: PageContainerProps) {
  const { hideNavbar, handleScroll } = useScrollNavbar()

  return (
    <div className="relative h-[100dvh] w-full flex flex-col bg-background overflow-hidden">
      {header && <div className="flex-none z-50">{header}</div>}
      
      <main 
        onScroll={handleScroll} 
        className={cn("flex-1 overflow-y-auto", className)}
      >
        <div className="pb-24">
          {children}
        </div>
      </main>

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
