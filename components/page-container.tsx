"use client"

import { ReactNode, useCallback, useState, type RefCallback, type UIEvent } from "react"
import { usePathname } from "next/navigation"
import { useScrollRestoration } from "@/hooks/use-scroll-restoration"
import { cn } from "@/lib/utils"
import { ScrollIndicator } from "@/components/ui/scroll-indicator"
import { useCollapsingTitle } from "@/hooks/use-collapsing-title"

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
  /**
   * The page's name, as a large title at the top of the main panel — the
   * same place a detail panel names what it shows. Pages reachable only from
   * the sidebar named themselves NOWHERE: on Account, Settings or Recently
   * Deleted no nav tab lights up either, so nothing on screen said where you
   * were. The logbook and the dashboard go without: their first row is
   * already their own (the floating search/calendar stack, the Legal/Summary
   * switch). Scrolled under the header it is carried ON the header, small
   * (`useCollapsingTitle`), so the page is never left unnamed.
   */
  title?: string
}

export function PageContainer({ children, header, className, rightContent, mainRef, scrollRestoreKey, title }: PageContainerProps) {
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

  const { titleRef, spacerRef, onScroll: onScrollTitle } = useCollapsingTitle(mountPathname, title)
  const handleScroll = useCallback(
    (e: UIEvent<HTMLElement>) => {
      onScrollSave(e)
      onScrollTitle(e)
    },
    [onScrollSave, onScrollTitle]
  )

  // Compose the scroll-restoration ref with the optional external mainRef.
  const setMainRef = useCallback<RefCallback<HTMLElement>>(
    (node) => {
      scrollRestoreRef(node)
      mainRef?.(node)
    },
    [scrollRestoreRef, mainRef]
  )

  return (
    <div className="h-full relative flex flex-col">
      {header && <div className="absolute top-0 left-0 right-0 z-50">{header}</div>}

      <main
        ref={setMainRef}
        onScroll={handleScroll}
        // scrollbar-hide: the native overlay indicator spans the scroller's
        // full box, i.e. from the screen edge over the status bar — the inset
        // ScrollIndicator below replaces it, running from under the action
        // buttons like a native scroll view's.
        className={cn("flex-1 overflow-y-auto overscroll-contain scrollbar-hide", className)}
      >
        <ScrollIndicator />
        {/* Spacers, not padding on the scroller. A scroll container's
            `padding-bottom` is historically dropped from its scrollable area in
            WebKit, which strands the last row under the nav pill; an in-flow
            element is always counted. The top one keeps the first row clear of
            the floating header + status bar, and content slides under both. */}
        <div ref={spacerRef} className={header ? "h-chrome-top-sm" : "h-chrome-top"} />
        {title && (
          <h1 ref={titleRef} className="px-panel pt-4 text-[1.75rem] font-bold leading-tight tracking-tight">{title}</h1>
        )}
        {children}
        <div className="h-chrome-bottom" />
      </main>

        {/* Right content (e.g., FastScroll) positioned relative to viewport, not scrolling content */}
        {rightContent && (
          <div
            className="absolute right-1 bottom-0 z-40 flex items-center pointer-events-none"
            // Below the floating header, status bar included — a bare top-16
            // started the rail underneath it once the app went edge to edge.
            style={{ top: header ? "var(--chrome-top-sm)" : "var(--chrome-top)" }}
          >
            <div className="pointer-events-auto">
              {rightContent}
            </div>
          </div>
        )}
    </div>
  )
}
