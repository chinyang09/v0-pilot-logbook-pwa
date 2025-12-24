"use client"

import { useRef, useState } from "react"
import { Upload, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { processScootCSV } from "@/lib/scoot-parser"
import { useAirports, useAircraft } from "@/hooks/use-indexed-db"

export function CSVImportButton({ onComplete }: { onComplete: () => void }) {
  const [loading, setLoading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const { airports } = useAirports()
  const { aircraft } = useAircraft()

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setLoading(true)
    try {
      const content = await file.text()
      // Note: Replace these with your actual Auth state/User data
      await processScootCSV(content, airports, aircraft, "user-id", "Lim Chin Yang")
      onComplete()
    } catch (error) {
      console.error("Import failed", error)
      alert("Failed to parse CSV. Please ensure it is a valid Scoot Crew Logbook.")
    } finally {
      setLoading(false)
      if (fileInputRef.current) fileInputRef.current.value = ""
    }
  }

  return (
    <>
      <input 
        type="file" 
        ref={fileInputRef} 
        className="hidden" 
        accept=".csv" 
        onChange={handleFileChange} 
      />
      <Button
        variant="ghost"
        size="icon"
        className="h-9 w-9"
        disabled={loading}
        onClick={() => fileInputRef.current?.click()}
      >
        {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Upload className="h-5 w-5" />}
      </Button>
    </>
  )
}
