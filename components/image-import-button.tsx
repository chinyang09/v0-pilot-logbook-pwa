"use client"

import { useRef, useState } from "react"
import { Camera, Loader2, ImageIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  extractTextFromImage,
  extractFlightData,
  validateExtractedData,
  type ExtractedFlightData,
} from "@/lib/ocr"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Progress } from "@/components/ui/progress"
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
  const fileInputRef = useRef<HTMLInputElement>(null)
  const cameraInputRef = useRef<HTMLInputElement>(null)

  const processImage = async (file: File) => {
    setLoading(true)
    setShowDialog(true)
    setProgress({ percent: 5, stage: "Compressing", detail: "Resizing image..." })

    try {
      // Compress before OCR to prevent memory crashes on iPad/mobile
      const { compressImage } = await import("@/lib/utils/image-compress")
      const compressed = await compressImage(file, 2048, 0.8)

      // Extract with geometry
      setProgress({ percent: 10, stage: "Initializing", detail: "Loading OCR..." })
      setProgress({ percent: 40, stage: "Processing", detail: "Reading image..." })
      const ocrResults = await extractTextFromImage(compressed)

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

      await new Promise((r) => setTimeout(r, 600))
      onDataExtracted(flightData)
    } catch (error) {
      console.error("OCR failed:", error)
      setProgress({
        percent: 0,
        stage: "Error",
        detail: error instanceof Error ? error.message : "Processing failed",
      })
      await new Promise((r) => setTimeout(r, 2000))
    } finally {
      setLoading(false)
      setShowDialog(false)
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

      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button
            variant={variant}
            size={size}
            className={className}
            disabled={loading}
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="z-[60]">
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

      <Dialog open={showDialog} onOpenChange={() => {}}>
        <DialogContent className="sm:max-w-md" showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Processing Image</DialogTitle>
            <DialogDescription>{progress?.stage || "Extracting..."}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <Progress value={progress?.percent || 0} className="h-2" />
            <div className="flex justify-between text-sm text-muted-foreground">
              <span>{progress?.detail || ""}</span>
              <span>{progress?.percent || 0}%</span>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
