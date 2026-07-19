"use client"

import type React from "react"
import { useState, useEffect, useRef, useCallback } from "react"
import { createPortal } from "react-dom"
import { usePathname, useRouter } from "next/navigation"
import Link from "next/link"
import { useReducedMotion } from "framer-motion"
import {
  LayoutDashboard,
  Book,
  Calendar,
  Plane,
  Users,
  MapPin,
  Award,
  Settings,
  UserCircle,
  PanelLeft,
  ChevronDown,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { OVERSHOOT_BEZIER, SETTLE_BEZIER, MORPH_EASE } from "@/lib/motion"
import { GlassContainer } from "@/components/ui/glass-container"
import { useDesktopPill, useHydrated } from "@/hooks/use-is-desktop"
import { useSidebar } from "@/hooks/use-sidebar-context"
import { useScrollNavbarContext } from "@/hooks/use-scroll-navbar-context"
import { usePreferences } from "@/components/providers/preferences-provider"
import { navSections, dashboardNavItem } from "@/components/nav-sections"
import { SyncStatus } from "@/components/sync-status"
import type { BottomNavTab } from "@/types/db/stores.types"

// ─── Tab config ──────────────────────────────────────────────

const TAB_CONFIG: Record<
  BottomNavTab,
  {
    label: string
    icon: React.ComponentType<{ className?: string }>
    href: string
    isActive: (pathname: string) => boolean
  }
> = {
  dashboard: {
    label: "Dashboard",
    icon: LayoutDashboard,
    href: "/",
    isActive: (p) => p === "/",
  },
  logbook: {
    label: "Logbook",
    icon: Book,
    href: "/logbook",
    isActive: (p) => p === "/logbook" || p?.startsWith("/flights/"),
  },
  roster: {
    label: "Roster",
    icon: Calendar,
    href: "/roster",
    isActive: (p) =>
      p === "/roster" ||
      p === "/currencies" ||
      p === "/discrepancies" ||
      p === "/fdp",
  },
  aircraft: {
    label: "Aircraft",
    icon: Plane,
    href: "/aircraft",
    isActive: (p) => p === "/aircraft" || p?.startsWith("/aircraft/"),
  },
  crew: {
    label: "Crew",
    icon: Users,
    href: "/crew",
    isActive: (p) => p === "/crew" || p?.startsWith("/crew/"),
  },
  airports: {
    label: "Airports",
    icon: MapPin,
    href: "/airports",
    isActive: (p) => p === "/airports" || p?.startsWith("/airports/"),
  },
  currencies: {
    label: "Currencies",
    icon: Award,
    href: "/currencies",
    isActive: (p) => p === "/currencies",
  },
  settings: {
    label: "Settings",
    icon: Settings,
    href: "/settings",
    isActive: (p) => p === "/settings",
  },
  account: {
    label: "Account",
    icon: UserCircle,
    href: "/account",
    isActive: (p) => p === "/account",
  },
}

// ─── Constants ───────────────────────────────────────────────

const SIDEBAR_WIDTH = 199
const SIDEBAR_MARGIN = 4 // distance from viewport edge when expanded
const SIDEBAR_INNER_WIDTH = SIDEBAR_WIDTH - SIDEBAR_MARGIN * 2 // 191
const PILL_HEIGHT = 56 // h-14
const PILL_TOP = SIDEBAR_MARGIN // top offset — aligns pill center with header center


// ─── Sync status icon ────────────────────────────────────────

/**
 * The nav's sync affordance is the shared <SyncStatus/> — it uses the theme's
 * `--status-*` colors, shows the pending-count badge, and (critically) routes a
 * manual sync through `ensureValidSession()` so a dead session prompts passkey
 * re-auth instead of silently 401ing. Do not reintroduce a bespoke button here.
 */
function SyncIconButton({ className }: { className?: string }) {
  return <SyncStatus className={cn("h-8 w-8 flex-shrink-0", className)} />
}

// ─── Gravity active-tab indicator ────────────────────────────

/**
 * A "gravity" active-item highlight: a single blob that moves to the active item
 * with a bouncy overshoot, and — because position and size settle at slightly
 * different rates — stretches a touch in the direction of travel for a liquid
 * feel.
 *
 * Crucially this uses CSS transitions on `transform` (position) rather than a
 * JS/Framer spring. Framer springs tick per-frame on the MAIN thread, so when a
 * heavy page (dashboard/FDP) mounts and blocks it, the blob hitches. A CSS
 * transform transition runs on the compositor and stays smooth regardless.
 * Works for both the horizontal pill bar and the vertical sidebar (position is
 * always `translate(left, top)`; the changing axis is just whichever of
 * width/height varies). Metrics are measured with a ResizeObserver (setState
 * only in the RO callback) in content coordinates so it's correct inside a
 * scroll area.
 */
function GravityIndicator({
  containerRef,
  activeIndex,
  className,
  revision = "",
  hidden = false,
}: {
  containerRef: React.RefObject<HTMLElement | null>
  activeIndex: number
  className?: string
  /** Change this when the set/order of items changes so metrics re-measure. */
  revision?: string
  /** Fade the blob out (drag-lens active) while its transform keeps tracking. */
  hidden?: boolean
}) {
  const reduce = useReducedMotion()
  const [rects, setRects] = useState<{ left: number; top: number; width: number; height: number }[]>([])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const measure = () => {
      const base = el.getBoundingClientRect()
      const items = Array.from(el.querySelectorAll<HTMLElement>("[data-grav-item]"))
      setRects(
        items.map((it) => {
          const r = it.getBoundingClientRect()
          return {
            left: r.left - base.left + el.scrollLeft,
            top: r.top - base.top + el.scrollTop,
            width: r.width,
            height: r.height,
          }
        }),
      )
    }
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    // Items themselves can change size/position (e.g. a collapsing sidebar
    // section) without the container resizing — observe them too.
    el.querySelectorAll<HTMLElement>("[data-grav-item]").forEach((it) => ro.observe(it))
    return () => ro.disconnect()
  }, [containerRef, revision])

  const target = rects[activeIndex]
  if (!target || activeIndex < 0) return null

  // Position transitions with a bouncy overshoot (compositor-driven); size
  // settles a touch faster so the trailing edge lags → a subtle stretch. CSS
  // transitions don't fire on first paint, so there's no fly-in on mount.
  const transition = reduce
    ? "none"
    : [
        `transform 0.5s ${OVERSHOOT_BEZIER}`,
        `width 0.4s ${SETTLE_BEZIER}`,
        `height 0.4s ${SETTLE_BEZIER}`,
        "opacity 0.15s ease",
      ].join(", ")

  return (
    <div
      aria-hidden
      className={cn(
        "absolute left-0 top-0 z-0 rounded-full bg-foreground/10",
        className,
      )}
      // `pointer-events:none` inline (belt-and-suspenders) — the blob sits over
      // the active item, and on iOS a *composited* layer (it transforms) can
      // occasionally swallow a touch despite the class. No `will-change` so the
      // layer isn't promoted persistently (the transform transition still
      // composites while animating, so nav stays smooth).
      style={{
        pointerEvents: "none",
        opacity: hidden ? 0 : 1,
        transform: `translate(${target.left}px, ${target.top}px)`,
        width: target.width,
        height: target.height,
        transition,
      }}
    />
  )
}

