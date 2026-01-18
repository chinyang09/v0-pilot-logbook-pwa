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
  size?: "sm" | "default" | "lg" | "icon"
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
    setProgress({ percent: 10, stage: "Initializing", detail: "Loading OCR..." })

    try {
      // Extract with geometry
      setProgress({ percent: 40, stage: "Processing", detail: "Reading image..." })
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
        ref={fileInputRef}
        className="hidden"
        accept="image/*"
        onChange={handleFileChange}
      />
      <input
        type="file"
        ref={cameraInputRef}
        className="hidden"
        accept="image/*"
        capture="environment"
        onChange={handleFileChange}
      />

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant={variant}
            size={size}
            className={size === "icon" ? "h-9 w-9" : className}
            disabled={loading}
          >
            {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Camera className="h-5 w-5" />}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => cameraInputRef.current?.click()}>
            <Camera className="mr-2 h-4 w-4" />
            Take Photo
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => fileInputRef.current?.click()}>
            <ImageIcon className="mr-2 h-4 w-4" />
            Choose from Gallery
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
