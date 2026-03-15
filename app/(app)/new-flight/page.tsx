"use client"

import { useEffect, useRef } from "react"
import { useRouter } from "next/navigation"
import { useDBReady } from "@/hooks/data"
import { useCreateFlight } from "@/hooks/use-create-flight"
import { PageContainer } from "@/components/page-container"
import { Skeleton } from "@/components/ui/skeleton"

/**
 * Backwards-compatible redirect: creates a draft flight and redirects to /flights/[id].
 * All flight creation/editing now goes through the unified /flights/[id] route.
 */
export default function NewFlightPage() {
  const router = useRouter()
  const { isReady: dbReady } = useDBReady()
  const createFlight = useCreateFlight()
  const creatingRef = useRef(false)

  useEffect(() => {
    if (!dbReady || creatingRef.current) return
    creatingRef.current = true

    const create = async () => {
      try {
        const draft = await createFlight()
        router.replace(`/flights/${draft.id}`)
      } catch (error) {
        console.error("Failed to create draft flight:", error)
        creatingRef.current = false
      }
    }
    create()
  }, [dbReady, router, createFlight])

  return (
    <PageContainer>
      <div className="h-full">
        <div className="h-12 bg-background/30 backdrop-blur-xl px-4 flex items-center justify-between">
          <Skeleton className="h-5 w-24" />
          <Skeleton className="h-8 w-20" />
        </div>
        <div className="space-y-4 px-2 py-4">
          <div className="rounded-xl bg-card border border-border p-4 space-y-3">
            <Skeleton className="h-4 w-20" />
            <div className="grid grid-cols-3 gap-3">
              <Skeleton className="h-10" />
              <Skeleton className="h-10" />
              <Skeleton className="h-10" />
            </div>
          </div>
        </div>
      </div>
    </PageContainer>
  )
}