// ─── Shared pill bar content ─────────────────────────────────

/**
 * Shared pill bar row — used in both desktop and mobile collapsed states.
 *
 * Layout: [PanelLeft] | [divider] | [equally spaced tabs] | [SyncIcon]
 *
 * Desktop: tabs render as text labels
 * Mobile: tabs render as icon + tiny label
 */
function PillBarContent({
  tabs,
  pathname,
  mode,
  onToggleSidebar,
}: {
  tabs: readonly BottomNavTab[]
  pathname: string
  mode: "desktop" | "mobile"
  onToggleSidebar: () => void
}) {
  const tabsRef = useRef<HTMLDivElement>(null)
  const activeIndex = tabs.findIndex((k) => TAB_CONFIG[k]?.isActive(pathname))
  const router = useRouter()
  const reduce = useReducedMotion()

  // ── Drag lens (iPadOS tab-bar style): hold and slide along the pill and a
  // clear glass bubble — TALLER than the pill, so it rides over its edges —
  // follows the finger 1:1 (no snapping mid-drag). The nearest tab's label
  // pre-highlights as the lens passes over it and the grey blob hides; on
  // release the lens SPRINGS to that tab and morphs into the grey highlight,
  // then hands off to the real blob. A plain tap never activates it (10px
  // slop), so normal Link taps work unchanged. Rendered through a portal —
  // the pill's GlassContent clips overflow, and the lens must overhang it.
  const lensRef = useRef<HTMLDivElement | null>(null)
  const [lensPhase, setLensPhase] = useState<"idle" | "drag" | "settle">("idle")
  const [lensIndex, setLensIndex] = useState(-1)
  const suppressClickRef = useRef(false)
  const lastXRef = useRef(0)
  const settleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const dragRef = useRef<{
    startX: number
    active: boolean
    nearest: number
    base: { left: number; top: number; width: number; height: number }
    rects: { left: number; width: number; height: number }[]
  } | null>(null)

  /** Extra height beyond the pill — the lens overhangs top and bottom. */
  const LENS_OVERHANG = 16

  const positionLens = useCallback((clientX: number) => {
    const lens = lensRef.current
    const drag = dragRef.current
    if (!lens || !drag || drag.rects.length === 0) return
    lastXRef.current = clientX
    const x = Math.max(0, Math.min(drag.base.width, clientX - drag.base.left))
    let nearest = 0
    let best = Infinity
    drag.rects.forEach((r, i) => {
      const d = Math.abs(x - (r.left + r.width / 2))
      if (d < best) {
        best = d
        nearest = i
      }
    })
    if (nearest !== drag.nearest) {
      drag.nearest = nearest
      setLensIndex(nearest)
    }
    const r = drag.rects[nearest]
    const w = r.width + 12
    // Pure finger follow — the smoothing comes from the short CSS transform
    // transition, not from snapping. Release does the spring-to-tab.
    lens.style.width = `${w}px`
    lens.style.height = `${drag.base.height + LENS_OVERHANG}px`
    lens.style.transform = `translate(${x - w / 2}px, -50%)`
  }, [])

  // Portal mount: position immediately from the live drag state, then reveal
  // on the next frame so the pop-in transitions from the base styles.
  const lensMountRef = useCallback((node: HTMLDivElement | null) => {
    lensRef.current = node
    const drag = dragRef.current
    if (!node || !drag) return
    node.style.left = `${drag.base.left}px`
    node.style.top = `${drag.base.top + drag.base.height / 2}px`
    positionLens(lastXRef.current)
    requestAnimationFrame(() => node.classList.add("PillDragLens--on"))
  }, [positionLens])

  const handleLensDown = useCallback((e: React.PointerEvent) => {
    if (reduce || lensPhase === "settle") return
    const el = tabsRef.current
    if (!el) return
    const base = el.getBoundingClientRect()
    lastXRef.current = e.clientX
    dragRef.current = {
      startX: e.clientX,
      active: false,
      nearest: -1,
      base: { left: base.left, top: base.top, width: base.width, height: base.height },
      rects: Array.from(el.querySelectorAll<HTMLElement>("[data-grav-item]")).map((it) => {
        const r = it.getBoundingClientRect()
        return { left: r.left - base.left, width: r.width, height: r.height }
      }),
    }
  }, [reduce, lensPhase])

  const handleLensMove = useCallback((e: React.PointerEvent) => {
    const drag = dragRef.current
    if (!drag) return
    if (!drag.active) {
      if (Math.abs(e.clientX - drag.startX) < 10) return
      drag.active = true
      setLensPhase("drag")
      try {
        tabsRef.current?.setPointerCapture(e.pointerId)
      } catch {
        // capture can fail if the pointer is already gone — lens still tracks
      }
    }
    positionLens(e.clientX)
  }, [positionLens])

  const handleLensEnd = useCallback((e: React.PointerEvent) => {
    const drag = dragRef.current
    dragRef.current = null
    if (!drag?.active) return
    // Swallow the click synthesised at the end of the drag; the timeout clears
    // the flag if pointer capture already ate the click (so the NEXT tap works).
    suppressClickRef.current = true
    setTimeout(() => {
      suppressClickRef.current = false
    }, 150)

    if (e.type === "pointercancel" || drag.nearest < 0) {
      setLensPhase("idle")
      setLensIndex(-1)
      return
    }

    // Settle: the lens itself springs to the chosen tab and morphs into the
    // grey highlight (the --settle class swaps easing to the overshoot spring
    // and crossfades the material); navigation happens now so the hidden blob
    // arrives underneath, and the handoff swap is invisible.
    setLensPhase("settle")
    const idx = drag.nearest
    const r = drag.rects[idx]
    const lens = lensRef.current
    if (lens) {
      requestAnimationFrame(() => {
        lens.style.width = `${r.width}px`
        lens.style.height = `${r.height}px`
        lens.style.transform = `translate(${r.left}px, -50%)`
      })
    }
    const tab = TAB_CONFIG[tabs[idx]]
    if (tab) router.push(tab.href)
    if (settleTimerRef.current) clearTimeout(settleTimerRef.current)
    settleTimerRef.current = setTimeout(() => {
      setLensPhase("idle")
      setLensIndex(-1)
    }, 480)
  }, [tabs, router])

  useEffect(() => () => {
    if (settleTimerRef.current) clearTimeout(settleTimerRef.current)
  }, [])

  const lensActive = lensPhase !== "idle"

  return (
    <div className="flex items-center h-14 px-2">
      {/* Sidebar toggle — fixed width bookend */}
      <button
        onClick={onToggleSidebar}
        className="flex items-center justify-center h-10 w-10 rounded-full text-foreground/70 active:text-foreground flex-shrink-0"
      >
        <PanelLeft className="h-6 w-6" />
      </button>

      {/* Tabs — equally spaced, fill remaining space. The gravity blob sits
          behind the labels and stretches between tabs as the route changes.
          touch-action:none so hold-and-slide streams pointermoves on iOS. */}
      <div
        ref={tabsRef}
        className="relative flex items-center flex-1 min-w-0 justify-evenly touch-none"
        onPointerDown={handleLensDown}
        onPointerMove={handleLensMove}
        onPointerUp={handleLensEnd}
        onPointerCancel={handleLensEnd}
        onClickCapture={(e) => {
          if (suppressClickRef.current) {
            suppressClickRef.current = false
            e.preventDefault()
            e.stopPropagation()
          }
        }}
      >
        <GravityIndicator
          containerRef={tabsRef}
          activeIndex={activeIndex}
          revision={tabs.join(",")}
          hidden={lensActive}
        />
        {tabs.map((tabKey, i) => {
          const tab = TAB_CONFIG[tabKey]
          if (!tab) return null
          const active = tab.isActive(pathname)
          // While the lens is up, ONLY the tab under it reads as selected —
          // its label pre-highlights and the previously active tab dims.
          const highlighted = lensActive ? lensIndex === i : active
          const Icon = tab.icon

          return (
            <Link key={tabKey} href={tab.href} className="relative z-[1]">
              {mode === "desktop" ? (
                <span
                  data-grav-item
                  className={cn(
                    "inline-flex items-center justify-center h-9 px-4 rounded-full text-sm font-medium transition-colors",
                    highlighted ? "text-primary" : "text-foreground/60 active:text-foreground"
                  )}
                >
                  {tab.label}
                </span>
              ) : (
                <span
                  data-grav-item
                  className={cn(
                    "inline-flex flex-col items-center justify-center gap-0.5 h-11 px-3 rounded-full transition-colors",
                    highlighted ? "text-primary" : "text-foreground/60 active:text-foreground"
                  )}
                >
                  <Icon className="h-6 w-6" />
                  <span className="text-[9px] leading-none">{tab.label}</span>
                </span>
              )}
            </Link>
          )
        })}
      </div>

      {/* Drag lens portal — fixed-positioned so it can overhang the pill
          (GlassContent clips its own overflow). */}
      {lensActive &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={lensMountRef}
            aria-hidden
            className={cn("PillDragLens", lensPhase === "settle" && "PillDragLens--settle")}
          />,
          document.body
        )}

      {/* Sync status — fixed width bookend */}
      <SyncIconButton />
    </div>
  )
}

