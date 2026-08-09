"use client"

import type React from "react"
import { useState, useEffect, useRef, useCallback } from "react"
import { createPortal } from "react-dom"
import { usePathname, useRouter } from "next/navigation"
import Link from "next/link"
import { useReducedMotion, useSpring } from "framer-motion"
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
import { MODAL_SCRIM } from "@/components/ui/chrome-overlays"
import { OVERSHOOT_BEZIER, SETTLE_BEZIER, MORPH_EASE } from "@/lib/motion"
import { GlassContainer } from "@/components/ui/glass-container"
import { useDesktopPill, useHydrated } from "@/hooks/use-is-desktop"
import { useSidebar } from "@/hooks/use-sidebar-context"
import { SIDEBAR_WIDTH_PX } from "@/lib/layout/panel-widths"
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

const SIDEBAR_WIDTH = SIDEBAR_WIDTH_PX
const SIDEBAR_MARGIN = 4 // distance from viewport edge when expanded
const SIDEBAR_INNER_WIDTH = SIDEBAR_WIDTH - SIDEBAR_MARGIN * 2 // 191
const PILL_HEIGHT = 44 // h-11
/**
 * The MOBILE bottom pill is bigger than the desktop one.
 *
 * They are not the same control at the same size: the desktop pill is a row of
 * text tabs in a dense header, the phone's is the app's primary navigation and
 * the only one, with an icon over a label and a thumb rather than a cursor
 * aiming at it. Matched to the platform's own bottom bars (and to Claude's).
 */
const MOBILE_PILL_HEIGHT = 56
/**
 * The bottom bar is a STADIUM — half its own height, so its ends are
 * semicircular and it reads as one continuous capsule, the same rule the 44px
 * controls follow (`CONTROL_RADIUS`). It is only a separate constant because
 * the bar is a different height.
 *
 * A squarer corner was tried at 18 (about a third of the height, the
 * proportion the reference tab bars use) and rejected on the look: what makes
 * those read as squircles is CONTINUOUS CURVATURE, not a smaller radius, and
 * a circular arc at that radius just looks like a rounded rectangle. Drawing
 * the real thing needs `corner-shape`, and a corner shape one engine falls
 * back from would leave iOS and Android with different bars — the one thing
 * the one-look rule forbids. Between a rounded rect and a capsule, the
 * capsule.
 */
const MOBILE_PILL_RADIUS = MOBILE_PILL_HEIGHT / 2
const PILL_TOP = SIDEBAR_MARGIN // top offset — aligns pill center with header center

// ─── Morph timing ────────────────────────────────────────────
// Each geometry property animates over MORPH_DUR; the second group starts a
// LEAD ms in so the two overlap without running at once.
//
// ONE lead for both directions, so opening and closing are exact mirrors — the
// top pill and the bottom pill then perform the same motion as each other and
// as themselves in reverse:
//
//   closing  collapse the height (the top pill upward, the bottom pill
//            downward) → at ~80% collapsed — so the panel is still visibly a
//            panel — start sliding into position and resizing to the pill,
//            finishing the last fifth of the collapse on the way → settle.
//   opening  the same played backwards: move + resize first, then grow the
//            height back out.
//
// The lead is sized so the SECOND group starts while the first still has ~20%
// to run — the two overlap into one continuous motion instead of stalling
// between two steps. With MORPH_EASE, 80% of the travel is done at ~50% of the
// duration, hence LEAD ≈ 0.5 × DUR.
//
// ~400ms in total. At 375ms (190/185) the lead was near-FULL: the collapse was
// all but over before anything moved, and the morph read as two snaps back to
// back — fast, but not fluid. The same 400ms with the groups genuinely
// overlapping is fast AND fluid. A second was fluid but slow to sit through.
// (The leads used to differ too — 160 opening / 185 closing — which made the
// two directions feel like different animations. One lead, both ways.)
const MORPH_DUR = 200
const MORPH_LEAD = 100


/**
 * Kill the browser's long-press link menu on nav items — Android's "Open in new
 * tab / Copy link address" sheet, iOS's link preview. Neither is ever what a tap
 * on the nav meant, and on the pill the press-and-hold is the drag lens's own
 * gesture, so the menu interrupts it outright.
 *
 * This is the engine-independent half: both Chrome and modern Safari drive that
 * menu off a `contextmenu` event and both honour `preventDefault`. The
 * `-webkit-touch-callout: none` on `[data-nav-link]` in globals.css stays for
 * older WebKit, which suppresses the callout without firing the event at all —
 * a prefixed property that is simply inert elsewhere, not a platform branch.
 */
const suppressLinkMenu = (e: React.MouseEvent) => e.preventDefault()

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
 * Crucially the motion never ticks on the MAIN thread. A JS/Framer spring
 * hitches the moment a heavy page (dashboard/FDP) mounts and blocks it; the
 * spring here is solved analytically ONCE per move and handed to WAAPI as
 * transform keyframes, which composite. Works for both the horizontal pill bar
 * and the vertical sidebar (position is always `translate(left, top)`; the
 * changing axis is just whichever of width/height varies). Metrics are
 * measured with a ResizeObserver (setState only in the RO callback) in content
 * coordinates so it's correct inside a scroll area.
 */

/**
 * TWO damped harmonic oscillators (Hooke's law with viscous damping), sampled
 * for WAAPI — one for where the blob is, one for what shape it is.
 *
 * **Travel** is the unit STEP response — mass dragged to a new rest position:
 *
 *   x(t) = 1 − e^(−ζωt)·[cos(ω_d t) + (ζω/ω_d)·sin(ω_d t)]     ω_d = ω√(1−ζ²)
 *
 * heavily damped (ζ 0.78 → ~2% overshoot, one crossing) because a blob that
 * visibly hunts for its seat reads as mechanical — that was the owner's
 * verdict on an earlier bouncy curve.
 *
 * **Shape** is the IMPULSE response of a SECOND, lighter oscillator:
 *
 *   s(t) = e^(−ζ_s ω_s t)·sin(ω_ds t)
 *
 * which is the physically real part the first spring can't express. A soft
 * body's shape has its own stiffness and its own damping, faster and looser
 * than its centre of mass — that is exactly why jelly is still wobbling after
 * it has stopped travelling. Starting from rest it stretches along the
 * direction of travel, crosses through neutral, compresses (~31% of the
 * stretch, the ratio e^(−ζπ/√(1−ζ²)) between consecutive extremes), and rings
 * down.
 *
 * Deriving the squash from the travel spring's own velocity was tried first
 * and is what the physics literally gives you — but at ζ 0.78 the velocity
 * barely reverses (peak −0.02 against +1.0), so the blob stretched on the way
 * out and then simply stopped, with no landing squash at all. Softening the
 * travel damping to grow that lobe brings back the hunting. Two oscillators
 * is both the better-looking answer and the more honest model.
 *
 * Both are normalised to their own peak, so a one-tab hop deforms exactly as
 * much as a five-tab sweep — a short move that deforms proportionally less
 * just looks limp.
 */
/* Softened twice, on the owner's read that it was still "aggressive" and should
   be "like Apple's lens to blob": longer (480 → 620ms), the shape oscillator
   nearly critically damped (ζ 0.32 → 0.72) so it does not ring, and both
   deformations cut to a quarter of where they started (travel 0.20 → 0.06,
   handoff 0.34 → 0.07). At this size the wobble is felt rather than watched,
   which is the whole intent — the blob should look like it has weight, not
   like it is made of jelly. */
