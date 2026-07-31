"use client"

import { ReactNode, useCallback, useState, type RefCallback, type UIEvent } from "react"
import { usePathname } from "next/navigation"
import { useScrollNavbarContext } from "@/hooks/use-scroll-navbar-context"
import { useScrollRestoration } from "@/hooks/use-scroll-restoration"
import { cn } from "@/lib/utils"

interface PageContainerProps {
  children: ReactNode
  /** Optional inline header (used by mobile-only record/form pages) */
  header?: ReactNode
  className?: string
  /** Content to render on the right side, positioned relative to the viewport (e.g., FastScroll) */
  rightContent?: ReactNode
  /** Optional ref callback to access the main scroll container element */
  mainRef?: RefCallback<HTMLElement>
  /**
   * Optional override for the scroll-restoration key. Defaults to the route
   * pathname. Pass null to disable restoration for this page.
   */
  scrollRestoreKey?: string | null
}

export function PageContainer({ children, header, className, rightContent, mainRef, scrollRestoreKey }: PageContainerProps) {
  const { handleScroll } = useScrollNavbarContext()
  const pathname = usePathname()

  // Freeze the pathname captured at mount as the default scroll key. Keep-alive
  // pages stay mounted while the global pathname changes, so reading the live
  // pathname would let a hidden page adopt another route's key and cross-
  // contaminate saved scroll positions. A non-keep-alive page re-mounts on each
  // navigation, so it naturally captures its own route here.
  const [mountPathname] = useState(pathname)

  // Remember/restore this page's scroll position across navigation (resets on PWA close).
  const restoreKey = scrollRestoreKey === undefined ? mountPathname : scrollRestoreKey
  const { ref: scrollRestoreRef, onScroll: onScrollSave } = useScrollRestoration(restoreKey)

  // Compose the scroll-restoration ref with the optional external mainRef.
  const setMainRef = useCallback<RefCallback<HTMLElement>>(
    (node) => {
      scrollRestoreRef(node)
      mainRef?.(node)
    },
    [scrollRestoreRef, mainRef]
  )

  // Compose the navbar scroll handler with the scroll-position saver.
  const onMainScroll = useCallback(
    (e: UIEvent<HTMLElement>) => {
      handleScroll(e)
      onScrollSave(e)
    },
    [handleScroll, onScrollSave]
  )

  return (
    <div className="h-full relative flex flex-col">
      {header && <div className="absolute top-0 left-0 right-0 z-50">{header}</div>}

      <main
        ref={setMainRef}
        onScroll={onMainScroll}
        className={cn("flex-1 overflow-y-auto overscroll-contain", header ? "pt-chrome-sm" : "pt-chrome", className)}
      >
        <div className="pb-24">
          {children}
        </div>
      </main>

        {/* Right content (e.g., FastScroll) positioned relative to viewport, not scrolling content */}
        {rightContent && (
          <div className={cn("absolute right-1 bottom-0 z-40 flex items-center pointer-events-none", header ? "top-12" : "top-16")}>
            <div className="pointer-events-auto">
              {rightContent}
            </div>
          </div>
        )}
    </div>
  )
}
