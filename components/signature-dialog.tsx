"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import {
  SignatureCanvas,
  type SignatureCrewMember,
} from "@/components/signature-canvas";
import type { FlightSignature } from "@/types/entities/flight.types";

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
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-[200] flex flex-col bg-background">
      <div className="flex items-center justify-between px-4 pt-safe h-14 flex-shrink-0 border-b border-border">
        <h2 className="text-base font-semibold">Signature</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <div className="flex-1 min-h-0">
        <SignatureCanvas
          fill
          onSave={(sig) => {
            onSave(sig);
            onClose();
          }}
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