const GRAVITY_SPRING_MS = 680
const TRAVEL_ZETA = 0.86
const TRAVEL_OMEGA = 8.4
const SHAPE_ZETA = 0.85
const SHAPE_OMEGA = 7.0
/** Peak deformation along the direction of travel. */
const STRETCH = 0.03
/** How much of it the cross axis gives back — near 1 reads as volume held. */
const CROSS = 0.85
const SPRING_SAMPLES = 40

function springTrack(): { xs: number[]; ss: number[] } {
  const wd = TRAVEL_OMEGA * Math.sqrt(1 - TRAVEL_ZETA * TRAVEL_ZETA)
  const wds = SHAPE_OMEGA * Math.sqrt(1 - SHAPE_ZETA * SHAPE_ZETA)
  const xs: number[] = []
  const raw: number[] = []
  for (let i = 0; i <= SPRING_SAMPLES; i++) {
    const t = i / SPRING_SAMPLES
    const decay = Math.exp(-TRAVEL_ZETA * TRAVEL_OMEGA * t)
    xs.push(1 - decay * (Math.cos(wd * t) + ((TRAVEL_ZETA * TRAVEL_OMEGA) / wd) * Math.sin(wd * t)))
    raw.push(Math.exp(-SHAPE_ZETA * SHAPE_OMEGA * t) * Math.sin(wds * t))
  }
  const peak = Math.max(...raw.map(Math.abs)) || 1
  return { xs, ss: raw.map((s) => s / peak) }
}
type GravRect = { left: number; top: number; width: number; height: number }

/** Sub-pixel-tolerant equality, so a reflow that moves nothing is not news. */
function sameRects(a: GravRect[], b: GravRect[]): boolean {
  if (a.length !== b.length) return false
  return a.every((r, i) => {
    const o = b[i]
    return (
      Math.abs(r.left - o.left) < 0.5 &&
      Math.abs(r.top - o.top) < 0.5 &&
      Math.abs(r.width - o.width) < 0.5 &&
      Math.abs(r.height - o.height) < 0.5
    )
  })
}

function GravityIndicator({
  containerRef,
  activeIndex,
  className,
  revision = "",
  hidden = false,
  instant = false,
}: {
  containerRef: React.RefObject<HTMLElement | null>
  activeIndex: number
  className?: string
  /** Change this when the set/order of items changes so metrics re-measure. */
  revision?: string
  /** Fade the blob out (drag-lens active) while its transform keeps tracking. */
  hidden?: boolean
  /**
   * Place the blob with NO animation. For the frames where animating would be
   * wrong rather than pretty: while the sidebar is still opening (the spring
   * would only get going as the panel lands, so the blob visibly arrived a
   * beat late), and under the drag lens (it must already be where the lens
   * lands, or it springs across the bar the moment the route catches up).
   */
  instant?: boolean
}) {
  const reduce = useReducedMotion()
  const [rects, setRects] = useState<GravRect[]>([])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const measure = () => {
      const base = el.getBoundingClientRect()
      const items = Array.from(el.querySelectorAll<HTMLElement>("[data-grav-item]"))
      const next = items.map((it) => {
        const r = it.getBoundingClientRect()
        return {
          left: r.left - base.left + el.scrollLeft,
          top: r.top - base.top + el.scrollTop,
          width: r.width,
          height: r.height,
        }
      })
      // Only publish a CHANGE. A ResizeObserver fires for plenty of things
      // that move nothing — a route settling, a font landing, a sub-pixel
      // reflow — and each `setRects` with an equal-but-new array re-ran the
      // animation effect. That is the mid-flight flash: the guard below
      // catches a re-fire to the same destination, but only after the
      // measurement has already been taken as news.
      setRects((prev) => (sameRects(prev, next) ? prev : next))
    }
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    // Items themselves can change size/position (e.g. a collapsing sidebar
    // section) without the container resizing — observe them too.
    el.querySelectorAll<HTMLElement>("[data-grav-item]").forEach((it) => ro.observe(it))
    return () => ro.disconnect()
  }, [containerRef, revision])

  // The blob's motion is a real DAMPED HARMONIC OSCILLATOR, not a bezier.
  //
  // Both the travel and the squash are sampled from the SAME spring solution,
  // which is what makes it read as one soft body rather than a box sliding
  // under a separately-authored wobble: the stretch is proportional to the
  // spring's VELOCITY, so the blob is longest exactly when it is moving
  // fastest, and as the spring decelerates the velocity reverses and the
  // stretch becomes a recoil the other way. Hand-keyframed squash could
  // approximate the shape but never stayed in step with the travel.
  //
  // Damping is deliberately high (`ZETA` 0.78 → ~2% overshoot). The owner
  // rejected a bouncy position curve before — a blob that visibly hunts for
  // its seat reads as mechanical. All the elasticity a viewer actually
  // registers is in the shape; the position just needs to arrive like mass on
  // a spring rather than on a curve someone drew.
  //
  // Sampled to keyframes and handed to WAAPI rather than ticked in JS: a
  // main-thread spring hitches when a heavy page mounts (that is why this was
  // a CSS transition before). Transform keyframes with linear easing
  // composite, so the physics runs off the main thread.
  const target = rects[activeIndex]
  const blobRef = useRef<HTMLDivElement>(null)
  const prevTargetRef = useRef<{ left: number; top: number } | null>(null)
  const travelRef = useRef<Animation | null>(null)
  const shapeRef = useRef<Animation | null>(null)
  const animatedToRef = useRef<{ left: number; top: number } | null>(null)

  useEffect(() => {
    const shape = blobRef.current
    const box = shape?.parentElement
    const t = rects[activeIndex]
    const prev = prevTargetRef.current
    prevTargetRef.current = t ? { left: t.left, top: t.top } : null
    // No animation on the first placement, when the blob is parked instantly,
    // or for a re-measure that didn't actually move it.
    if (!shape || !box || !t || !prev || reduce || instant) return
    if (Math.abs(t.left - prev.left) < 1 && Math.abs(t.top - prev.top) < 1) return

    // Already on the way there. This effect re-runs whenever `rects` is
    // re-measured — the sidebar's ResizeObserver fires as the route settles —
    // and firing a SECOND spring to the same destination mid-flight is what
    // made the blob look like it flashed twice on its way across.
    const going = animatedToRef.current
    if (going && Math.abs(going.left - t.left) < 1 && Math.abs(going.top - t.top) < 1) return

    // An interrupted move continues from where the blob actually IS, not from
    // where the last one started — otherwise a tap mid-flight snaps it back to
    // the previous tab before setting off again. Read BEFORE cancelling: once
    // cancelled the computed value reverts to the inline style, which is
    // already the new target.
    let fromLeft = prev.left
    let fromTop = prev.top
    if (travelRef.current?.playState === "running") {
      const m = new DOMMatrixReadOnly(getComputedStyle(box).transform)
      fromLeft = m.m41
      fromTop = m.m42
    }
    travelRef.current?.cancel()
    shapeRef.current?.cancel()

    const dx = t.left - fromLeft
    const dy = t.top - fromTop
    animatedToRef.current = { left: t.left, top: t.top }

    const { xs, ss } = springTrack()
    const along = Math.abs(dx) >= Math.abs(dy)

    // Travel: the spring's displacement, from where it was to where it goes.
    travelRef.current = box.animate(
      xs.map((x) => ({
        transform: `translate(${fromLeft + dx * x}px, ${fromTop + dy * x}px)`,
      })),
      { duration: GRAVITY_SPRING_MS, easing: "linear" },
    )

    // Shape: the ringing oscillator. Signed, so the landing squash and the
    // ring-down after it come from the same curve as the outward stretch.
    shapeRef.current = shape.animate(
      ss.map((s) => {
        const stretch = 1 + STRETCH * s
        const across = 1 - STRETCH * s * CROSS
        return { transform: `scale(${along ? stretch : across}, ${along ? across : stretch})` }
      }),
      { duration: GRAVITY_SPRING_MS, easing: "linear" },
    )
  }, [activeIndex, rects, reduce, instant])

  return (
    <div
      aria-hidden
      data-grav-blob
      hidden={!target || activeIndex < 0}
      className="absolute left-0 top-0 z-0"
      // `pointer-events:none` inline (belt-and-suspenders) — the blob sits over
      // the active item, and on iOS a *composited* layer (it transforms) can
      // occasionally swallow a touch despite the class. No `will-change` so the
      // layer isn't promoted persistently (the transform transition still
      // composites while animating, so nav stays smooth).
      style={{
        pointerEvents: "none",
        opacity: hidden ? 0 : 1,
        transform: target ? `translate(${target.left}px, ${target.top}px)` : undefined,
        width: target?.width,
        height: target?.height,
        // `transform` is deliberately NOT in this list — the spring above owns
        // it, and a CSS transition on the same property would race the WAAPI
        // animation to the same endpoint (the inline value is already the
        // target, so the animation simply falls back onto it when it
        // finishes). Only the box's SIZE eases, a touch quicker than the
        // spring so a widening tab has settled before the blob stops moving.
        // Opacity eases even when `instant` is set, because `instant` is about
        // PLACEMENT. The drag lens's release un-hides the blob at the
        // destination and then dissolves the glass off it, so a hard 0→1 here
        // would pop the highlight in under a bead that is still flying; over
        // 0.34s it comes up as the lens arrives.
        transition: [
          ...(reduce || instant
            ? []
            : [`width 0.34s ${SETTLE_BEZIER}`, `height 0.34s ${SETTLE_BEZIER}`]),
          ...(reduce ? [] : ["opacity 0.34s ease"]),
        ].join(", ") || "none",
      }}
    >
      <div
        ref={blobRef}
        // `--on-glass-active` — the SAME fill an action button gets when it is
        // the active option. The blob and that chip say the same thing ("this
        // is the one you are on"), so a grey blob here and a tinted chip in
        // the header read as two different systems.
        //
        // Opaque, like everything painted on glass: it sits on a translucent
        // slab, so a translucent fill lets the page through twice and the
        // highlight changes tone as the list scrolls underneath it.
        className={cn("h-full w-full rounded-full bg-[var(--on-glass-active)]", className)}
      />
    </div>
  )
}

