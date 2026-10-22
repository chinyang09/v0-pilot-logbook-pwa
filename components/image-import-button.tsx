"use client"

import { useRef, useState } from "react"
import { Camera } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  extractTextFromImage,
  extractFlightData,
  validateExtractedData,
  warmOCR,
  type ExtractedFlightData,
} from "@/lib/ocr"
import { ImportStatusDialog } from "@/components/import/import-status-dialog"

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
      {/* ONE image input, no `capture`: the operating system's own sheet
          offers the camera and the library (iOS: Take Photo / Photo Library;
          Android: Camera / Files). An in-app "Take Photo / Choose from
          Gallery" dropdown in front of it was a web menu restating that
          sheet, and a second tap before the camera. */}
      <input
        type="file"
        ref={fileInputRef}
        className="hidden"
        accept="image/*"
        onChange={handleFileChange}
      />
      <Button
        variant={variant}
        size={size}
        className={className}
        disabled={loading}
        aria-label="Read times from a photo"
        // The press is the earliest sign a photo is coming: wake the engine
        // that will read it while the pilot is still taking it.
        onPointerDown={() => warmOCR()}
        onClick={() => {
          warmOCR()
          fileInputRef.current?.click()
        }}
      >
        {/* No spinner: the processing dialog covers this button and says
            what is happening, and a spinning icon behind it is a repaint
            every frame while the photo is being read. */}
        <Camera className="h-4 w-4" />
      </Button>

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
