"use client"

import { ReactNode } from "react"
import { useScrollNavbarContext } from "@/hooks/use-scroll-navbar-context"
import { cn } from "@/lib/utils"

interface PageContainerProps {
  children: ReactNode
  header?: ReactNode
  className?: string
}

export function PageContainer({ children, header, className }: PageContainerProps) {
  const { handleScroll } = useScrollNavbarContext()

  return (
    <>
      {header && <div className="flex-none z-50">{header}</div>}

      <main
        onScroll={handleScroll}
        className={cn("flex-1 overflow-y-auto overscroll-contain", className)}
      >
        <div className="pb-24">
          {children}
        </div>
      </main>
    </>
  )
}
