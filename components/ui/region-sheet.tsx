"use client";

/**
 * A full-screen sheet over the CONTENT region — the app's form dialog.
 *
 * "Full screen" means the content region, not `inset-0`. On a phone they are
 * the same thing; on a tablet the sidebar and the nav pill draw above the
 * panels, so an `inset-0` surface sat BEHIND them with its top unreachable.
 * It takes the main panel plus the detail panel instead, stepped across by
 * the sidebar only while the sidebar is actually PUSHING (below 1120 it
 * overlays full-width panels, so the region has not moved).
 *
 * `useContentRegionStyle` is the bounds on their own, for a surface with its
 * own body (the signature pad); `RegionSheet` is the whole form shell — header
 * with a close button, a scrolling body of `FormSection`s, a footer.
 */

import { useEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

import { useDesktopPill, useIsDesktop } from "@/hooks/use-is-desktop";
import { useSidebar } from "@/hooks/use-sidebar-context";
import { SIDEBAR_WIDTH_PX } from "@/lib/layout/panel-widths";
import { cn } from "@/lib/utils";

export function useContentRegionStyle(): {
  style: React.CSSProperties;
  isDesktop: boolean;
} {
  const isDesktop = useIsDesktop();
  const canPushSidebar = useDesktopPill();
  const { isOpen: sidebarOpen } = useSidebar();
  const style = useMemo<React.CSSProperties>(() => {
    const pushedBy = canPushSidebar && sidebarOpen ? SIDEBAR_WIDTH_PX : 0;
    return isDesktop
      ? {
          top: "calc(var(--install-banner-height) + var(--chrome-top))",
          bottom: "var(--chrome-bottom)",
          left: `calc(${pushedBy}px + var(--panel-gutter))`,
          right: "var(--panel-gutter)",
          // Travels with the content as the sidebar pushes it, rather than
          // snapping across after it (PushSidebar's own transition).
          transition: "left 200ms cubic-bezier(0.25, 0.1, 0.25, 1)",
        }
      : { top: "var(--install-banner-height)", left: 0, right: 0, bottom: 0 };
  }, [isDesktop, canPushSidebar, sidebarOpen]);
  return { style, isDesktop };
}

/**
 * z-[110]: above the app chrome (header z-99, nav pill z-100) and BELOW Radix's
 * popper layer (z-150), so a Select inside still opens in front. At z-[200] a
 * Select opened behind the sheet; at z-[65] the nav pill covered its footer.
 */
export const REGION_SHEET_CLASS = "fixed z-[110] flex flex-col bg-background";

export function RegionSheet({
  titleId,
  title,
  onDismiss,
  footer,
  children,
}: {
  titleId: string;
  title: React.ReactNode;
  /** The caller's `useBackDismiss` dismiss — Escape and the X go through it. */
  onDismiss: () => void;
  footer: React.ReactNode;
  children: React.ReactNode;
}) {
  const { style, isDesktop } = useContentRegionStyle();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onDismiss();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onDismiss]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      style={style}
      className={cn(
        REGION_SHEET_CLASS,
        isDesktop && "rounded-2xl border border-border overflow-hidden shadow-2xl"
      )}
    >
      <div
        className={cn(
          "flex items-center justify-between px-4 h-14 flex-shrink-0 border-b border-border",
          // The safe-area inset belongs to a surface that reaches the screen
          // edge; inside the content region the chrome offset already carries it.
          !isDesktop && "pt-safe"
        )}
      >
        <h2 id={titleId} className="text-base font-semibold">
          {title}
        </h2>
        <button
          type="button"
          onClick={() => onDismiss()}
          aria-label="Close"
          className="flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain scrollbar-hide px-panel py-4 space-y-4">
        {children}
      </div>

      <div
        className={cn(
          "flex items-center justify-end gap-2 px-4 h-16 flex-shrink-0 border-t border-border",
          !isDesktop && "pb-safe"
        )}
      >
        {footer}
      </div>
    </div>,
    document.body
  );
}