// ─── Shared sidebar nav content ──────────────────────────────

function SidebarNav({
  pathname,
  className,
}: {
  pathname: string
  className?: string
}) {
  const navRef = useRef<HTMLElement>(null)
  const blobLayerRef = useRef<HTMLDivElement>(null)
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const toggleSection = (label: string) => {
    setCollapsed((prev) => ({ ...prev, [label]: !prev[label] }))
  }

  // Keep the (un-clipped) gravity-blob overlay in lock-step with the nav's
  // scroll. The blob is measured in the scroller's CONTENT coordinates; the
  // overlay isn't a scroll container, so translating it by -scrollTop projects
  // the blob into the right viewport position WITHOUT the overflow clipping that
  // used to slice the overshoot spring off above the top item. Imperative DOM
  // write on a passive scroll listener — no re-render, stays on the compositor.
  useEffect(() => {
    const sc = navRef.current
    const layer = blobLayerRef.current
    if (!sc || !layer) return
    const sync = () => {
      layer.style.transform = `translateY(${-sc.scrollTop}px)`
    }
    sync()
    sc.addEventListener("scroll", sync, { passive: true })
    return () => sc.removeEventListener("scroll", sync)
  }, [])

  const isItemActive = (href: string) => {
    if (href === "/") return pathname === "/"
    return pathname === href || pathname?.startsWith(href + "/")
  }

  // Rendered item order (matches DOM): dashboard, then each expanded section's
  // items. Drives the vertical gravity blob's target.
  const orderedHrefs = [
    dashboardNavItem.href,
    ...navSections.flatMap((s) => (collapsed[s.label] ? [] : s.items.map((i) => i.href))),
  ]
  const activeIndex = orderedHrefs.findIndex((href) => isItemActive(href))

  return (
    <div className={cn("relative min-h-0", className)}>
      {/* Gravity blob lives in a NON-scrolling overlay so the overshoot spring
          can travel above the first item without being clipped by the nav's
          overflow. `blobLayerRef` is translated by -scrollTop (above) to stay
          pinned to the scrolling content. Sits behind the nav items (z-0). */}
      <div ref={blobLayerRef} aria-hidden className="pointer-events-none absolute inset-0 z-0">
        <GravityIndicator
          containerRef={navRef}
          activeIndex={activeIndex}
          className="rounded-full"
          revision={orderedHrefs.join(",")}
        />
      </div>
      <nav
        ref={navRef}
        className="relative z-[1] h-full overflow-y-auto overscroll-contain px-3 pb-4"
        style={{ WebkitOverflowScrolling: "touch", touchAction: "pan-y" }}
      >
      <SidebarNavItem
        href={dashboardNavItem.href}
        icon={dashboardNavItem.icon}
        label={dashboardNavItem.label}
        isActive={isItemActive("/")}
      />
      {navSections.map((section) => {
        const isCollapsed = collapsed[section.label]
        return (
          <div key={section.label} className="mt-3">
            <button
              onClick={() => toggleSection(section.label)}
              className="flex items-center justify-between w-full px-3 mb-1 group cursor-pointer"
            >
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
                {section.label}
              </span>
              <ChevronDown
                className={cn(
                  "h-3.5 w-3.5 text-muted-foreground/40 transition-transform duration-200",
                  isCollapsed && "-rotate-90"
                )}
              />
            </button>
            {!isCollapsed &&
              section.items.map((item) => (
                <SidebarNavItem
                  key={item.href}
                  href={item.href}
                  icon={item.icon}
                  label={item.label}
                  isActive={isItemActive(item.href)}
                />
              ))}
          </div>
        )
      })}
      </nav>
    </div>
  )
}

