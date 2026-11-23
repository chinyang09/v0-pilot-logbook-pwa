/**
 * Shared elements between a tile and its card (the owner, Nov 2026: "I want
 * the relating contents on the widget to expand into the card"). Anything
 * tagged `data-morph="<key>"` on BOTH the tile's face and the card — an
 * airport's code, its local time, a currency's name — FLIES from where it
 * sits on the tile to where it sits in the card, instead of fading out in one
 * place and in at another.
 *
 * Each pair becomes two COPIES on a layer over both (the originals hidden
 * meanwhile): the tile's copy travels to the card's place and fades out, the
 * card's copy travels from the tile's place and fades in — a crossfade in
 * motion, so a 12px code becoming an 18px one, or "WIII" becoming
 * "WIII · 03:00", reads as one thing growing. Transform and opacity only; the
 * copies are dropped and the originals shown the moment it lands.
 *
 * Positions are taken against each LAYER's own box: the face layer, the card
 * and the copies' layer all hang from the surface's top-left, so the copies
 * ride the surface as it grows and only their offset within it animates.
 */

import { animate, type AnimationPlaybackControls } from "framer-motion"

type Transition = Parameters<typeof animate>[2]

interface Box {
  x: number
  y: number
  w: number
  h: number
}

const COPIED = [
  "font-family",
  "font-size",
  "font-weight",
  "line-height",
  "letter-spacing",
  "color",
  "text-transform",
  "font-variant-numeric",
  "display",
  "align-items",
  "justify-content",
  "flex-direction",
  "column-gap",
  "row-gap",
  "white-space",
  "text-align",
  "box-sizing",
  "padding-top",
  "padding-right",
  "padding-bottom",
  "padding-left",
]

const boxIn = (el: Element, l: DOMRect): Box => {
  const r = el.getBoundingClientRect()
  return { x: r.left - l.left, y: r.top - l.top, w: r.width, h: r.height }
}

/**
 * A run of plain text on one line is flown as its GLYPHS' own box (the
 * text's range), not the element's: the tile's 12px line and the card's 14px
 * one carry different leading, so scaled element boxes put the two copies'
 * letters a pixel or two apart all through the crossfade. Boxed to the text,
 * the scale between them is the font sizes' and the letters coincide.
 */
function textBoxIn(el: HTMLElement, l: DOMRect, cs: CSSStyleDeclaration): Box | null {
  if (el.childElementCount > 0 || !el.textContent?.trim()) return null
  // A text with a shape of its own (the crew's initials in their circle)
  // flies as its shape: boxed to the glyphs, the circle would shrink to them.
  if (!/rgba\(0, 0, 0, 0\)|transparent/.test(cs.backgroundColor) || parseFloat(cs.borderTopWidth) > 0) return null
  const range = document.createRange()
  range.selectNodeContents(el)
  const rects = range.getClientRects()
  if (rects.length !== 1) return null
  const r = rects[0]
  const e = el.getBoundingClientRect()
  // A truncated line keeps to the element's width.
  const right = Math.min(r.right, e.right)
  return { x: r.left - l.left, y: r.top - l.top, w: Math.max(0, right - r.left), h: r.height }
}

function firstByKey(root: Element, within?: DOMRect | null): Map<string, HTMLElement> {
  const out = new Map<string, HTMLElement>()
  for (const el of root.querySelectorAll<HTMLElement>("[data-morph]")) {
    const key = el.dataset.morph!
    if (out.has(key)) continue
    // A page of a pager swiped out of view is clipped by the pager, not the
    // layer: under the flights tile's crew panel, the next leg's page sits
    // inside the layer's box and must still not fly.
    const clip = el.closest("[data-pager]")?.getBoundingClientRect() ?? within
    if (clip) {
      const r = el.getBoundingClientRect()
      if (r.right <= clip.left + 1 || r.left >= clip.right - 1) continue
    }
    out.set(key, el)
  }
  return out
}

/** What a copy needs of its original's style, read BEFORE anything is written (`runSharedMorph`). */
interface StyleSnap {
  props: Array<[string, string]>
  display: string
  textOverflow: string
}
function snapOf(cs: CSSStyleDeclaration): StyleSnap {
  return { props: COPIED.map((p) => [p, cs.getPropertyValue(p)]), display: cs.display, textOverflow: cs.textOverflow }
}

