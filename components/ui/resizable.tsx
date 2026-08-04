"use client"

import { ChevronLeft, ChevronRight } from "lucide-react"
import * as ResizablePrimitive from "react-resizable-panels"

import { cn } from "@/lib/utils"

const ResizablePanelGroup = ({
  className,
  ...props
}: React.ComponentProps<typeof ResizablePrimitive.PanelGroup>) => (
  <ResizablePrimitive.PanelGroup
    className={cn(
      "flex h-full w-full data-[panel-group-direction=vertical]:flex-col",
      className
    )}
    {...props}
  />
)

const ResizablePanel = ResizablePrimitive.Panel

/**
 * The divider between the main and detail panels.
 *
 * `toggle` turns it into a TWO-POSITION control rather than a drag handle.
 * The main panel only ever has two useful widths — one calendar month or two
 * — and a free drag always ended snapped to one of them anyway; on the way
 * there the calendar grew continuously and flipped its layout mid-gesture,
 * which read as the panel breaking rather than resizing. With a toggle the
 * width changes in one step and the calendar switches with it.
 */
const ResizableHandle = ({
  withHandle,
  className,
  toggle,
  toggleLabel,
  toggleActive,
  ...props
}: React.ComponentProps<typeof ResizablePrimitive.PanelResizeHandle> & {
  withHandle?: boolean
  /** Present = the divider is a two-position toggle, not a drag handle. */
  toggle?: () => void
  toggleLabel?: string
  /** True when the panel is at its WIDE position (chevron points to collapse). */
  toggleActive?: boolean
}) => (
  <ResizablePrimitive.PanelResizeHandle
    className={cn(
      "relative flex w-px items-center justify-center bg-border focus-visible:outline-none data-[panel-group-direction=vertical]:h-px data-[panel-group-direction=vertical]:w-full",
      // Only a real drag handle should advertise a resize cursor.
      toggle ? "cursor-default" : undefined,
      className
    )}
    {...props}
  >
    {toggle && (
      <button
        type="button"
        onClick={toggle}
        aria-label={toggleLabel}
        className="z-10 flex h-10 w-5 items-center justify-center rounded-full border border-border bg-card text-muted-foreground transition-colors hover:text-foreground"
      >
        {toggleActive ? (
          <ChevronLeft className="h-3.5 w-3.5" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5" />
        )}
      </button>
    )}
  </ResizablePrimitive.PanelResizeHandle>
)

export { ResizablePanelGroup, ResizablePanel, ResizableHandle }
