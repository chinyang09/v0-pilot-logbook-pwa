"use client"

import { useState, useEffect, useCallback, useRef, useSyncExternalStore } from "react"
import { Button } from "@/components/ui/button"
import { X, Share, Download } from "lucide-react"
import { AnimatePresence, motion } from "framer-motion"
import { useServiceWorkerUpdate } from "@/hooks/use-service-worker"

/**
 * Publish the banner's height on :root, and take the status-bar inset off
 * everything below it while it is up.
 *
 * The banner is the topmost thing on screen, so IT clears the status bar
 * (its own `safe-area-inset-top` padding). The chrome under it — the header
 * row (`--chrome-top`, `.pt-chrome-bar`), the nav pill, the full-screen
 * dialogs — reads `--top-inset` instead of the raw env(), so it does not clear
 * the same status bar a second time. Viewport-fixed surfaces add
 * `--install-banner-height` to sit below the banner rather than under it.
 * Removing the inline values restores the stylesheet's defaults (0px and the
 * real inset).
 */
function setInstallBannerHeight(height: number) {
  const root = document.documentElement.style
  if (height > 0) {
    root.setProperty("--install-banner-height", `${height}px`)
    root.setProperty("--top-inset", "0px")
  } else {
    root.removeProperty("--install-banner-height")
    root.removeProperty("--top-inset")
  }
}

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>
}

const DISMISS_KEY = "pwa-install-dismissed"
const DISMISS_DURATION_MS = 7 * 24 * 60 * 60 * 1000 // 7 days

// ─── The browser's install offer, held at MODULE scope ───────────────────────
// Chromium fires `beforeinstallprompt` as soon as the page qualifies, which is
// often before React has hydrated — a listener added in a mount effect missed
// it and the banner never appeared. The listener is attached when this module
// loads instead, and the component reads the held event through a store.
let deferredPrompt: BeforeInstallPromptEvent | null = null
const promptListeners = new Set<() => void>()
const notifyPrompt = () => promptListeners.forEach((l) => l())

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault()
    deferredPrompt = e as BeforeInstallPromptEvent
    notifyPrompt()
  })
  // Installed from the banner OR from the browser's own menu: either way the
  // offer is spent. (The browser opens the installed app itself; the tab
  // cannot launch it, so there is nothing left for the banner to offer.)
  window.addEventListener("appinstalled", () => {
    deferredPrompt = null
    notifyPrompt()
  })
}

function subscribePrompt(listener: () => void) {
  promptListeners.add(listener)
  return () => {
    promptListeners.delete(listener)
  }
}

const noSubscribe = () => () => {}

/**
 * iOS has no install event — adding to the home screen is a Share-menu action
 * the page can only describe. Every browser on iOS is WebKit and offers it
 * from its share sheet, so this is a platform test, not a Safari test.
 */
function isIOS() {
  const ua = navigator.userAgent
  return /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
}

function isStandalone() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (window.navigator as unknown as { standalone?: boolean }).standalone === true
  )
}

function wasDismissedRecently(): boolean {
  try {
    const ts = localStorage.getItem(DISMISS_KEY)
    return !!ts && Date.now() - Number(ts) < DISMISS_DURATION_MS
  } catch {
    return false
  }
}

function rememberDismissal() {
  try {
    localStorage.setItem(DISMISS_KEY, String(Date.now()))
  } catch {}
}

/** Which offer this browser gets, decided once per page load. */
function readEligibility(): "ios" | "prompt" | null {
  if (isStandalone() || wasDismissedRecently()) return null
  return isIOS() ? "ios" : "prompt"
}
let eligibility: "ios" | "prompt" | null | undefined
const getEligibility = () => (eligibility === undefined ? (eligibility = readEligibility()) : eligibility)

/**
 * PWA install prompt — sits in layout flow at the top of the app shell, above
 * the edge-to-edge chrome, which it offsets through `--install-banner-height`
 * and `--top-inset` (see `setInstallBannerHeight`).
 *
 * - iOS: "How to Install" expands the Share → Add to Home Screen steps
 * - Chromium: "Install" opens the browser's own install dialog; the event
 *   behind it is single-use, so it is spent on the first tap whatever the
 *   answer, and a declined dialog counts as a dismissal
 * - Dismiss persists for 7 days
 * - Also carries the service worker's "new version" banner
 */