function copyOf(el: HTMLElement, box: Box, text: boolean, cs: StyleSnap): HTMLElement {
  const copy = el.cloneNode(true) as HTMLElement
  copy.removeAttribute("data-morph")
  copy.removeAttribute("id")
  for (const [p, v] of cs.props) copy.style.setProperty(p, v)
  // An INLINE element's box is its font's content area, not its line: taken
  // out of its line as a block of that height with the line's own
  // line-height, its glyphs sat half the leading lower (or higher, under
  // `leading-none`) than the original — the copy landed a few pixels off
  // and the swap to the original snapped (the owner's "settles slightly
  // below, then snaps up"). One line exactly the box's height puts the
  // glyphs where they were.
  if (text || cs.display === "inline") {
    copy.style.display = "block"
    copy.style.lineHeight = `${box.h}px`
  }
  if (text) {
    // The box IS the glyphs: no padding round them, no alignment within.
    copy.style.padding = "0px"
    copy.style.textAlign = "left"
    copy.style.whiteSpace = "nowrap"
    if (cs.textOverflow === "ellipsis") Object.assign(copy.style, { overflow: "hidden", textOverflow: "ellipsis" })
  }
  Object.assign(copy.style, {
    position: "absolute",
    left: "0px",
    top: "0px",
    margin: "0px",
    width: `${box.w}px`,
    height: `${box.h}px`,
    transformOrigin: "0 0",
    pointerEvents: "none",
    visibility: "visible",
  })
  if (!text || cs.textOverflow !== "ellipsis") copy.style.overflow = "visible"
  return copy
}

const lerp = (a: number, b: number, p: number) => a + (b - a) * p

/** The copies of a pair at progress `p` (0 = where they start, 1 = where they land). */
function place(
  pair: { fc: HTMLElement; cc: HTMLElement; from: Box; to: Box; f0: [number, number]; f1: [number, number]; c0: [number, number]; c1: [number, number]; texts: HTMLElement[] },
  p: number,
) {
  const x = lerp(pair.from.x, pair.to.x, p)
  const y = lerp(pair.from.y, pair.to.y, p)
  const fsx = lerp(pair.f0[0], pair.f1[0], p)
  const fsy = lerp(pair.f0[1], pair.f1[1], p)
  const csx = lerp(pair.c0[0], pair.c1[0], p)
  const csy = lerp(pair.c0[1], pair.c1[1], p)
  pair.fc.style.transform = `translate(${x}px, ${y}px) scale(${fsx}, ${fsy})`
  pair.cc.style.transform = `translate(${x}px, ${y}px) scale(${csx}, ${csy})`
  // A stretched picture's labels (a time axis's hours) keep the height's
  // scale across too: stretched with the bar, the hours widened and then
  // snapped back to their own shape as the copy was dropped (the owner's
  // "time axis requires an extra step to snap into position").
  for (const t of pair.texts) {
    const inFace = pair.fc.contains(t)
    const k = inFace ? fsy / fsx : csy / csx
    t.style.transform = `scaleX(${k})`
  }
}

/**
 * Where each label of a stretched picture scales from, read off the original
 * (in the read pass): a label pinned to the right edge ("Z") from there, one
 * centred on its tick from its middle, any other from its left — as the label
 * states it (`data-anchor="end" | "center"`), else as its computed style says.
 */
function originsOf(original: HTMLElement): string[] {
  const leaf = (el: Element) => el.childElementCount === 0 && !!el.textContent?.trim()
  return [...original.querySelectorAll<HTMLElement>("*")].filter(leaf).map((o) => {
    // Stated by the label where it can be (`data-anchor`): WebKit and Blink
    // spell a computed `translate` differently ("calc(-50%)" / "-50%"), and a
    // centred label read as left-anchored drifts through the morph and snaps.
    const anchor = o.dataset.anchor
    if (anchor === "end") return "100% 50%"
    if (anchor === "center") return "50% 50%"
    const cs = getComputedStyle(o)
    return cs.right === "0px" && cs.left !== "0px" ? "100% 50%" : /-/.test(cs.translate) ? "50% 50%" : "0% 50%"
  })
}

/** The text a stretched copy carries, each set to scale about its own anchor. */
function textLeaves(copy: HTMLElement, origins: string[]): HTMLElement[] {
  const leaf = (el: Element) => el.childElementCount === 0 && !!el.textContent?.trim()
  const copies = [...copy.querySelectorAll<HTMLElement>("*")].filter(leaf)
  copies.forEach((el, i) => {
    el.style.transformOrigin = origins[i] ?? "0% 50%"
  })
  return copies
}

/**
 * Fly every tagged pair between `face` and `card` on `layer`. `opening`:
 * face → card; otherwise card → face. Resolves when every copy has landed;
 * `cancel` puts everything back at once.
 */