// ─── Shared pill bar content ─────────────────────────────────

/** Very underdamped so the drag lens BOUNCES like liquid — off the end tabs and
 *  on the drop-splat settle (a springier squash-and-stretch rebound). */
const SQUISH_SPRING = { stiffness: 600, damping: 10, mass: 0.85 }

/** Extra height beyond the pill — the drag lens overhangs top and bottom by
 *  half this. Only a little: the lens is a bead lying ON the bar, not a bubble
 *  floating over it, and everything it overhangs is covered by the refraction
 *  layer's page-coloured fill. */
const LENS_OVERHANG = 10
/** Extra width beyond the tab — keeps the bubble a horizontal stadium, not a
 *  circle, over narrow tabs (matches Apple's tab-bar lens proportions). */
const LENS_PAD_X = 26
/**
 * The mobile sidebar's backdrop blur, as a real PROGRESSIVE blur: heaviest
 * against the sidebar's edge and gone by the far side of the screen.
 *
 * A single blurred layer behind an alpha ramp — which is what this was — does
 * not do that. It cross-fades a fully blurred page with a fully sharp one, so
 * the middle reads as a ghosted double image rather than as "less blurred".
 * A ramp of RADII is what reads as depth.
 *
 * Ordered smallest-radius/widest first, so each layer completely covers the
 * ones below it wherever they are opaque: the stack can then only ever add
 * blur, and the ramp stays monotonic whether or not the engine composes one
 * layer's output into the next one's backdrop (Blink does, WebKit may not).
 * That is the whole reason this is safe to stack when the glass material is
 * not — these are PURE blurs, so the two engines differ by a few px of
 * effective radius near the edge instead of by colour.
 *
 * Each layer is only as WIDE as it needs to be, rather than full-screen: the
 * total blur work is ~20% more than the single 16px full-screen layer it
 * replaces, not 3x. `solid` is where that layer's own ramp starts, as a
 * fraction of its own width.
 */
const SIDEBAR_BACKDROP_BLUR = [
  { blur: 4, width: "92%", solid: "45%" },
  { blur: 10, width: "68%", solid: "40%" },
  { blur: 20, width: "46%", solid: "35%" },
] as const

/**
 * How much the PILL is squeezed inside the lens — vertically ONLY.
 *
 * A horizontal bar of glass lying across the pill compresses it along one axis:
 * the control gets shorter, it does not get smaller. The copy's content is
 * counter-scaled by 1/this, so the labels keep their true size and shape while
 * the control around them squashes — which is what makes it read as the SAME
 * pill seen through glass rather than a smaller pill drawn on top.
 *
 * (It used to be a uniform `scale(0.82)`, which shrank the text too. That
 * reads as a minifying lens held well above the bar, not as glass resting on
 * it.)
 *
 * How far it can go is set by the CONTENT, not by taste: the counter-scaled row
 * still has to fit inside the copy's box, which is the pill's true height. The
 * mobile pill's tab item is 44px inside a 56px bar, so 44 / 0.84 ≈ 52px — just
 * inside. Squeeze harder and the icons and labels get clipped by the copy's own
 * edge, which is what a first pass at 0.72 did: the labels vanished inside the
 * lens entirely.
 */
