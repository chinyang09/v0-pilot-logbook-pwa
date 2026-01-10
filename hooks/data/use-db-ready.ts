"use client"

import { useEffect, useState } from "react"
import { initializeDB } from "@/lib/db"

let dbInitialized = false
let dbInitPromise: Promise<boolean> | null = null

async function checkDBReady(): Promise<boolean> {
  if (typeof window === "undefined") return false

  if (dbInitialized) return true

  if (!dbInitPromise) {
    dbInitPromise = initializeDB().then((ready) => {
      dbInitialized = ready
      return ready
    })
  }

  return dbInitPromise
}

export function useDBReady() {
  const [isReady, setIsReady] = useState(false)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    checkDBReady().then((ready) => {
      setIsReady(ready)
      setIsLoading(false)
    })
  }, [])

  return { isReady, isLoading }
}