function SidebarNavItem({
  href,
  icon,
  label,
  isActive,
}: {
  href: string
  icon: React.ReactNode
  label: string
  isActive: boolean
}) {
  return (
    <Link
      href={href}
      data-grav-item
      className={cn(
        "relative z-[1] flex items-center gap-3 px-3.5 py-2.5 rounded-full text-sm transition-all duration-150",
        "active:scale-[0.98]",
        isActive
          ? "text-primary font-medium"
          : "text-foreground/70 hover:bg-foreground/5 hover:text-foreground"
      )}
    >
      <span className={cn("flex-shrink-0 [&_svg]:!size-6", isActive ? "text-primary" : "text-foreground/50")}>
        {icon}
      </span>
      {label}
    </Link>
  )
}

// ─── Viewport measurement hook ───────────────────────────────

function useViewportMeasure() {
  const [vh, setVh] = useState(typeof window !== "undefined" ? window.innerHeight : 800)
  const [safeAreaTop, setSafeAreaTop] = useState(0)
  const [bannerHeight, setBannerHeight] = useState(0)

  useEffect(() => {
    const measure = () => {
      setVh(window.innerHeight)
      const el = document.createElement("div")
      el.style.position = "fixed"
      el.style.top = "env(safe-area-inset-top, 0px)"
      el.style.visibility = "hidden"
      document.body.appendChild(el)
      const top = el.getBoundingClientRect().top
      document.body.removeChild(el)
      setSafeAreaTop(top)
      const bh = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--install-banner-height") || "0")
      setBannerHeight(bh || 0)
    }
    measure()
    window.addEventListener("resize", measure)
    const obs = new MutationObserver(measure)
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["style"] })
    return () => { window.removeEventListener("resize", measure); obs.disconnect() }
  }, [])

  const expandedHeight = vh - SIDEBAR_MARGIN * 2 - safeAreaTop - bannerHeight
  return { expandedHeight, safeAreaTop, bannerHeight }
}

