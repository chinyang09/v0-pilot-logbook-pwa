"use client"

import { useRef, useState } from "react"
import { Camera, ImageIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  extractTextFromImage,
  extractFlightData,
  validateExtractedData,
  warmOCR,
  type ExtractedFlightData,
} from "@/lib/ocr"
import { ImportStatusDialog } from "@/components/import/import-status-dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

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
  const fileInputRef = useRef<HTMLInputElement>(null)
  const cameraInputRef = useRef<HTMLInputElement>(null)

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
      if (fileInputRef.current) fileInputRef.current.value = ""
      if (cameraInputRef.current) cameraInputRef.current.value = ""
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
      <input
        type="file"
        id="ocr-file-input"
        ref={fileInputRef}
        className="hidden"
        accept="image/*"
        onChange={handleFileChange}
      />
      <input
        type="file"
        id="ocr-camera-input"
        ref={cameraInputRef}
        className="hidden"
        accept="image/*"
        capture="environment"
        onChange={handleFileChange}
      />

      {/* Opening the menu is the earliest sign a photo is coming: wake the
          engine that will read it while the pilot is still taking it. */}
      <DropdownMenu modal={false} onOpenChange={(open) => { if (open) warmOCR() }}>
        <DropdownMenuTrigger asChild>
          <Button
            variant={variant}
            size={size}
            className={className}
            disabled={loading}
            aria-label="Read times from a photo"
          >
            {/* No spinner: the processing dialog covers this button and says
                what is happening, and a spinning icon behind it is a repaint
                every frame while the photo is being read. */}
            <Camera className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem asChild>
            <label htmlFor="ocr-camera-input" className="flex items-center cursor-pointer">
              <Camera className="mr-2 h-4 w-4" />
              Take Photo
            </label>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <label htmlFor="ocr-file-input" className="flex items-center cursor-pointer">
              <ImageIcon className="mr-2 h-4 w-4" />
              Choose from Gallery
            </label>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

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
