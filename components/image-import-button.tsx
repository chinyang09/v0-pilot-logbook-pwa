"use client"

import { useId, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { AnimatePresence } from "framer-motion"
import { MorphSurface, controlBox, menuHeight, placeOver, type Placement } from "@/components/ui/option-menu"
import { Camera, Images } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  extractTextFromImage,
  extractFlightData,
  validateExtractedData,
  warmOCR,
  type ExtractedFlightData,
} from "@/lib/ocr"
import { ImportStatusDialog } from "@/components/import/import-status-dialog"
import { useBackDismiss } from "@/hooks/use-back-dismiss"

interface ImageImportButtonProps {
  onDataExtracted: (data: ExtractedFlightData) => void
  variant?: "ghost" | "default" | "outline"
  size?: "sm" | "default" | "lg" | "icon" | "icon-sm"
  className?: string
}

export function ImageImportButton({
  onDataExtracted,
  variant = "ghost",
  size = "icon",
  className = "",
}: ImageImportButtonProps) {
  const [loading, setLoading] = useState(false)
  const [progress, setProgress] = useState<{ percent: number; stage: string; detail?: string } | null>(null)
  const [showDialog, setShowDialog] = useState(false)
  // A failed read stays on screen until it is dismissed. It used to show as
  // "Error" for two seconds and close itself — gone before it could be read.
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const cameraInputRef = useRef<HTMLInputElement>(null)
  const libraryInputRef = useRef<HTMLInputElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  // Where the source menu hangs, read off the button in the tap.
  const [menuAt, setMenuAt] = useState<Placement | null>(null)
  const ids = useId()
  const cameraId = `${ids}-camera`
  const libraryId = `${ids}-library`

  const processImage = async (file: File) => {
    setLoading(true)
    setErrorMsg(null)
    setShowDialog(true)
    setProgress({ percent: 30, stage: "Reading", detail: "Reading times..." })

    try {
      // Extract with geometry. The service caps the size itself — for an
      // upload it re-encodes at OCR_MAX_SIDE, on the device it decodes
      // straight to that size, without a JPEG round trip in between.
      const ocrResults = await extractTextFromImage(file)

      // Parse layout
      setProgress({ percent: 70, stage: "Analyzing", detail: "Extracting times..." })
      const flightData = extractFlightData(ocrResults)

      // Validate
      const validation = validateExtractedData(flightData)
      const pct = Math.round(flightData.confidence * 100)

      setProgress({
        percent: 100,
        stage: "Complete!",
        detail: `Confidence: ${pct}%${validation.issues.length ? ` (${validation.issues.length} warnings)` : ""}`,
      })

      if (validation.issues.length) {
        console.log("[OCR] Warnings:", validation.issues)
      }

      // Straight into the form — the filled rows ARE the confirmation. There
      // used to be a 600ms pause here to show "Complete!".
      onDataExtracted(flightData)
      setShowDialog(false)
    } catch (error) {
      console.error("OCR failed:", error)
      setErrorMsg(error instanceof Error ? error.message : "The photo couldn't be read.")
    } finally {
      setLoading(false)
      setProgress(null)
      for (const input of [cameraInputRef.current, libraryInputRef.current]) if (input) input.value = ""
    }
  }

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file?.type.startsWith("image/")) {
      await processImage(file)
    }
  }

  return (
    <>
      {/* TWO inputs, one per source. A single image input with no `capture`
          was meant to bring up the OS sheet offering both — and on iOS it
          does — but Android 14+ answers `image/*` with its Photo Picker,
          which has no camera: the pilot could only choose a photo. With
          `capture` the camera opens directly; without it, the library. */}
      <input
        id={cameraId}
        type="file"
        ref={cameraInputRef}
        className="hidden"
        accept="image/*"
        capture="environment"
        onChange={handleFileChange}
      />
      <input
        id={libraryId}
        type="file"
        ref={libraryInputRef}
        className="hidden"
        accept="image/*"
        onChange={handleFileChange}
      />
      <Button
        ref={buttonRef}
        variant={variant}
        size={size}
        className={className}
        disabled={loading}
        aria-label="Read times from a photo"
        aria-haspopup="menu"
        aria-expanded={menuAt !== null}
        // The press is the earliest sign a photo is coming: wake the engine
        // that will read it while the pilot is still taking it.
        onPointerDown={() => warmOCR()}
        onClick={() => {
          warmOCR()
          const el = buttonRef.current
          // The menu grows out of the button's capsule, its corner on the
          // capsule's (`controlBox`, `placeOver`) — two rows under a heading.
          if (el) {
            const { rect, hide } = controlBox(el)
            setMenuAt(placeOver(rect, menuHeight(2), 208, hide))
          }
        }}
      >
        {/* No spinner: the processing dialog covers this button and says
            what is happening, and a spinning icon behind it is a repaint
            every frame while the photo is being read. */}
        <Camera className="h-4 w-4" />
      </Button>
      <PhotoSourceMenu at={menuAt} cameraId={cameraId} libraryId={libraryId} onClosed={() => setMenuAt(null)} />

      {/* The app's one progress surface — the same dialog a report import
          shows — rather than a stock dialog with a bare progress bar. */}
      <ImportStatusDialog
        open={showDialog}
        onOpenChange={(open) => {
          if (!open && !loading) setShowDialog(false)
        }}
        progress={progress}
        errorMsg={errorMsg}
        summary={null}
        context="Photo"
        onDone={() => {
          setShowDialog(false)
          setErrorMsg(null)
        }}
      />
    </>
  )
}