// ─── Main export ─────────────────────────────────────────────

export function NavPill() {
  const canPush = useDesktopPill()
  const hydrated = useHydrated()
  const { isOpen: sidebarOpen, toggle: toggleSidebar } = useSidebar()
  const { hideNavbar } = useScrollNavbarContext()
  const pathname = usePathname()
  const { preferences } = usePreferences()
  const prefersReducedMotion = useReducedMotion()

  const tabs = preferences.navigation.bottomNavTabs

  const desktopPill = (
    <DesktopPillMorph
      tabs={tabs}
      pathname={pathname}
      sidebarOpen={sidebarOpen}
      onToggleSidebar={toggleSidebar}
      prefersReducedMotion={!!prefersReducedMotion}
    />
  )
  const mobilePill = (
    <MobilePillMorph
      tabs={tabs}
      pathname={pathname}
      hideNavbar={hideNavbar}
      prefersReducedMotion={!!prefersReducedMotion}
    />
  )

  // Pre-hydration (SSR HTML + the hydration render), useDesktopPill() must
  // report false — JS-picking a variant painted the BOTTOM pill at desktop
  // widths until hydration finished, then jumped to the top pill. Render both
  // variants gated by the same 1120px breakpoint in CSS so the correct one
  // paints immediately; once hydrated, JS picks one and the other unmounts.
  if (!hydrated) {
    return (
      <>
        <div className="hidden min-[1120px]:block">{desktopPill}</div>
        <div className="min-[1120px]:hidden">{mobilePill}</div>
      </>
    )
  }

  return canPush ? desktopPill : mobilePill
}

