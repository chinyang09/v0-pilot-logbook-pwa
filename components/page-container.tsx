"use client"

import { ReactNode } from "react"
import { useScrollNavbarContext } from "@/hooks/use-scroll-navbar-context"
import { cn } from "@/lib/utils"

interface PageContainerProps {
  children: ReactNode
  header?: ReactNode
  className?: string
  /** Content to render on the right side, positioned relative to the viewport (e.g., FastScroll) */
  rightContent?: ReactNode
}

export function PageContainer({ children, header, className, rightContent }: PageContainerProps) {
  const { handleScroll } = useScrollNavbarContext()

  return (
    <>
      {header && <div className="flex-none z-50">{header}</div>}

      <div className="flex-1 relative flex overflow-hidden">
        <main
          onScroll={handleScroll}
          className={cn("flex-1 overflow-y-auto overscroll-contain", className)}
        >
          <div className="pb-24">
            {children}
          </div>
        </main>

        {/* Right content (e.g., FastScroll) positioned relative to viewport, not scrolling content */}
        {rightContent && (
          <div className="absolute right-0 top-0 bottom-0 z-40 flex items-center pointer-events-none">
            <div className="pointer-events-auto">
              {rightContent}
            </div>
          </div>
        )}
      </div>
    </>
  )
}
