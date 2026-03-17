"use client"

import { ReactNode, type RefCallback } from "react"
import { useScrollNavbarContext } from "@/hooks/use-scroll-navbar-context"
import { useIsDesktop } from "@/hooks/use-is-desktop"
import { cn } from "@/lib/utils"

interface PageContainerProps {
  children: ReactNode
  header?: ReactNode
  className?: string
  /** Content to render on the right side, positioned relative to the viewport (e.g., FastScroll) */
  rightContent?: ReactNode
  /** Optional ref callback to access the main scroll container element */
  mainRef?: RefCallback<HTMLElement>
}

export function PageContainer({ children, header, className, rightContent, mainRef }: PageContainerProps) {
  const { handleScroll } = useScrollNavbarContext()
  const isDesktop = useIsDesktop()

  return (
    <div className="h-full relative flex flex-col">
      {header && <div className="absolute top-0 left-0 right-0 z-50">{header}</div>}

      <main
        ref={mainRef}
        onScroll={handleScroll}
        className={cn("flex-1 overflow-y-auto overscroll-contain", header && "pt-12", className)}
      >
        <div className="pb-24">
          {children}
        </div>
      </main>

        {/* Right content (e.g., FastScroll) positioned relative to viewport, not scrolling content */}
        {rightContent && (
          <div className={cn("absolute right-1 bottom-0 z-40 flex items-center pointer-events-none", header ? "top-12" : "top-0")}>
            <div className="pointer-events-auto">
              {rightContent}
            </div>
          </div>
        )}
    </div>
  )
}