// ─── Morph phase state machine (shared) ──────────────────────

type MorphPhase = "pill" | "opening" | "sidebar" | "closing"

/**
 * Morph state machine. Previously the open/close was split into a slide phase
 * then a separate expand phase, which made the pill visibly pause ("stuck")
 * between sliding to the corner and growing into the sidebar. Now position,
 * width AND height all transition together in a single `opening`/`closing`
 * phase, so the morph is one continuous motion.
 */
function useMorphPhase(isOpen: boolean, phaseDuration: number) {
  const [phase, setPhase] = useState<MorphPhase>(isOpen ? "sidebar" : "pill")
  const prevOpenRef = useRef(isOpen)
  const safetyTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined)

  useEffect(() => {
    if (prevOpenRef.current === isOpen) return
    prevOpenRef.current = isOpen
    setPhase(isOpen ? "opening" : "closing")
  }, [isOpen])

  const advancePhase = useCallback(() => {
    clearTimeout(safetyTimerRef.current)
    setPhase((current) =>
      current === "opening" ? "sidebar" : current === "closing" ? "pill" : current,
    )
  }, [])

  useEffect(() => {
    if (phase !== "opening" && phase !== "closing") return
    clearTimeout(safetyTimerRef.current)
    safetyTimerRef.current = setTimeout(advancePhase, phaseDuration + 80)
    return () => clearTimeout(safetyTimerRef.current)
  }, [phase, phaseDuration, advancePhase])

  // Sidebar geometry (position + width + height) for the whole open span. The
  // sidebar content rides this too, so it's interactive throughout the open.
  const isSidebarShape = phase === "opening" || phase === "sidebar"

  return { phase, advancePhase, isSidebarShape }
}


/**
 * Build the per-property CSS `transition` for the morph so the two property
 * groups OVERLAP rather than running as a stalled two-step:
 * - opening (pill→sidebar): position+width lead (delay 0), height follows (delay
 *   `lead`, i.e. starts ~85% through the position move).
 * - closing (sidebar→pill): height leads (delay 0), position+width follow.
 * Settled phases get `"none"`. `positionProps` is the comma-separated geometry
 * (desktop includes `top`; mobile is bottom-anchored so it doesn't).
 */
function morphTransition(phase: MorphPhase, dur: number, lead: number, positionProps: string): string {
  if (phase !== "opening" && phase !== "closing") return "none"
  const group = (props: string, delay: number) =>
    props
      .split(",")
      .map((p) => `${p.trim()} ${dur}ms ${MORPH_EASE} ${delay}ms`)
      .join(", ")
  return phase === "opening"
    ? `${group(positionProps, 0)}, ${group("height", lead)}`
    : `${group("height", 0)}, ${group(positionProps, lead)}`
}

// ─── Desktop: top pill ↔ sidebar ─────────────────────────────