export function PWAInstallPrompt() {
  const offer = useSyncExternalStore(noSubscribe, getEligibility, () => null)
  const promptEvent = useSyncExternalStore(subscribePrompt, () => deferredPrompt, () => null)
  const [dismissed, setDismissed] = useState(false)
  const [showInstructions, setShowInstructions] = useState(false)
  const bannerRef = useRef<HTMLDivElement>(null)
  const { updateAvailable, applyUpdate } = useServiceWorkerUpdate()

  const showBanner = !dismissed && (offer === "ios" || (offer === "prompt" && !!promptEvent))
  const showAnything = showBanner || updateAvailable

  // Publish the banner's height. Measured in the ResizeObserver callback (it
  // fires once on observe, after layout) rather than read in the effect body,
  // which would force a layout in the middle of the commit.
  useEffect(() => {
    const el = bannerRef.current
    if (!showAnything || !el) return
    const observer = new ResizeObserver(() => setInstallBannerHeight(el.offsetHeight))
    observer.observe(el)
    return () => {
      observer.disconnect()
      setInstallBannerHeight(0)
    }
  }, [showAnything])

  const handleInstall = useCallback(async () => {
    if (offer === "ios") {
      setShowInstructions((v) => !v)
      return
    }
    const event = deferredPrompt
    if (!event) return
    // `prompt()` may be called ONCE per event; a second tap on a kept event
    // threw and left a dead button. Spend it now — the banner goes with it.
    deferredPrompt = null
    notifyPrompt()
    await event.prompt()
    const { outcome } = await event.userChoice
    if (outcome === "dismissed") rememberDismissal()
  }, [offer])

  const handleDismiss = useCallback(() => {
    setDismissed(true)
    setShowInstructions(false)
    rememberDismissal()
  }, [])

  if (!showAnything) return null

  // Topmost on screen, so the banner owns the status bar and the landscape
  // notch; the app below it stops insetting for them.
  const firstRow: React.CSSProperties = {
    paddingTop: "max(env(safe-area-inset-top, 0px), 0.5rem)",
  }
  const sides: React.CSSProperties = {
    paddingLeft: "max(env(safe-area-inset-left, 0px), 1rem)",
    paddingRight: "max(env(safe-area-inset-right, 0px), 1rem)",
  }

  return (
    <div ref={bannerRef} className="flex-shrink-0">
      {/* Update available banner */}
      {updateAvailable && (
        <div className="bg-secondary border-b border-border">
          <div className="flex items-center gap-3 py-2" style={{ ...sides, ...firstRow }}>
            <Download className="h-4 w-4 text-muted-foreground flex-shrink-0" />
            <p className="flex-1 text-sm font-medium text-foreground">
              A new version is available
            </p>
            <Button
              size="sm"
              variant="default"
              className="h-9 px-4 text-xs font-semibold rounded-full"
              onClick={applyUpdate}
            >
              Update
            </Button>
          </div>
        </div>
      )}

      {/* Install banner */}
      {showBanner && (
        <div className="bg-secondary border-b border-border">
          <div
            className="flex items-center gap-3 py-2"
            style={updateAvailable ? sides : { ...sides, ...firstRow }}
          >
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-foreground">
                OOOI is available as an app
              </p>
              <p className="text-xs text-muted-foreground">
                Offline access &amp; faster experience
              </p>
            </div>

            <div className="flex items-center gap-1 flex-shrink-0">
              <Button
                size="sm"
                variant="default"
                className="h-9 px-4 text-xs font-semibold rounded-full"
                onClick={handleInstall}
                aria-expanded={offer === "ios" ? showInstructions : undefined}
              >
                {offer === "ios" ? "How to Install" : "Install"}
              </Button>

              <button
                onClick={handleDismiss}
                className="h-9 w-9 flex items-center justify-center rounded-full hover:bg-foreground/10 transition-colors"
                aria-label="Dismiss"
              >
                <X className="h-4 w-4 text-muted-foreground" />
              </button>
            </div>
          </div>

          {/* iOS install instructions — expandable */}
          <AnimatePresence>
            {showInstructions && offer === "ios" && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.15 }}
                className="overflow-hidden"
              >
                <div className="pb-3 pt-1 border-t border-border" style={sides}>
                  <div className="space-y-2.5 text-sm text-foreground">
                    <div className="flex items-center gap-3">
                      <div className="flex items-center justify-center h-6 w-6 rounded-full bg-background text-xs font-bold shrink-0 text-muted-foreground">1</div>
                      <p className="flex items-center gap-1.5">
                        Tap <Share className="h-4 w-4 inline text-muted-foreground" /> Share in the browser
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="flex items-center justify-center h-6 w-6 rounded-full bg-background text-xs font-bold shrink-0 text-muted-foreground">2</div>
                      <p>Scroll down and tap <strong>&quot;Add to Home Screen&quot;</strong></p>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="flex items-center justify-center h-6 w-6 rounded-full bg-background text-xs font-bold shrink-0 text-muted-foreground">3</div>
                      <p>Tap <strong>&quot;Add&quot;</strong> to confirm</p>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}
    </div>
  )
}