/**
 * Camera or library — the app's own menu face (`.menu-surface`, 44px rows),
 * hung off the button. Each row is a LABEL for its input, so the picker opens
 * as the tap's own default action: iOS opens a file input only inside the
 * gesture, and the OptionMenu applies a choice after a history round trip,
 * which is outside it.
 */
function PhotoSourceMenu({
  at,
  cameraId,
  libraryId,
  onClosed,
}: {
  at: Placement | null
  cameraId: string
  libraryId: string
  onClosed: () => void
}) {
  const dismiss = useBackDismiss(at !== null, onClosed)
  if (typeof document === "undefined") return null
  // A label is not activated by Enter/Space, so the keyboard opens the input
  // itself — a key press is a gesture, so the browser allows it.
  const onKey = (inputId: string) => (e: React.KeyboardEvent) => {
    if (e.key !== "Enter" && e.key !== " ") return
    e.preventDefault()
    document.getElementById(inputId)?.click()
    dismiss()
  }
  const row =
    "relative z-[2] flex min-h-11 w-full cursor-pointer items-center gap-3 px-4 text-[15px] hover:bg-[var(--on-glass-fill-soft)] active:bg-[var(--on-glass-fill)]"
  return createPortal(
    <AnimatePresence>
      {at && (
        <>
          <div key="scrim" aria-hidden className="fixed inset-0 z-[200]" onPointerDown={(e) => (e.preventDefault(), dismiss())} />
          <MorphSurface
            key="menu"
            role="menu"
            label="Photo"
            placement={at}
            glyph={<Camera className="h-4 w-4" />}
            className="py-1.5"
            onKeyDown={(e) => e.key === "Escape" && dismiss()}
          >
            <div className="px-4 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Photo
            </div>
            <label htmlFor={cameraId} role="menuitem" tabIndex={0} className={row} onClick={() => dismiss()} onKeyDown={onKey(cameraId)}>
              <Camera className="h-4 w-4 text-muted-foreground" aria-hidden />
              Take Photo
            </label>
            <label htmlFor={libraryId} role="menuitem" tabIndex={0} className={row} onClick={() => dismiss()} onKeyDown={onKey(libraryId)}>
              <Images className="h-4 w-4 text-muted-foreground" aria-hidden />
              Choose Photo
            </label>
          </MorphSurface>
        </>
      )}
    </AnimatePresence>,
    document.body
  )
}