function DesktopPillMorph({
  tabs,
  pathname,
  sidebarOpen,
  onToggleSidebar,
  prefersReducedMotion,
}: {
  tabs: readonly BottomNavTab[]
  pathname: string
  sidebarOpen: boolean
  onToggleSidebar: () => void
  prefersReducedMotion: boolean
}) {
  const ref = useRef<HTMLDivElement>(null)
  const { expandedHeight } = useViewportMeasure()
  // Each property animates over DUR; the second group starts LEAD ms in (~85% of
  // the way through the first) so the two overlap rather than stalling. Order:
  // opening (pill→sidebar) moves position+width first, then grows height;
  // closing (sidebar→pill) shrinks height first, then moves position+width.
  const DUR = prefersReducedMotion ? 0 : 190
  const LEAD = prefersReducedMotion ? 0 : 160
  const TOTAL = DUR + LEAD

  const { phase, advancePhase, isSidebarShape } = useMorphPhase(sidebarOpen, TOTAL)

  // Settle the phase the instant the morph visually finishes — i.e. when the
  // LAST (delayed) property's transition ends — so the content becomes
  // interactive immediately rather than ~80ms later via the fallback timer
  // (that gap dropped sidebar taps). Keyed to the delayed property so the
  // delayed group is never cut short.
  const handleTransitionEnd = useCallback(
    (e: React.TransitionEvent) => {
      if (e.target !== ref.current) return
      const last = phase === "opening" ? "height" : phase === "closing" ? "transform" : null
      if (last && e.propertyName === last) advancePhase()
    },
    [phase, advancePhase],
  )

  const transition = morphTransition(phase, DUR, LEAD, "top, left, transform, width")

  const style: React.CSSProperties = {
    top: isSidebarShape
      ? `calc(${SIDEBAR_MARGIN}px + env(safe-area-inset-top, 0px) + var(--install-banner-height, 0px))`
      : `calc(${PILL_TOP}px + env(safe-area-inset-top, 0px) + var(--install-banner-height, 0px))`,
    left: isSidebarShape ? SIDEBAR_MARGIN : "50%",
    transform: isSidebarShape ? "translateX(0)" : "translateX(-50%)",
    width: isSidebarShape ? SIDEBAR_INNER_WIDTH : "auto",
    height: isSidebarShape ? expandedHeight : PILL_HEIGHT,
    transition,
  }

  return (
    <div
      ref={ref}
      className="fixed z-[100]"
      style={style}
      onTransitionEnd={handleTransitionEnd}
    >
        <GlassContainer
          cornerRadius={isSidebarShape ? 20 : 28}
          className="h-full"
          contentClassName="h-full !overflow-hidden !flex !flex-col"
          disableTapFeedback
          spotlight
          morphing={phase === "opening" || phase === "closing"}
        >
          {/* Pill bar — always visible */}
          <div
            className="flex-shrink-0"
            style={{
              // Only show the (horizontal) pill content once fully settled as a
              // pill — mid-morph the container is the wrong shape so the tabs look
              // squished. Collapsed to 0 height + non-interactive otherwise.
              opacity: phase === "pill" ? 1 : 0,
              visibility: phase === "pill" ? "visible" : "hidden",
              pointerEvents: phase === "pill" ? "auto" : "none",
              height: phase === "pill" ? PILL_HEIGHT : 0,
              transition: "opacity 0.2s ease",
            }}
          >
            <PillBarContent
              tabs={tabs}
              pathname={pathname}
              mode="desktop"
              onToggleSidebar={onToggleSidebar}
            />
          </div>

          {/* Sidebar header + nav — visible when expanded */}
          <div
            className="flex flex-col flex-1 min-h-0 transition-opacity duration-200 ease-out"
            style={{
              // The vertical sidebar list isn't "squished" mid-morph (it's just
              // clipped by the growing height, like a drawer), so keep it visible
              // AND interactive for the whole open span. Gating it on the settled
              // phase left a brief dead window that dropped sidebar taps.
              opacity: isSidebarShape ? 1 : 0,
              visibility: isSidebarShape ? "visible" : "hidden",
              pointerEvents: isSidebarShape ? "auto" : "none",
            }}
          >
            {/* Sidebar top row — toggle + sync flushed right */}
            <div className="flex items-center justify-end h-14 px-3 gap-1 flex-shrink-0">
              <button
                onClick={onToggleSidebar}
                className="flex items-center justify-center h-10 w-10 rounded-full text-foreground/70 active:text-foreground flex-shrink-0"
              >
                <PanelLeft className="h-5 w-5" />
              </button>
              <SyncIconButton />
            </div>

            <SidebarNav pathname={pathname} className="flex-1 min-h-0" />
          </div>
        </GlassContainer>
    </div>
  )
}

// ─── Mobile: bottom pill ↔ sidebar ───────────────────────────