export function runSharedMorph({
  face,
  card,
  layer,
  opening,
  move,
  fade,
}: {
  face: HTMLElement
  card: HTMLElement
  layer: HTMLElement
  opening: boolean
  /** The surface's own transition — the copies keep pace with it. */
  move: Transition
  fade: Transition
}): { done: Promise<void>; cancel: () => void } {
  const faceBox = face.getBoundingClientRect()
  // A tile's page that is swiped out of view (the destination pager) is not
  // where anything comes from: the first VISIBLE element of a key is.
  const faceEls = firstByKey(face, faceBox)
  const cardEls = firstByKey(card, null)
  const cardBox = card.getBoundingClientRect()
  const hidden: HTMLElement[] = []
  const copies: HTMLElement[] = []
  const runs: AnimationPlaybackControls[] = []
  // Every pair rides ONE progress clock, written per frame: the copies' place
  // and scale follow the surface exactly, and a stretched picture's text is
  // counter-scaled as it goes.
  const pairs: Array<{
    fc: HTMLElement
    cc: HTMLElement
    from: Box
    to: Box
    // Each copy's scale at progress 0 and 1.
    f0: [number, number]
    f1: [number, number]
    c0: [number, number]
    c1: [number, number]
    // A stretched picture's text, kept at an even scale (`counterText`).
    texts: HTMLElement[]
  }> = []

  // READ everything first, then write: measuring a pair after the previous
  // pair's copies were appended and its originals hidden forced a fresh
  // layout of the whole card per pair (112ms of a currency card's open at 4×).
  const plans: Array<{
    key: string
    f: HTMLElement
    c: HTMLElement
    text: boolean
    fb: Box
    cb: Box
    stretch: boolean
    fs: StyleSnap
    cs: StyleSnap
    fo: string[]
    co: string[]
  }> = []
  for (const [key, f] of faceEls) {
    const c = cardEls.get(key)
    if (!c) continue
    const fcs = getComputedStyle(f)
    const ccs = getComputedStyle(c)
    // Both as text, or both as boxes: a pair must scale between like boxes.
    const ft = textBoxIn(f, faceBox, fcs)
    const ct = ft ? textBoxIn(c, cardBox, ccs) : null
    const text = !!(ft && ct)
    const fb = text ? ft! : boxIn(f, faceBox)
    const cb = text ? ct! : boxIn(c, cardBox)
    if (fb.h < 1 || cb.h < 1) continue
    // A card element scrolled out of the card's view has nowhere to come from.
    const cr = c.getBoundingClientRect()
    if (cr.bottom < cardBox.top || cr.top > cardBox.bottom) continue
    // A picture tagged to STRETCH (a day bar, a limit's bar, a strip) takes
    // the other's box in both directions; anything else scales evenly, so its
    // text keeps its shape.
    const stretch = !text && (f.hasAttribute("data-morph-stretch") || c.hasAttribute("data-morph-stretch")) && fb.w >= 1 && cb.w >= 1
    plans.push({
      key,
      f,
      c,
      text,
      fb,
      cb,
      stretch,
      fs: snapOf(fcs),
      cs: snapOf(ccs),
      fo: stretch ? originsOf(f) : [],
      co: stretch ? originsOf(c) : [],
    })
  }

  for (const { key, f, c, text, fb, cb, stretch, fs, cs, fo, co } of plans) {
    const toCard = cb.h / fb.h
    const toFace = fb.h / cb.h
    const sx = stretch ? cb.w / fb.w : toCard
    const [from, to] = opening ? [fb, cb] : [cb, fb]
    const fc = copyOf(f, fb, text, fs)
    const cc = copyOf(c, cb, text, cs)
    fc.dataset.morphCopy = `${key}:face`
    cc.dataset.morphCopy = `${key}:card`
    const pair = {
      fc,
      cc,
      from,
      to,
      // The tile's copy: at the tile's size where the tile has it.
      f0: (opening ? [1, 1] : [sx, toCard]) as [number, number],
      f1: (opening ? [sx, toCard] : [1, 1]) as [number, number],
      // The card's copy: at the card's size where the card has it.
      c0: (opening ? [1 / sx, toFace] : [1, 1]) as [number, number],
      c1: (opening ? [1, 1] : [1 / sx, toFace]) as [number, number],
      texts: stretch ? [...textLeaves(fc, fo), ...textLeaves(cc, co)] : [],
    }
    // Placed BEFORE they are shown: appended bare, a copy sat for one frame
    // at the layer's corner at its own size until the first keyframe landed
    // (the flash on the first frame of every open and close).
    fc.style.opacity = opening ? "1" : "0"
    cc.style.opacity = opening ? "0" : "1"
    place(pair, 0)
    layer.append(fc, cc)
    copies.push(fc, cc)
    pairs.push(pair)
    for (const el of [f, c]) {
      el.style.visibility = "hidden"
      hidden.push(el)
    }
    runs.push(animate(fc, { opacity: opening ? [1, 0] : [0, 1] }, fade))
    runs.push(animate(cc, { opacity: opening ? [0, 1] : [1, 0] }, fade))
  }
  if (pairs.length > 0) {
    runs.push(
      animate(0 as number, 1 as number, {
        ...(move as object),
        onUpdate: (p: number) => {
          for (const pair of pairs) place(pair, p)
        },
      } as Transition),
    )
  }

  let settled = false
  const settle = () => {
    if (settled) return
    settled = true
    for (const r of runs) r.stop()
    for (const c of copies) c.remove()
    for (const el of hidden) el.style.visibility = ""
  }
  const done = Promise.all(runs.map((r) => r.finished)).then(settle, settle)
  return { done, cancel: settle }
}
