"use client";

import type React from "react";
import { useRef, useState } from "react";
import { Camera, Loader2, ImageIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { type ExtractedFlightData } from "@/lib/ocr/oooi-extractor";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface ImportProgress {
  percent: number;
  stage: string;
  detail?: string;
}

interface ImageImportButtonProps {
  onDataExtracted: (data: ExtractedFlightData) => void;
  variant?: "ghost" | "default" | "outline";
  size?: "sm" | "default" | "lg" | "icon";
  className?: string;
}

export function ImageImportButton({
  onDataExtracted,
  variant = "ghost",
  size = "icon",
  className = ""
}: ImageImportButtonProps) {
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [showDialog, setShowDialog] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  const processImage = async (file: File) => {
    setLoading(true);
    setShowDialog(true);
    setProgress({ percent: 0, stage: "Starting", detail: "Preparing image..." });

    try {
      // Step 1: Prepare form data
      setProgress({ percent: 10, stage: "Uploading", detail: "Sending image to server..." });
      const formData = new FormData();
      formData.append("image", file);

      // Step 2: Send to server-side OCR API
      setProgress({ percent: 30, stage: "Processing", detail: "Extracting text from image..." });
      const response = await fetch("/api/ocr/oooi", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Server error: ${response.status}`);
      }

      // Step 3: Parse response
      setProgress({ percent: 70, stage: "Analyzing", detail: "Processing flight data..." });
      const result = await response.json();

      if (!result.success) {
        throw new Error(result.error || "Failed to extract text from image");
      }

      const flightData: ExtractedFlightData = result.data;

      // Step 4: Complete
      setProgress({
        percent: 100,
        stage: "Complete!",
        detail: `Confidence: ${Math.round(flightData.confidence * 100)}%`,
      });

      // Wait a moment to show success message
      await new Promise((resolve) => setTimeout(resolve, 800));

      // Pass extracted data to parent
      onDataExtracted(flightData);

    } catch (error) {
      console.error("OCR processing failed", error);
      const errorMessage =
        error instanceof Error ? error.message : "Failed to process image";

      setProgress({
        percent: 0,
        stage: "Error",
        detail: errorMessage,
      });

      // Keep error visible longer
      await new Promise((resolve) => setTimeout(resolve, 3000));
    } finally {
      setLoading(false);
      setShowDialog(false);
      setProgress(null);

      // Reset file inputs
      if (fileInputRef.current) fileInputRef.current.value = "";
      if (cameraInputRef.current) cameraInputRef.current.value = "";
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (!file.type.startsWith('image/')) {
      alert('Please select a valid image file');
      return;
    }

    await processImage(file);
  };

  return (
    <>
      {/* Hidden file inputs */}
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

      {/* Button with dropdown for camera/gallery options */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant={variant}
            size={size}
            className={size === "icon" ? "h-9 w-9" : className}
            disabled={loading}
          >
            {loading ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <Camera className="h-5 w-5" />
            )}
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

      {/* Progress Dialog */}
      <Dialog open={showDialog} onOpenChange={() => {}}>
        <DialogContent className="sm:max-w-md" hideCloseButton>
          <DialogHeader>
            <DialogTitle>Processing Image</DialogTitle>
            <DialogDescription>
              {progress?.stage || "Extracting flight data..."}
            </DialogDescription>
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
  );
}
