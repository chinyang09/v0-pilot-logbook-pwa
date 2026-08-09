"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import {
  SignatureCanvas,
  type SignatureCrewMember,
} from "@/components/signature-canvas";
import type { FlightSignature } from "@/types/entities/flight.types";
import { useDesktopPill, useIsDesktop } from "@/hooks/use-is-desktop";
import { useSidebar } from "@/hooks/use-sidebar-context";
import { useBackDismiss } from "@/hooks/use-back-dismiss";
import { SIDEBAR_WIDTH_PX } from "@/lib/layout/panel-widths";
import { cn } from "@/lib/utils";

/**
 * Signing, full screen.
 *
 * It used to be a 120px strip at the bottom of the flight form — the one place
 * in the app where the input is a drawing, squeezed into the height of a text
 * row and reached by scrolling past everything else. Signing is a deliberate
 * act at the end of a flight, so it gets the screen: pick who is signing, fill
 * in a licence if it is missing, and sign at whatever size the device offers.
 *
 * Orientation-agnostic by construction rather than by branching — the surface
 * simply fills what is left after the chrome, so turning the device sideways
 * gives a wide, short signing area (which is the natural shape for a signature)
 * and portrait gives a taller one. The stored strokes are normalised to their
 * own bounding box either way, so a signature drawn in one orientation renders
 * identically in the other.
 *
 * "Full screen" means WHAT IS LEFT AFTER THE CHROME, not `inset-0`. On a phone
 * those are the same thing — the dialog is above the bottom nav, so covering
 * the viewport is right. On a tablet they are not: `inset-0` put the signing
 * surface UNDER the sidebar and the nav pill, which draw above it, so on an
 * iPad the panel ran off behind the nav and the top of it was unreachable.
 *
 * So the surface takes the CONTENT REGION instead — the main panel plus the
 * detail panel:
 *
 *   • `top: --chrome-top` / `bottom: --chrome-bottom` — the same clearance
 *     every scroller in the app gets, so it starts below the action buttons
 *     (and the desktop nav pill, which sits between them) and ends on the same
 *     rest line as every list;
 *   • `left` steps across by the sidebar's width, but only while the sidebar is
 *     actually PUSHING (the ≥1120 tier). Below that the sidebar is an overlay
 *     that floats over the panels, so the content region is still the full
 *     width and the dialog should be too;
 *   • inset by `--panel-gutter` and rounded, because at that size it IS a
 *     panel — a square-cornered slab butted against the sidebar's glass edge
 *     reads as a clipping bug rather than a surface.
 *
 * The `left` transition matches `PushSidebar`'s, so the surface travels with
 * the content it is sitting in rather than snapping across after it.
 */
export function SignatureDialog({
  open,
  onClose,
  onSave,
  onClear,
  onLicenseUpdate,
  initialSignature,
  flightCrew,
}: {
  open: boolean;
  onClose: () => void;
  onSave: (signature: FlightSignature) => void;
  onClear: () => void;
  onLicenseUpdate?: (crewId: string, licenseNumber: string) => void;
  initialSignature?: FlightSignature | null;
  flightCrew: SignatureCrewMember[];
}) {
  const isDesktop = useIsDesktop();
  const canPushSidebar = useDesktopPill();
  const { isOpen: sidebarOpen } = useSidebar();

  // Escape is the desktop half of "get me out of here"; the system back gesture
  // is the other half, and this is full-screen — it must not be possible to
  // navigate the page out from under it.
  const dismiss = useBackDismiss(open, onClose);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && dismiss();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, dismiss]);

  if (!open || typeof document === "undefined") return null;

  const pushedBy = canPushSidebar && sidebarOpen ? SIDEBAR_WIDTH_PX : 0;
  const region: React.CSSProperties = isDesktop
    ? {
        top: "var(--chrome-top)",
        bottom: "var(--chrome-bottom)",
        left: `calc(${pushedBy}px + var(--panel-gutter))`,
        right: "var(--panel-gutter)",
        transition: "left 200ms cubic-bezier(0.25, 0.1, 0.25, 1)",
      }
    : { inset: 0 };

  // z-[65]: above the nav pill (60) and BELOW Radix's popper layer (70). At
  // z-[200] the crew `Select` opened *behind* the dialog, which is why picking
  // a signer looked broken and intermittent.
  return createPortal(
    <div
      style={region}
      className={cn(
        "fixed z-[65] flex flex-col bg-background",
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
        <h2 className="text-base font-semibold">Signature</h2>
        <button
          type="button"
          onClick={() => dismiss()}
          aria-label="Close"
          className="flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <div className="flex-1 min-h-0">
        <SignatureCanvas
          fill
          // Save is the CLOSE's follow-up so the marker history entry is
          // released before anything the save triggers can navigate.
          onSave={(sig) => dismiss(() => onSave(sig))}
          onClear={onClear}
          onLicenseUpdate={onLicenseUpdate}
          initialSignature={initialSignature}
          flightCrew={flightCrew}
        />
      </div>
    </div>,
    document.body
  );
}