const LENS_SQUASH = 0.84

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
  // pre-highlights and the grey blob hides. On RELEASE the lens itself
  // SHRINKS + MORPHS into the grey highlight blob — a compositor-only landing
  // (CSS `translate` + `scale`, a crossfade swapping its glass material for
  // the blob's grey), landing exactly where the real blob sits — then the real
  // blob is swapped in invisibly. A plain tap never activates
  // it (10px slop). Rendered through a portal — the pill's GlassContent clips
  // overflow, and the lens must overhang it. The lens's animation classes
  // (--on / --settle) are managed IMPERATIVELY and its React className stays
  // constant, so drag re-renders can't strip them.
  const lensRef = useRef<HTMLDivElement | null>(null)
  /** Scaled about the lens centre — this is what squeezes the copy. */
  const refractInnerRef = useRef<HTMLDivElement | null>(null)
  /** Holds the cloned tab strip, positioned to sit exactly over the real one. */
  const refractCopyRef = useRef<HTMLDivElement | null>(null)
  const [lensPhase, setLensPhase] = useState<"idle" | "drag" | "settle">("idle")
  /** Bumped when the drag lens hands the blob back — see GravityIndicator. */
  const [lensIndex, setLensIndex] = useState(-1)
  // Chromium-only real refraction map — the backdrop (the pill) genuinely
  // MINIFIES through the lens's bezel, like Apple's glass. Generated once when
  // the drag starts (Safari keeps null → the CSS convex material fallback).
  const suppressClickRef = useRef(false)
  const lastPtRef = useRef({ x: 0, y: 0 })
  const settleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // The pill's GlassContainer — its finger-tracking spotlight is driven
  // imperatively while the lens has pointer capture (its own move handler
  // stops firing, so the glow would otherwise freeze).
  const glassRootRef = useRef<HTMLElement | null>(null)
  const dragRef = useRef<{
    startX: number
    active: boolean
    nearest: number
    base: { left: number; top: number; width: number; height: number }
    /** The whole glass pill, which is what the lens shows a smaller copy of. */
    pill: { left: number; top: number; width: number; height: number }
    rects: { left: number; top: number; width: number; height: number }[]
  } | null>(null)

  // Liquid edge-bounce deformation. Pushing the lens against the first/last tab
  // COMPRESSES it into the wall (scaleX↓, scaleY↑) and strains it toward the
  // finger; leaving the edge or releasing lets these underdamped springs
  // overshoot back to neutral — a water-like wobble. Written to the lens's
  // `transform` imperatively; the pop-in uses the separate CSS `scale`
  // property, so the two never fight.
  const squishX = useSpring(1, SQUISH_SPRING)
  const squishY = useSpring(1, SQUISH_SPRING)
  const nudgeX = useSpring(0, SQUISH_SPRING)
  useEffect(() => {
    const write = () => {
      const lens = lensRef.current
      if (!lens) return
      lens.style.transform = `translateX(${nudgeX.get()}px) scale(${squishX.get()}, ${squishY.get()})`
    }
    const unsub = [squishX.on("change", write), squishY.on("change", write), nudgeX.on("change", write)]
    return () => unsub.forEach((u) => u())
  }, [squishX, squishY, nudgeX])


  /**
   * Snapshot the live tab strip into the lens. Re-taken when the lens crosses
   * to another tab so the copy shows the same pre-highlight the real strip
   * does — it is a few icons and labels, nothing like the raster the old
   * displacement map rebuilt on the same event.
   */
  useEffect(() => {
    const host = refractCopyRef.current
    // The whole glass pill, not just the tab strip: the lens has to show the
    // control's rounded top and bottom edges shrunk too, or the labels look
    // shrunk while the pill around them doesn't and the illusion breaks.
    const source = tabsRef.current?.closest(".GlassContainer") as HTMLElement | null
    // Only while DRAGGING. This is a deep clone of the whole pill plus a layout
    // pass, and `lensPhase` also changes on RELEASE — so the settle used to
    // rebuild the copy synchronously on the very frame the landing starts, and
    // then throw it away as it faded. That hitch was the first thing you saw of
    // the morph into the blob.
    if (!host || !source || lensPhase !== "drag") return
    host.replaceChildren()
    const clone = source.cloneNode(true) as HTMLElement
    clone.style.width = "100%"
    clone.style.height = "100%"
    // The live pill blooms under the finger; the copy must not inherit that
    // frozen transform on top of the lens's own scaling.
    clone.style.transform = "none"
    clone.setAttribute("aria-hidden", "true")
    clone.removeAttribute("id")
    clone.querySelectorAll("[id]").forEach((n) => n.removeAttribute("id"))
    // Strip the cloned glass's FIVE backdrop-filters. They are the single most
    // expensive thing the lens carried: inside a clipped, transformed layer
    // they have almost nothing to sample (which is why -refractCopy paints its
    // own face at all), yet they re-sample every frame the lens moves or
    // scales AND they stop the lens being promoted to a plain composited
    // layer — so the landing was re-rasterising a text-laden subtree while the
    // main thread mounted a route. The ambient specular animation goes with
    // them; a 60s keyframe on a copy that lives for one gesture is pure cost.
    clone.style.animation = "none"
    clone.querySelectorAll<HTMLElement>(".GlassMaterial > div").forEach((n) => {
      n.style.backdropFilter = "none"
      n.style.setProperty("-webkit-backdrop-filter", "none")
    })
    // The wrapper squeezes the copy vertically; counter-scale the row inside it
    // so only the CONTROL gets shorter and the labels keep their true size and
    // shape. Squashing the glyphs too is what made the old uniform-scale lens
    // read as a smaller pill rather than the same one under glass.
    const row = clone.querySelector<HTMLElement>("[data-pill-row]")
    if (row) {
      row.style.transformOrigin = "50% 50%"
      row.style.transform = `scaleY(${1 / LENS_SQUASH})`
    }
    host.appendChild(clone)
  }, [lensPhase, lensIndex])

  const paintSpotlight = useCallback((clientX: number, clientY: number) => {
    const gr = glassRootRef.current
    if (!gr) return
    const rect = gr.getBoundingClientRect()
    gr.style.setProperty("--press-x", `${clientX - rect.left}px`)
    gr.style.setProperty("--press-y", `${clientY - rect.top}px`)
  }, [])

  const positionLens = useCallback((clientX: number, clientY: number) => {
    lastPtRef.current = { x: clientX, y: clientY }
    const lens = lensRef.current
    const drag = dragRef.current
    if (!lens || !drag || drag.rects.length === 0) return
    const rects = drag.rects
    const localX = Math.max(0, Math.min(drag.base.width, clientX - drag.base.left))
    let nearest = 0
    let best = Infinity
    rects.forEach((r, i) => {
      const d = Math.abs(localX - (r.left + r.width / 2))
      if (d < best) {
        best = d
        nearest = i
      }
    })
    if (nearest !== drag.nearest) {
      drag.nearest = nearest
      setLensIndex(nearest)
    }
    const r = rects[nearest]
    const w = r.width + LENS_PAD_X
    // Sized and centred on the PILL. It used to use the tab strip's height,
    // which is shorter than the control — the minified copy then sat with ~7px
    // of clearance and looked like a crop rather than something under glass.
    const h = drag.pill.height + LENS_OVERHANG
    // Clamp the lens CENTRE to the first/last tab centres so the bubble never
    // leaves the tab strip. The finger's pull PAST an end tab has nowhere to
    // go — it becomes `overshoot`, which drives the liquid edge bounce.
    const firstCenter = drag.base.left + rects[0].left + rects[0].width / 2
    const lastCenter =
      drag.base.left + rects[rects.length - 1].left + rects[rects.length - 1].width / 2
    const centerX = Math.max(firstCenter, Math.min(lastCenter, clientX))
    const overshoot = clientX - centerX // signed; 0 unless past an end tab
    // Pure finger follow (1:1) via direct px writes — no CSS transition on
    // geometry, so it never lags or snaps. The release spring is framer.
    const lensLeft = centerX - w / 2
    const lensTop = drag.pill.top + drag.pill.height / 2 - h / 2
    lens.style.width = `${w}px`
    lens.style.height = `${h}px`
    lens.style.left = `${lensLeft}px`
    lens.style.top = `${lensTop}px`

    // The refraction: a copy of the pill laid exactly over the real one, then
    // squeezed VERTICALLY about the LENS CENTRE. Nothing moves horizontally,
    // so the copy stays aligned with the original and the lens edge reads as
    // continuous — the control just gets shorter inside the lens.
    //
    // A copy rather than a displacement filter because this has to look the
    // same on both engines: `backdrop-filter: url(#…)` is Chromium-only, and
    // the map it needs was what made the gesture stutter. This is one
    // composited transform.
    //
    // `drag.pill` is the pill's UNTRANSFORMED box (taken at pointerdown, before
    // the press bloom lands), so the copy carries the pill's live transform on
    // top of it — the same translate+scale framer is writing inline while the
    // finger is down. Without it the copy sits at the pill's resting size while
    // the original is bloomed ~4.5% larger, and the labels visibly double at
    // the lens edge. Read off the inline style, not getComputedStyle: framer
    // wrote it this frame, so there's no style flush to force.
    const copy = refractCopyRef.current
    if (copy) {
      copy.style.left = `${drag.pill.left - lensLeft}px`
      copy.style.top = `${drag.pill.top - lensTop}px`
      copy.style.width = `${drag.pill.width}px`
      copy.style.height = `${drag.pill.height}px`
      copy.style.transform = glassRootRef.current?.style.transform ?? ""
    }

    // Liquid wall: compress into the edge + strain toward the finger. The
    // underdamped springs make leaving the edge / releasing bounce back.
    const t = Math.min(Math.abs(overshoot) / 90, 1)
    squishX.set(1 - t * 0.16)
    squishY.set(1 + t * 0.12)
    nudgeX.set(Math.sign(overshoot) * t * 12)
    paintSpotlight(clientX, clientY)
  }, [paintSpotlight, squishX, squishY, nudgeX])

  // Portal mount: position immediately from the live drag state, then reveal
  // on the next frame so the pop-in transition fires from the base styles.
  const lensMountRef = useCallback((node: HTMLDivElement | null) => {
    lensRef.current = node
    const drag = dragRef.current
    if (!node || !drag) return
    positionLens(lastPtRef.current.x, lastPtRef.current.y)
    requestAnimationFrame(() => node.classList.add("PillDragLens--on"))
  }, [positionLens])

  const handleLensDown = useCallback((e: React.PointerEvent) => {
    if (reduce || lensPhase === "settle") return
    const el = tabsRef.current
    if (!el) return
    const base = el.getBoundingClientRect()
    lastPtRef.current = { x: e.clientX, y: e.clientY }
    glassRootRef.current = (el.closest(".GlassContainer") as HTMLElement) ?? null
    const pillRect = (glassRootRef.current ?? el).getBoundingClientRect()
    dragRef.current = {
      startX: e.clientX,
      active: false,
      nearest: -1,
      base: { left: base.left, top: base.top, width: base.width, height: base.height },
      pill: {
        left: pillRect.left,
        top: pillRect.top,
        width: pillRect.width,
        height: pillRect.height,
      },
      rects: Array.from(el.querySelectorAll<HTMLElement>("[data-grav-item]")).map((it) => {
        const r = it.getBoundingClientRect()
        return { left: r.left - base.left, top: r.top - base.top, width: r.width, height: r.height }
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
      // Take over the pill's spotlight — its own move handler is about to stop.
      glassRootRef.current?.style.setProperty("--glass-press", "1")
      try {
        tabsRef.current?.setPointerCapture(e.pointerId)
      } catch {
        // capture can fail if the pointer is already gone — lens still tracks
      }
    }
    positionLens(e.clientX, e.clientY)
  }, [positionLens])

  const handleLensEnd = useCallback((e: React.PointerEvent) => {
    const drag = dragRef.current
    dragRef.current = null
    // Fade the pill spotlight back out. Kill the horizontal strain INSTANTLY
    // (jump, not set) so releasing never springs the lens left/right.
    glassRootRef.current?.style.setProperty("--glass-press", "0")
    nudgeX.jump(0)
    if (!drag?.active) return
    // Swallow the click synthesised at the end of the drag; the timeout clears
    // the flag if pointer capture already ate the click (so the NEXT tap works).
    suppressClickRef.current = true
    setTimeout(() => {
      suppressClickRef.current = false
    }, 150)

    const lens = lensRef.current
    if (e.type === "pointercancel" || drag.nearest < 0 || !lens) {
      squishX.jump(1)
      squishY.jump(1)
      setLensPhase("idle")
      setLensIndex(-1)
      return
    }

    // Release = a slime drop, seen bird's-eye: the lens descends straight onto
    // the tab and lands with a squash-and-stretch. The --settle crossfade swaps
    // glass → the grey blob underneath, so the handoff to the real blob is
    // invisible.
    //
    // It rides `translate` + `scale` — the standalone CSS properties, each with
    // its OWN transition — so the whole landing is a compositor animation and
    // the two halves keep their separate characters: position with no
    // overshoot (it must never spring left/right), shape with one, which is the
    // splat. Splitting them is only possible because they are separate
    // properties; a single `transform` could not carry two easings.
    //
    // It used to be framer `animate()` on left/top/width/height. Both halves of
    // that were wrong for this moment: JS springs tick on the MAIN thread, and
    // the release also fires `router.push`, so the landing was competing with a
    // route mount and visibly stalled — the same reason the gravity blob is a
    // CSS transition. And animating left/top/width/height means a layout pass
    // AND a re-rastered backdrop-filter every frame, on a box that is changing
    // size. Nothing here touches layout now.
    setLensPhase("settle")
    const r = drag.rects[drag.nearest]
    const lensW = parseFloat(lens.style.width) || r.width
    const lensH = parseFloat(lens.style.height) || r.height
    const dx = drag.base.left + r.left + r.width / 2 - (parseFloat(lens.style.left) + lensW / 2)
    const dy = drag.base.top + r.top + r.height / 2 - (parseFloat(lens.style.top) + lensH / 2)
    // Hand the shape over to `scale`: the springs' job (the edge bounce) is
    // done, and leaving them mid-flight would have them writing `transform` on
    // the main thread underneath the landing.
    squishX.jump(1)
    squishY.jump(1)
    lens.style.transform = "none"
    // The splat keyframes read these; `scale` itself is left to the animation
    // (an animation outranks inline style, but setting both invites confusion).
    lens.style.setProperty("--lens-to-x", `${r.width / lensW}`)
    lens.style.setProperty("--lens-to-y", `${r.height / lensH}`)
    lens.classList.add("PillDragLens--settle")
    lens.style.translate = `${dx}px ${dy}px`
    const tab = TAB_CONFIG[tabs[drag.nearest]]
    if (tab) router.push(tab.href)
    // Outlast the splat's rebound before handing off to the real blob, or the
    // last of the squash gets cut.
    if (settleTimerRef.current) clearTimeout(settleTimerRef.current)
    settleTimerRef.current = setTimeout(() => {
      setLensPhase("idle")
      setLensIndex(-1)
      // No arrival wobble here any more. It existed to cover the hard cut
      // when the lens's opaque copy was swapped for the real blob; the blob is
      // now already in place and lit, and a wobble after everything has come
      // to rest reads as a second arrival.
    }, 620)
  }, [tabs, router, squishX, squishY, nudgeX])

  useEffect(() => () => {
    if (settleTimerRef.current) clearTimeout(settleTimerRef.current)
  }, [])

  const lensActive = lensPhase !== "idle"

  return (
    <div
      data-pill-row
      className={cn(
        "flex items-center px-1.5",
        // The bottom bar is the taller of the two — see MOBILE_PILL_HEIGHT.
        mode === "desktop" ? "h-11" : "h-14"
      )}
    >
      {/* Sidebar toggle — fixed width bookend */}
      <button
        onClick={onToggleSidebar}
        className="flex items-center justify-center h-8 w-8 rounded-full text-foreground flex-shrink-0"
      >
        <PanelLeft className="h-5 w-5" />
      </button>

      {/* Tabs — equally spaced, fill remaining space. The gravity blob sits
          behind the labels and stretches between tabs as the route changes.
          touch-action:none so hold-and-slide streams pointermoves on iOS; the
          links cancel `contextmenu` so the hold never pops the browser's own
          link menu on top of the lens (see suppressLinkMenu). */}
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
          // While the lens is up the blob tracks the tab UNDER IT, instantly.
          // It is invisible then, so the move costs nothing to look at — and it
          // means that when the lens fades the blob is already exactly where
          // the lens landed. Left on the old active tab it would spring across
          // the whole bar the moment the route caught up, which is the
          // left-and-right springing that made the landing look mechanical.
          activeIndex={lensActive && lensIndex >= 0 ? lensIndex : activeIndex}
          revision={tabs.join(",")}
          // Hidden only while the finger is DRAGGING. On release it fades up
          // at the destination, behind the row, so the glass dissolves onto a
          // highlight that already has the icon and label on it. The lens used
          // to paint its own opaque copy instead, which sat OVER the content.
          hidden={lensPhase === "drag"}
          instant={lensActive}
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
            <Link
              key={tabKey}
              href={tab.href}
              data-nav-link
              draggable={false}
              onContextMenu={suppressLinkMenu}
              className="relative z-[1]"
            >
              {mode === "desktop" ? (
                <span
                  data-grav-item
                  className={cn(
                    "inline-flex items-center justify-center h-8 px-3.5 rounded-full text-sm font-medium transition-colors",
                    highlighted
                      ? "text-[var(--on-glass-active-fg)]"
                      : "text-foreground"
                  )}
                >
                  {tab.label}
                </span>
              ) : (
                <span
                  data-grav-item
                  className={cn(
                    "inline-flex flex-col items-center justify-center gap-0.5 h-12 px-3 rounded-full transition-colors",
                    highlighted
                      ? "text-[var(--on-glass-active-fg)]"
                      : "text-foreground"
                  )}
                >
                  <Icon className="h-[22px] w-[22px]" />
                  <span className="text-[10px] leading-none">{tab.label}</span>
                </span>
              )}
            </Link>
          )
        })}
      </div>

      {/* Drag lens portal — fixed-positioned so it can overhang the pill
          (GlassContent clips its own overflow). The convex `-glass` material
          is the lens on every platform: an inner thickness vignette fakes the
          pinch, and the chromatic `-rim` adds the liquid dispersion fringe.
          Both fade to the grey child (--settle) as the lens morphs into the
          blob.

          `-refract` is the actual refraction: a clipped copy of the pill,
          squeezed VERTICALLY about the lens centre over a layer carrying the
          page's own background (which covers the original — see globals.css).
          The control is visibly SHORTER inside the lens and unchanged outside
          it, the way a bar of glass lying across it would compress it, while
          the labels keep their true size.

          This replaced a Chromium-only displacement map applied through
          `backdrop-filter: url(#…)`. Same effect, both engines, and it is one
          composited transform instead of a megapixel raster rebuilt every time
          the finger crossed to another tab. */}
      {lensActive &&
        typeof document !== "undefined" &&
        createPortal(
          <div ref={lensMountRef} aria-hidden className="PillDragLens">
            <div className="PillDragLens-glass" />
            <div className="PillDragLens-refract">
              <div
                ref={refractInnerRef}
                className="PillDragLens-refractInner"
                style={{ "--lens-squash": LENS_SQUASH } as React.CSSProperties}
              >
                <div ref={refractCopyRef} className="PillDragLens-refractCopy" />
              </div>
            </div>
            <div className="PillDragLens-rim" />
          </div>,
          document.body
        )}

      {/* Sync status — fixed width bookend */}
      <SyncIconButton />
    </div>
  )
}

