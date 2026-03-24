"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { Button } from "@/components/ui/button"
import { X, Share, MoreVertical, ExternalLink } from "lucide-react"
import { AnimatePresence, motion } from "framer-motion"

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>
}

const DISMISS_KEY = "pwa-install-dismissed"
const DISMISS_DURATION_MS = 7 * 24 * 60 * 60 * 1000 // 7 days

function isIOSSafari() {
  if (typeof navigator === "undefined") return false
  const ua = navigator.userAgent
  return /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
}

function isStandalone() {
  if (typeof window === "undefined") return false
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (window.navigator as unknown as { standalone?: boolean }).standalone === true
  )
}

function wasDismissedRecently(): boolean {
  if (typeof localStorage === "undefined") return false
  const ts = localStorage.getItem(DISMISS_KEY)
  if (!ts) return false
  return Date.now() - Number(ts) < DISMISS_DURATION_MS
}

/**
 * PWA install prompt — sits in layout flow at the top of the app shell.
 *
 * The banner is the first child in a scroll container so the user can
 * scroll it out of view (scroll down to hide banner, scroll to top to
 * reveal it again).
 *
 * Design:
 * - Theme-aware muted colors (not striking primary)
 * - "Open" button for launching the installed PWA from the browser
 * - "Install" / "How to Install" for platforms that support it
 * - Dismiss persists for 7 days
 */
export function PWAInstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const [showBanner, setShowBanner] = useState(false)
  const [showInstructions, setShowInstructions] = useState(false)
  const [platform, setPlatform] = useState<"ios" | "android" | "desktop" | null>(null)
  const [isInstalled, setIsInstalled] = useState(false)

  useEffect(() => {
    // Check if already running as PWA
    if (isStandalone()) return

    // Check if dismissed recently
    if (wasDismissedRecently()) return

    // Detect platform
    const ios = isIOSSafari()
    if (ios) {
      setPlatform("ios")
      setShowBanner(true)
      return
    }

    // Android/desktop — wait for beforeinstallprompt
    const handler = (e: Event) => {
      e.preventDefault()
      setDeferredPrompt(e as BeforeInstallPromptEvent)
      const isMobile = /Android|webOS/i.test(navigator.userAgent)
      setPlatform(isMobile ? "android" : "desktop")
      setShowBanner(true)
    }
    window.addEventListener("beforeinstallprompt", handler)

    // Listen for successful installation
    const onInstalled = () => {
      setIsInstalled(true)
      setDeferredPrompt(null)
    }
    window.addEventListener("appinstalled", onInstalled)

    return () => {
      window.removeEventListener("beforeinstallprompt", handler)
      window.removeEventListener("appinstalled", onInstalled)
    }
  }, [])

  const handleInstall = useCallback(async () => {
    if (platform === "ios") {
      setShowInstructions((v) => !v)
      return
    }
    if (!deferredPrompt) return
    deferredPrompt.prompt()
    const { outcome } = await deferredPrompt.userChoice
    if (outcome === "accepted") {
      setDeferredPrompt(null)
      setShowBanner(false)
    }
  }, [deferredPrompt, platform])

  const handleOpen = useCallback(() => {
    // Attempt to open the installed PWA by navigating to start_url
    // On platforms with installed PWAs, this triggers the standalone window
    window.location.href = window.location.origin + "/"
  }, [])

  const handleDismiss = useCallback(() => {
    setShowBanner(false)
    setShowInstructions(false)
    try { localStorage.setItem(DISMISS_KEY, String(Date.now())) } catch {}
  }, [])

  if (!showBanner) return null

  return (
    <div className="flex-shrink-0 bg-secondary border-b border-border">
      {/* Main banner row */}
      <div
        className="flex items-center gap-3 px-4 py-2"
        style={{ paddingTop: "max(env(safe-area-inset-top, 0px), 0.5rem)" }}
      >
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-foreground">
            OOOI is available as an app
          </p>
          <p className="text-xs text-muted-foreground">
            Offline access &amp; faster experience
          </p>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          {/* Open button — launches installed PWA or navigates to start URL */}
          {isInstalled && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 px-3 text-xs font-medium rounded-full"
              onClick={handleOpen}
            >
              <ExternalLink className="h-3 w-3 mr-1" />
              Open
            </Button>
          )}

          {/* Install / How to Install button */}
          {!isInstalled && (
            <Button
              size="sm"
              variant="default"
              className="h-7 px-3 text-xs font-semibold rounded-full"
              onClick={handleInstall}
            >
              {platform === "ios" ? "How to Install" : "Install"}
            </Button>
          )}

          <button
            onClick={handleDismiss}
            className="p-1 rounded-full hover:bg-foreground/10 transition-colors"
            aria-label="Dismiss"
          >
            <X className="h-4 w-4 text-muted-foreground" />
          </button>
        </div>
      </div>

      {/* iOS install instructions — expandable */}
      <AnimatePresence>
        {showInstructions && platform === "ios" && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-3 pt-1 border-t border-border">
              <div className="space-y-2.5 text-sm text-foreground">
                <div className="flex items-center gap-3">
                  <div className="flex items-center justify-center h-6 w-6 rounded-full bg-muted text-xs font-bold shrink-0 text-muted-foreground">1</div>
                  <p className="flex items-center gap-1.5">
                    Tap the <Share className="h-4 w-4 inline text-muted-foreground" /> Share button in Safari
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <div className="flex items-center justify-center h-6 w-6 rounded-full bg-muted text-xs font-bold shrink-0 text-muted-foreground">2</div>
                  <p>Scroll down and tap <strong>&quot;Add to Home Screen&quot;</strong></p>
                </div>
                <div className="flex items-center gap-3">
                  <div className="flex items-center justify-center h-6 w-6 rounded-full bg-muted text-xs font-bold shrink-0 text-muted-foreground">3</div>
                  <p>Tap <strong>&quot;Add&quot;</strong> to confirm</p>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Android instructions (via browser menu) */}
      <AnimatePresence>
        {showInstructions && platform === "android" && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-3 pt-1 border-t border-border">
              <div className="space-y-2.5 text-sm text-foreground">
                <div className="flex items-center gap-3">
                  <div className="flex items-center justify-center h-6 w-6 rounded-full bg-muted text-xs font-bold shrink-0 text-muted-foreground">1</div>
                  <p className="flex items-center gap-1.5">
                    Tap the <MoreVertical className="h-4 w-4 inline text-muted-foreground" /> menu in your browser
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <div className="flex items-center justify-center h-6 w-6 rounded-full bg-muted text-xs font-bold shrink-0 text-muted-foreground">2</div>
                  <p>Tap <strong>&quot;Install app&quot;</strong> or <strong>&quot;Add to Home Screen&quot;</strong></p>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
