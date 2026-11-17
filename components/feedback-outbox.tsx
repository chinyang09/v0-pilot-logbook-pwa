"use client"

/**
 * Keeps two things for in-app feedback, and renders nothing: the page the
 * pilot was on (what a report written next is most likely about) and the
 * outbox, sent once the app is online again for whoever wrote it.
 */

import { useEffect } from "react"
import { usePathname } from "next/navigation"
import { useAuth } from "@/components/providers/auth-provider"
import { flushOutbox, readOutbox, rememberRoute } from "@/lib/feedback/client"

export function FeedbackOutbox() {
  const pathname = usePathname()
  const userId = useAuth().user?.userId ?? null

  useEffect(() => {
    if (pathname) rememberRoute(pathname)
  }, [pathname])

  useEffect(() => {
    if (!userId) return
    const flush = () => {
      if (navigator.onLine && readOutbox(userId).length) void flushOutbox(userId)
    }
    flush()
    window.addEventListener("online", flush)
    return () => window.removeEventListener("online", flush)
  }, [userId])

  return null
}