// ─── Shared sidebar nav content ──────────────────────────────

/** Height of the floating toggle/sync strip the nav scrolls beneath. */
/* The band the drawer + sync icons float in. It is the PILL's height, so the
   two sets of icons land on the same line when the nav is a sidebar and when
   it is a pill — at 56 against a 44px pill the sidebar's sat visibly lower. */
const SIDEBAR_HEADER_HEIGHT = PILL_HEIGHT

/**
 * The sidebar's floating top strip: the drawer toggle and the sync icon, over
 * a band that the list scrolls beneath.
 *
 * ONE definition for both morphs. These were two copies, and they drifted —
 * the mobile one spent a while laid out as an ordinary row, so the
 * scroll-under only worked on desktop.
 *
 * The band CAPTURES taps. It used to be `pointer-events-none` so only the two
 * controls were hit-testable, which meant a nav item dissolving underneath the
 * icons could still be tapped — you would aim at nothing and land on Airports.
 * The strip is a real surface now: the buttons work, the rest of the band
 * swallows the touch.
 */
function SidebarTopStrip({ onToggle }: { onToggle: () => void }) {
  return (
    <div
      className="absolute inset-x-0 top-0 z-[2] flex items-center justify-end px-3 gap-1"
      style={{ height: SIDEBAR_HEADER_HEIGHT }}
      // Bare-area tap scrolls the nav list back to top, same as tapping the
      // main/detail headers. The strip captures taps anyway (see above), so
      // anything that isn't one of the two buttons is "bare" — including the
      // blur layer, which covers the band.
      onClick={(e) => {
        if ((e.target as HTMLElement).closest("button")) return
        e.currentTarget.parentElement
          ?.querySelector("nav")
          ?.scrollTo({ top: 0, behavior: "smooth" })
      }}
    >
      {/* Frosts whatever is passing underneath. Masked so the blur is
          strongest at the very top and gone by the bottom of the band, which
          is what makes it read as content emerging rather than a hard edge.
          One element, one filter list — see globals.css on why the glass
          itself must never go back to stacking these. */}
      <div aria-hidden className="SidebarTopBlur" />
      <button
        onClick={onToggle}
        className="relative flex items-center justify-center h-8 w-8 rounded-full text-foreground flex-shrink-0"
      >
        <PanelLeft className="h-5 w-5" />
      </button>
      <SyncIconButton className="relative" />
    </div>
  )
}