function MobilePillMorph({
  tabs,
  pathname,
  hideNavbar,
  prefersReducedMotion,
}: {
  tabs: readonly BottomNavTab[]
  pathname: string
  hideNavbar: boolean
  prefersReducedMotion: boolean
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const { expandedHeight } = useViewportMeasure()
  const DUR = prefersReducedMotion ? 0 : 190
  const LEAD = prefersReducedMotion ? 0 : 160
  const TOTAL = DUR + LEAD

  const { phase, advancePhase, isSidebarShape } = useMorphPhase(sidebarOpen, TOTAL)

  // Close sidebar on route change
  useEffect(() => {
    setSidebarOpen(false)
  }, [pathname])

  // Settle the phase the instant the morph visually finishes (see desktop), so
  // the sidebar content becomes interactive immediately instead of ~80ms later.
  const handleTransitionEnd = useCallback(
    (e: React.TransitionEvent) => {
      if (e.target !== ref.current) return
      const last = phase === "opening" ? "height" : phase === "closing" ? "transform" : null
      if (last && e.propertyName === last) advancePhase()
    },
    [phase, advancePhase],
  )

  // Mobile morph — always bottom-anchored. pill: bottom-centre, auto width, pill
  // height. opening/closing: height and position+width morph in a sequenced
  // overlap (bottom-anchored, so it grows upward). sidebar: full height,
  // bottom-left. In the pill state only `transform` animates (scroll hide/show).
  const transition =
    phase === "pill"
      ? `transform ${prefersReducedMotion ? 0 : 300}ms ${OVERSHOOT_BEZIER}`
      : morphTransition(phase, DUR, LEAD, "left, transform, width")

  const style: React.CSSProperties = {
    position: "fixed" as const,
    bottom: `calc(${SIDEBAR_MARGIN}px + env(safe-area-inset-bottom, 0px))`,
    left: isSidebarShape ? SIDEBAR_MARGIN : "50%",
    transform: isSidebarShape
      ? "translateX(0)"
      : `translateX(-50%) translateY(${hideNavbar ? "calc(100% + 24px)" : "0%"})`,
    width: isSidebarShape ? SIDEBAR_INNER_WIDTH : "auto",
    height: isSidebarShape ? expandedHeight : PILL_HEIGHT,
    transition,
  }

  return (
    <>
      {/* Backdrop — dark overlay + progressive blur from sidebar edge */}
      <div
        className="fixed inset-0 z-[58] bg-black/50 transition-opacity duration-200"
        style={{
          opacity: sidebarOpen ? 1 : 0,
          pointerEvents: sidebarOpen ? "auto" : "none",
        }}
        onClick={() => setSidebarOpen(false)}
      />
      <div
        className="fixed inset-0 z-[59] transition-opacity duration-200"
        style={{
          opacity: sidebarOpen ? 1 : 0,
          pointerEvents: "none",
          backdropFilter: "blur(16px)",
          WebkitBackdropFilter: "blur(16px)",
          maskImage: "linear-gradient(to right, black, transparent 60%)",
          WebkitMaskImage: "linear-gradient(to right, black, transparent 60%)",
        }}
      />

      <div
        ref={ref}
        className="z-[100]"
        style={style}
        onTransitionEnd={handleTransitionEnd}
      >
        <GlassContainer
          cornerRadius={isSidebarShape ? 20 : 28}
          className="h-full"
          contentClassName="h-full !overflow-hidden !flex !flex-col"
          disableTapFeedback
          spotlight
          morphing={phase === "opening" || phase === "closing"}
        >
          {/* Pill bar — visible when collapsed */}
          <div
            className="flex-shrink-0"
            style={{
              // Only show the (horizontal) pill content once fully settled as a
              // pill — mid-morph the container is the wrong shape so the tabs look
              // squished. Collapsed to 0 height + non-interactive otherwise.
              opacity: phase === "pill" ? 1 : 0,
              visibility: phase === "pill" ? "visible" : "hidden",
              pointerEvents: phase === "pill" ? "auto" : "none",
              height: phase === "pill" ? PILL_HEIGHT : 0,
              transition: "opacity 0.2s ease",
            }}
          >
            <PillBarContent
              tabs={tabs}
              pathname={pathname}
              mode="mobile"
              onToggleSidebar={() => setSidebarOpen(true)}
            />
          </div>

          {/* Sidebar header + nav — visible when expanded */}
          <div
            className="flex flex-col flex-1 min-h-0 transition-opacity duration-200 ease-out"
            style={{
              // The vertical sidebar list isn't "squished" mid-morph (it's just
              // clipped by the growing height, like a drawer), so keep it visible
              // AND interactive for the whole open span. Gating it on the settled
              // phase left a brief dead window that dropped sidebar taps.
              opacity: isSidebarShape ? 1 : 0,
              visibility: isSidebarShape ? "visible" : "hidden",
              pointerEvents: isSidebarShape ? "auto" : "none",
            }}
          >
            {/* Sidebar top row — toggle + sync flushed right */}
            <div className="flex items-center justify-end h-14 px-3 gap-1 flex-shrink-0">
              <button
                onClick={() => setSidebarOpen(false)}
                className="flex items-center justify-center h-10 w-10 rounded-full text-foreground/70 active:text-foreground flex-shrink-0"
              >
                <PanelLeft className="h-5 w-5" />
              </button>
              <SyncIconButton />
            </div>

            <SidebarNav pathname={pathname} className="flex-1 min-h-0" />
          </div>
        </GlassContainer>
      </div>
    </>
  )
}
