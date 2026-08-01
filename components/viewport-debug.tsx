"use client"

// TEMP DIAGNOSTIC — remove after the iOS standalone viewport investigation.
// Shows every height/inset the engine reports, plus marker lines:
//   red    = bottom edge of <body> (the compensated shell)
//   blue   = window.innerHeight (the "viewport" per JS)
//   green  = visualViewport bottom
// On a correctly compensated shell the red line must sit at the physical
// bottom of the glass, UNDER the home indicator.

import { useEffect, useState } from "react"

interface Readout {
  innerW: number
  innerH: number
  docClientH: number
  vvH: number | null
  vvTop: number | null
  screenW: number
  screenH: number
  bodyH: number
  bodyBottom: number
  envTop: number
  envRight: number
  envBottom: number
  envLeft: number
  standaloneMQ: boolean
  fullscreenMQ: boolean
  navStandalone: string
  orientation: string
  shellGap: string
  scrollY: number
}

function measure(): Readout {
  const probe = document.createElement("div")
  probe.style.cssText =
    "position:fixed;top:0;left:0;visibility:hidden;pointer-events:none;" +
    "padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px);" +
    "padding-left:env(safe-area-inset-left,0px);padding-right:env(safe-area-inset-right,0px);"
  document.body.appendChild(probe)
  const cs = getComputedStyle(probe)
  const env = {
    envTop: parseFloat(cs.paddingTop) || 0,
    envRight: parseFloat(cs.paddingRight) || 0,
    envBottom: parseFloat(cs.paddingBottom) || 0,
    envLeft: parseFloat(cs.paddingLeft) || 0,
  }
  probe.remove()
  const bodyRect = document.body.getBoundingClientRect()
  return {
    innerW: window.innerWidth,
    innerH: window.innerHeight,
    docClientH: document.documentElement.clientHeight,
    vvH: window.visualViewport ? Math.round(window.visualViewport.height * 10) / 10 : null,
    vvTop: window.visualViewport ? Math.round(window.visualViewport.offsetTop * 10) / 10 : null,
    screenW: screen.width,
    screenH: screen.height,
    bodyH: Math.round(bodyRect.height * 10) / 10,
    bodyBottom: Math.round(bodyRect.bottom * 10) / 10,
    ...env,
    standaloneMQ: matchMedia("(display-mode: standalone)").matches,
    fullscreenMQ: matchMedia("(display-mode: fullscreen)").matches,
    navStandalone: String((navigator as { standalone?: boolean }).standalone),
    orientation: screen.orientation ? `${screen.orientation.type} ${screen.orientation.angle}` : "n/a",
    shellGap:
      document.documentElement.style.getPropertyValue("--shell-bottom-gap") || "(unset)",
    scrollY: Math.round(window.scrollY * 10) / 10,
  }
}

export function ViewportDebug() {
  const [r, setR] = useState<Readout | null>(null)

  useEffect(() => {
    const update = () => setR(measure())
    update()
    window.addEventListener("resize", update)
    window.addEventListener("orientationchange", update)
    window.visualViewport?.addEventListener("resize", update)
    const t = window.setInterval(update, 2000)
    return () => {
      window.removeEventListener("resize", update)
      window.removeEventListener("orientationchange", update)
      window.visualViewport?.removeEventListener("resize", update)
      window.clearInterval(t)
    }
  }, [])

  if (!r) return null

  const rows: [string, string | number | boolean | null][] = [
    ["build", "vd-5"],
    ["shell gap", r.shellGap],
    ["scrollY", r.scrollY],
    ["innerH", r.innerH],
    ["doc.clientH", r.docClientH],
    ["visualViewport.h", r.vvH],
    ["vv.offsetTop", r.vvTop],
    ["screen.h (w)", `${r.screenH} (${r.screenW})`],
    ["body height", r.bodyH],
    ["body bottom", r.bodyBottom],
    ["env t/r/b/l", `${r.envTop}/${r.envRight}/${r.envBottom}/${r.envLeft}`],
    ["mq standalone", r.standaloneMQ],
    ["mq fullscreen", r.fullscreenMQ],
    ["nav.standalone", r.navStandalone],
    ["orientation", r.orientation],
  ]

  return (
    <>
      {/* readout panel — fixed, so it anchors to body (the shell) */}
      <div
        style={{
          position: "fixed",
          top: 80,
          left: 8,
          zIndex: 99990,
          pointerEvents: "none",
          background: "rgba(0,0,0,0.75)",
          color: "#7CFC00",
          font: "11px/1.5 monospace",
          padding: "6px 8px",
          borderRadius: 6,
          whiteSpace: "pre",
        }}
      >
        {rows.map(([k, v]) => `${k.padEnd(17)} ${String(v)}`).join("\n")}
      </div>
      {/* orange: paint probe for the sub-viewport strip — if the band below the
          buggy viewport is paintable at all, this stripe shows there */}
      <div style={{ position: "fixed", left: 0, right: 0, bottom: 0, height: 48, background: "rgba(255,140,0,0.45)", zIndex: 99990, pointerEvents: "none" }} />
      {/* purple: same probe via position:absolute — a pure document-layer path,
          in case fixed (even with a transformed containing block) stays clipped */}
      <div style={{ position: "absolute", left: "25%", right: "25%", bottom: 0, height: 48, background: "rgba(168,85,247,0.5)", zIndex: 99990, pointerEvents: "none" }} />
      {/* red: body's own bottom edge (bottom:0 of the shell) */}
      <div style={{ position: "fixed", left: 0, right: 0, bottom: 0, height: 3, background: "red", zIndex: 99991, pointerEvents: "none" }} />
      {/* blue: where window.innerHeight says the viewport ends */}
      <div style={{ position: "fixed", left: 0, width: "50%", top: r.innerH - 3, height: 3, background: "#3b82f6", zIndex: 99992, pointerEvents: "none" }} />
      {/* green: where the visual viewport ends */}
      {r.vvH != null && (
        <div style={{ position: "fixed", right: 0, width: "50%", top: (r.vvTop ?? 0) + r.vvH - 3, height: 3, background: "#22c55e", zIndex: 99993, pointerEvents: "none" }} />
      )}
    </>
  )
}