function SidebarNav({
  pathname,
  className,
  topInset = 0,
}: {
  pathname: string
  className?: string
  /** Space reserved at the top for chrome floating over the list. */
  topInset?: number
}) {
  const navRef = useRef<HTMLElement>(null)
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const toggleSection = (label: string) => {
    setCollapsed((prev) => ({ ...prev, [label]: !prev[label] }))
  }

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

  /**
   * The dissolve as the list passes under the floating toggle/sync strip — the
   * same read as the main panel's header fade. A painted scrim can't be used
   * here: the panel is translucent glass, so the content is masked out rather
   * than covered up.
   *
   * A plain ramp across the whole inset, so an item travelling under the icons
   * stays READABLE while it fades. It used to hold at fully transparent for the
   * first third, which meant the band under the icons was simply blank — the
   * list appeared to stop at the icons rather than run beneath them.
   *
   * The blob is inside this scroller, so this one mask covers it too and it
   * dissolves under the strip along with its own row. It used to sit in a
   * separate overlay that needed the mask applying twice — and when it didn't,
   * the blob stayed solid in a band where its row had already vanished.
   */
  const chromeMask = topInset
    ? `linear-gradient(to bottom, transparent 0, black ${topInset}px)`
    : undefined
  const maskStyle = chromeMask
    ? { maskImage: chromeMask, WebkitMaskImage: chromeMask }
    : {}

  return (
    <div className={cn("relative min-h-0", className)}>
      <nav
        ref={navRef}
        className="relative z-[1] h-full overflow-y-scroll overscroll-contain px-panel pb-4 scrollbar-hide"
        style={{
          WebkitOverflowScrolling: "touch",
          touchAction: "pan-y",
          paddingTop: topInset,
          ...maskStyle,
        }}
      >
      {/* The blob lives INSIDE the scroller, so it scrolls with the content on
          the compositor. It used to sit in a non-scrolling overlay translated
          by -scrollTop from a scroll listener, which is a main-thread response
          to a scroll that has already happened — hence the blob visibly
          trailing the items by a frame. Being inside means the nav's own mask
          covers it too, so it dissolves under the top strip along with its own
          row (which is why it no longer needs a separate masked layer). */}
      {/* ALWAYS instant in the sidebar. The spring is a pill-bar effect: the
          list is a scroller whose metrics re-measure as a route settles and as
          the panel finishes morphing, and every re-measure was another chance
          for the blob to re-fire and read as a double flash. A vertical list
          also gives the travel nothing to say — the blob just moves down a row.
          Do not put the animation back here to match the pill. */}
      <GravityIndicator
        containerRef={navRef}
        activeIndex={activeIndex}
        className="rounded-full"
        revision={orderedHrefs.join(",")}
        instant
      />

      {/* One pixel taller than the scroller so the list always has somewhere to
          go: a short nav would otherwise be inert to a drag, which reads as the
          panel being stuck rather than simply full. */}
      <div className="min-h-[calc(100%+1px)]">
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
              <span className="text-xs font-semibold uppercase tracking-wider text-[var(--on-glass-muted)]">
                {section.label}
              </span>
              <ChevronDown
                className={cn(
                  "h-4 w-4 text-[var(--on-glass-muted)] transition-transform duration-200",
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
      </div>
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
      data-nav-link
      draggable={false}
      onContextMenu={suppressLinkMenu}
      className={cn(
        "relative z-[1] flex items-center gap-3 px-3 py-2 rounded-full text-sm transition-all duration-150",
        "active:scale-[0.98]",
        isActive
          ? "text-[var(--on-glass-active-fg)] font-medium"
          : "text-foreground hover:bg-[var(--on-glass-fill-soft)]"
      )}
    >
      <span className={cn("flex-shrink-0 [&_svg]:!size-5", isActive ? "text-[var(--on-glass-active-fg)]" : "text-foreground")}>
        {icon}
      </span>
      {label}
    </Link>
  )
}

// ─── Viewport measurement hook ───────────────────────────────

/**
 * The sidebar's open height, as a CSS length rather than a measurement.
 *
 * It used to be `window.innerHeight` minus the margins, re-measured on resize.
 * That is not the box a `position: fixed` element is laid out in once a
 * browser has chrome of its own: on iPad Safari in PORTRAIT the sidebar came
 * out taller than the visible page and overshot both ends, its top strip
 * clipped away. `100%` here resolves against the fixed element's own
 * containing block — the viewport, which is precisely the box a fixed element
 * is allowed to occupy (a browser keeps fixed content clear of its toolbars,
 * and an installed app has none). The panel is therefore exactly as tall as
 * the visible app on every surface, with no listener and nothing to fall out
 * of sync. Do not swap it for a viewport UNIT: `vh` is the large viewport in a
 * browser tab and would overshoot again, which is the bug this replaced.
 *
 * BOTH ends come off, not just the top. The desktop panel is top-anchored and
 * the mobile one bottom-anchored, and each has to end clear of the OTHER end
 * too: subtracting only the top left the desktop panel running into the home
 * indicator and put the mobile panel's top strip under the status bar. The
 * lower end is `--nav-bottom-offset` (globals.css) — the ONE "how far above
 * the physical bottom the nav rests" number shared with the bottom pill and
 * the scroll clearance, so the sidebar's lower edge, the pill, and a
 * scrolled-to-rest last row all land on the same line just above the home
 * indicator's bar.
 */
const NAV_BOTTOM_OFFSET = `var(--nav-bottom-offset, ${SIDEBAR_MARGIN}px)`
const EXPANDED_HEIGHT =
  `calc(100% - ${SIDEBAR_MARGIN}px - env(safe-area-inset-top, 0px)` +
  ` - ${NAV_BOTTOM_OFFSET} - var(--install-banner-height, 0px))`

// ─── Main export ─────────────────────────────────────────────

export function NavPill() {
  const canPush = useDesktopPill()
  const hydrated = useHydrated()
  const { isOpen: sidebarOpen, toggle: toggleSidebar } = useSidebar()
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
 * - opening (pill→sidebar): position+width lead (delay 0), height follows.
 * - closing (sidebar→pill): height leads (delay 0), position+width follow.
 * Same `lead` both ways, so the two directions are mirrors of each other.
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

/**
 * The pill's natural (content) width in px — measured, because `width: auto`
 * CANNOT be transitioned.
 *
 * `width` rides in the same transition group as `left`/`transform` so the pill
 * resizes WHILE it moves. With `auto` as the pill endpoint there is nothing to
 * interpolate from or to, so the width snapped on the morph's first frame: the
 * pill visibly shrank to its final size before it had moved anywhere, which
 * read as "resize, then move" instead of one motion. A px value at BOTH ends is
 * the whole fix.
 *
 * Measured off the element itself while it is still `auto`, in the
 * ResizeObserver's first callback (so no `setState` sits in an effect body).
 * Once a width is stored the observer disconnects — the element is then sized
 * by us, so there is nothing left to measure. It is released back to `auto` for
 * a frame and re-measured whenever `revision` (the tab set) changes.
 *
 * `canMeasure` must be false unless the element is currently in PILL shape,
 * otherwise the sidebar's width gets stored as the pill's.
 */
function usePillWidth(
  ref: React.RefObject<HTMLElement | null>,
  revision: string,
  canMeasure: boolean,
): number | null {
  const [measured, setMeasured] = useState<{ revision: string; width: number } | null>(null)
  const width = measured?.revision === revision ? measured.width : null

  useEffect(() => {
    const el = ref.current
    if (!el || width !== null || !canMeasure) return
    const ro = new ResizeObserver(() => {
      const w = el.getBoundingClientRect().width
      if (w > 0) setMeasured({ revision, width: Math.round(w) })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [ref, revision, width, canMeasure])

  // A viewport change can change the natural width (the pill is shrink-to-fit
  // inside it), so drop the stored value and let the observer above take a
  // fresh one. Only while settled as a pill — dropping it mid-morph would
  // leave `auto` as an endpoint again, which is the very thing this avoids.
  useEffect(() => {
    if (!canMeasure) return
    const onResize = () => setMeasured(null)
    window.addEventListener("resize", onResize)
    return () => window.removeEventListener("resize", onResize)
  }, [canMeasure])

  return width
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
  const DUR = prefersReducedMotion ? 0 : MORPH_DUR
  const LEAD = prefersReducedMotion ? 0 : MORPH_LEAD
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

  // A px endpoint for the pill so `width` actually interpolates alongside
  // `left`/`transform` instead of snapping (see usePillWidth).
  const pillWidth = usePillWidth(ref, tabs.join(","), phase === "pill")

  const transition = morphTransition(phase, DUR, LEAD, "top, left, transform, width")
  // Reveal the sidebar list in lock-step with the growing/shrinking HEIGHT
  // (drawer clip), not on its own opacity timeline — otherwise the list fades
  // while the glass is still resizing and you see two separate motions. Height
  // is delayed by LEAD on open, leads (delay 0) on close.
  const heightDelay = phase === "opening" ? LEAD : 0
  const contentTransition =
    phase === "opening" || phase === "closing"
      ? `opacity ${DUR}ms ease ${heightDelay}ms`
      : "opacity 200ms ease"

  const style: React.CSSProperties = {
    top: isSidebarShape
      ? `calc(${SIDEBAR_MARGIN}px + env(safe-area-inset-top, 0px) + var(--install-banner-height, 0px))`
      : `calc(${PILL_TOP}px + env(safe-area-inset-top, 0px) + var(--install-banner-height, 0px))`,
    left: isSidebarShape ? SIDEBAR_MARGIN : "50%",
    transform: isSidebarShape ? "translateX(0)" : "translateX(-50%)",
    width: isSidebarShape ? SIDEBAR_INNER_WIDTH : (pillWidth ?? "auto"),
    height: isSidebarShape ? EXPANDED_HEIGHT : PILL_HEIGHT,
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
          cornerRadius={isSidebarShape ? 20 : 22}
          className="h-full"
          contentClassName="h-full !overflow-hidden !flex !flex-col"
          // In PILL shape the nav is a control and behaves like one: it blooms
          // under the finger and settles back like every other glass button.
          // As the SIDEBAR it doesn't — scaling a full-height panel around a
          // scrolling list reads as the layout wobbling, not as a press.
          disableTapFeedback={isSidebarShape}
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
            className="flex flex-col flex-1 min-h-0"
            style={{
              // The vertical sidebar list isn't "squished" mid-morph (it's just
              // clipped by the growing height, like a drawer), so keep it visible
              // AND interactive for the whole open span. Gating it on the settled
              // phase left a brief dead window that dropped sidebar taps. Its
              // opacity is timed to the height so reveal + growth are one motion.
              opacity: isSidebarShape ? 1 : 0,
              visibility: isSidebarShape ? "visible" : "hidden",
              pointerEvents: isSidebarShape ? "auto" : "none",
              transition: contentTransition,
            }}
          >
            {/* The nav fills the panel and the header floats over it, so the
                list scrolls UNDER the toggle and sync icons rather than
                stopping short of them. The icons stay hit-testable; the strip
                between them does not swallow scrolls (pointer-events-none on
                the bar, re-enabled on the controls). */}
            <div className="relative flex-1 min-h-0">
              <SidebarNav
                pathname={pathname}
                className="h-full"
                topInset={SIDEBAR_HEADER_HEIGHT}
              />
              <SidebarTopStrip onToggle={onToggleSidebar} />
            </div>
          </div>
        </GlassContainer>
    </div>
  )
}

// ─── Mobile: bottom pill ↔ sidebar ───────────────────────────

function MobilePillMorph({
  tabs,
  pathname,
  prefersReducedMotion,
}: {
  tabs: readonly BottomNavTab[]
  pathname: string
  prefersReducedMotion: boolean
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const DUR = prefersReducedMotion ? 0 : MORPH_DUR
  const LEAD = prefersReducedMotion ? 0 : MORPH_LEAD
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

  // A px endpoint for the pill so `width` actually interpolates alongside
  // `left`/`transform` instead of snapping (see usePillWidth).
  const pillWidth = usePillWidth(ref, tabs.join(","), phase === "pill")

  // Mobile morph — always bottom-anchored. pill: bottom-centre, measured pill
  // width, pill height. opening/closing: height and position+width morph in a sequenced
  // overlap (bottom-anchored, so it grows upward). On CLOSE the height collapses
  // almost fully (LEAD) before position+width move into the pill. sidebar:
  // full height, bottom-left. In the pill state only `transform` animates.
  const transition =
    phase === "pill"
      ? `transform ${prefersReducedMotion ? 0 : 300}ms ${OVERSHOOT_BEZIER}`
      : morphTransition(phase, DUR, LEAD, "left, transform, width")
  // Sidebar content reveal timed to the height (drawer), so growth + reveal are
  // one motion instead of the list fading while the glass is still expanding.
  const heightDelay = phase === "opening" ? LEAD : 0
  const contentTransition =
    phase === "opening" || phase === "closing"
      ? `opacity ${DUR}ms ease ${heightDelay}ms`
      : "opacity 200ms ease"

  const style: React.CSSProperties = {
    position: "fixed" as const,
    bottom: NAV_BOTTOM_OFFSET,
    left: isSidebarShape ? SIDEBAR_MARGIN : "50%",
    transform: isSidebarShape
      ? "translateX(0)"
      // NEVER hidden. It used to slide away on scroll, which meant the primary
      // navigation of the app was missing exactly when you had been reading for
      // a while and wanted to go somewhere else — and it came back on a scroll
      // UP, so getting it required a gesture that also moved the content.
      : "translateX(-50%)",
    width: isSidebarShape ? SIDEBAR_INNER_WIDTH : (pillWidth ?? "auto"),
    height: isSidebarShape ? EXPANDED_HEIGHT : MOBILE_PILL_HEIGHT,
    transition,
  }

  return (
    <>
      {/* Backdrop — dark scrim + progressive blur ramping out from the sidebar.
          Both fade on the MORPH's own clock (`TOTAL`), so the veil arrives with
          the panel instead of on a timing of its own. */}
      <div
        className={cn("fixed inset-0 z-[58]", MODAL_SCRIM)}
        style={{
          opacity: sidebarOpen ? 1 : 0,
          pointerEvents: sidebarOpen ? "auto" : "none",
          transition: `opacity ${TOTAL}ms ${MORPH_EASE}`,
        }}
        onClick={() => setSidebarOpen(false)}
      />
      {SIDEBAR_BACKDROP_BLUR.map(({ blur, width, solid }) => (
        <div
          key={blur}
          aria-hidden
          className="fixed left-0 top-0 bottom-0 z-[59]"
          style={{
            width,
            opacity: sidebarOpen ? 1 : 0,
            pointerEvents: "none",
            transition: `opacity ${TOTAL}ms ${MORPH_EASE}`,
            backdropFilter: `blur(${blur}px)`,
            WebkitBackdropFilter: `blur(${blur}px)`,
            maskImage: `linear-gradient(to right, #000 0 ${solid}, transparent 100%)`,
            WebkitMaskImage: `linear-gradient(to right, #000 0 ${solid}, transparent 100%)`,
          }}
        />
      ))}

      <div
        ref={ref}
        className="z-[100]"
        style={style}
        onTransitionEnd={handleTransitionEnd}
      >
        <GlassContainer
          cornerRadius={isSidebarShape ? 20 : MOBILE_PILL_RADIUS}
          className="h-full"
          contentClassName="h-full !overflow-hidden !flex !flex-col"
          // In PILL shape the nav is a control and behaves like one: it blooms
          // under the finger and settles back like every other glass button.
          // As the SIDEBAR it doesn't — scaling a full-height panel around a
          // scrolling list reads as the layout wobbling, not as a press.
          disableTapFeedback={isSidebarShape}
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
              height: phase === "pill" ? MOBILE_PILL_HEIGHT : 0,
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
            className="flex flex-col flex-1 min-h-0"
            style={{
              // The vertical sidebar list isn't "squished" mid-morph (it's just
              // clipped by the growing height, like a drawer), so keep it visible
              // AND interactive for the whole open span. Gating it on the settled
              // phase left a brief dead window that dropped sidebar taps. Its
              // opacity is timed to the height so reveal + growth are one motion.
              opacity: isSidebarShape ? 1 : 0,
              visibility: isSidebarShape ? "visible" : "hidden",
              pointerEvents: isSidebarShape ? "auto" : "none",
              transition: contentTransition,
            }}
          >
            {/* Same arrangement as the desktop sidebar: the nav fills the
                panel and the toggle + sync strip FLOATS over it, so the list
                scrolls under the icons rather than starting below them. This
                branch used to lay the strip out as an ordinary row, which is
                why the scroll-under only ever worked on desktop — on a phone
                the list simply stopped at the icons. */}
            <div className="relative flex-1 min-h-0">
              <SidebarNav
                pathname={pathname}
                className="h-full"
                topInset={SIDEBAR_HEADER_HEIGHT}
              />
              <SidebarTopStrip onToggle={() => setSidebarOpen(false)} />
            </div>
          </div>
        </GlassContainer>
      </div>
    </>
  )
}
