/**
 * Draft Generation Hook
 * Automatically processes pending schedule entries and creates draft flights
 */

"use client"

import { useEffect, useCallback, useState } from "react"
import { useDBReady } from "./data/use-db"
import { getDraftGenerationConfig } from "@/lib/db"
import { processPendingDrafts } from "@/lib/utils/roster/draft-generator"

export function useDraftGenerator() {
  const { isReady } = useDBReady()
  const [isProcessing, setIsProcessing] = useState(false)
  const [lastProcessed, setLastProcessed] = useState<Date | null>(null)
  const [error, setError] = useState<string | null>(null)

  const processDrafts = useCallback(async () => {
    if (!isReady || isProcessing) return

    try {
      setIsProcessing(true)
      setError(null)

      const config = await getDraftGenerationConfig()

      // Skip if manual trigger mode
      if (config.triggerMode === "manual") {
        return
      }

      const result = await processPendingDrafts(config)

      if (result.created > 0) {
        console.log(
          `[Draft Generator] Created ${result.created} draft(s) from ${result.entriesProcessed.length} schedule entry(ies)`
        )
      }

      setLastProcessed(new Date())
    } catch (err) {
      console.error("[Draft Generator] Error processing drafts:", err)
      setError(err instanceof Error ? err.message : "Unknown error")
    } finally {
      setIsProcessing(false)
    }
  }, [isReady, isProcessing])

  // Process drafts on mount and when DB becomes ready
  useEffect(() => {
    if (isReady) {
      processDrafts()
    }
  }, [isReady, processDrafts])

  // Process drafts periodically (every 5 minutes)
  useEffect(() => {
    if (!isReady) return

    const interval = setInterval(() => {
      processDrafts()
    }, 5 * 60 * 1000) // 5 minutes

    return () => clearInterval(interval)
  }, [isReady, processDrafts])

  return {
    isProcessing,
    lastProcessed,
    error,
    processDrafts,
  }
}
