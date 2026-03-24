"use client"

import { useState, useEffect, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { Download, X, Share, MoreVertical } from "lucide-react"
import { AnimatePresence, motion } from "framer-motion"
import { cn } from "@/lib/utils"

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

export function PWAInstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const [showBanner, setShowBanner] = useState(false)
  const [showInstructions, setShowInstructions] = useState(false)
  const [platform, setPlatform] = useState<"ios" | "android" | "desktop" | null>(null)

  useEffect(() => {
    // Already installed or recently dismissed
    if (isStandalone() || wasDismissedRecently()) return

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
    return () => window.removeEventListener("beforeinstallprompt", handler)
  }, [])

  const handleInstall = useCallback(async () => {
    if (platform === "ios") {
      setShowInstructions(true)
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

  const handleDismiss = useCallback(() => {
    setShowBanner(false)
    setShowInstructions(false)
    try { localStorage.setItem(DISMISS_KEY, String(Date.now())) } catch {}
  }, [])

  return (
    <AnimatePresence>
      {showBanner && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="overflow-hidden fixed top-0 left-0 right-0 z-[200]"
          style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}
        >
          <div className="bg-primary text-primary-foreground">
            {/* Main banner row */}
            <div className="flex items-center gap-3 px-4 py-2.5">
              <Download className="h-4 w-4 shrink-0 opacity-80" />
              <p className="flex-1 text-sm font-medium">
                Install OOOI for offline access
              </p>
              <Button
                size="sm"
                variant="secondary"
                className="h-7 px-3 text-xs font-semibold rounded-full"
                onClick={handleInstall}
              >
                {platform === "ios" ? "How to Install" : "Install"}
              </Button>
              <button
                onClick={handleDismiss}
                className="p-1 rounded-full hover:bg-primary-foreground/10 transition-colors"
                aria-label="Dismiss"
              >
                <X className="h-4 w-4 opacity-60" />
              </button>
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
                  <div className="px-4 pb-3 pt-1 border-t border-primary-foreground/15">
                    <div className="space-y-2.5 text-sm">
                      <div className="flex items-center gap-3">
                        <div className="flex items-center justify-center h-6 w-6 rounded-full bg-primary-foreground/15 text-xs font-bold shrink-0">1</div>
                        <p className="flex items-center gap-1.5">
                          Tap the <Share className="h-4 w-4 inline" /> Share button in Safari
                        </p>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="flex items-center justify-center h-6 w-6 rounded-full bg-primary-foreground/15 text-xs font-bold shrink-0">2</div>
                        <p>Scroll down and tap <strong>&quot;Add to Home Screen&quot;</strong></p>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="flex items-center justify-center h-6 w-6 rounded-full bg-primary-foreground/15 text-xs font-bold shrink-0">3</div>
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
                  <div className="px-4 pb-3 pt-1 border-t border-primary-foreground/15">
                    <div className="space-y-2.5 text-sm">
                      <div className="flex items-center gap-3">
                        <div className="flex items-center justify-center h-6 w-6 rounded-full bg-primary-foreground/15 text-xs font-bold shrink-0">1</div>
                        <p className="flex items-center gap-1.5">
                          Tap the <MoreVertical className="h-4 w-4 inline" /> menu in your browser
                        </p>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="flex items-center justify-center h-6 w-6 rounded-full bg-primary-foreground/15 text-xs font-bold shrink-0">2</div>
                        <p>Tap <strong>&quot;Install app&quot;</strong> or <strong>&quot;Add to Home Screen&quot;</strong></p>
                      </div>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
