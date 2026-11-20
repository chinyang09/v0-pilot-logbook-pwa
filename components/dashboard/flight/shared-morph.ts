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
  "column-gap",
  "white-space",
]

const boxIn = (el: Element, layer: Element): Box => {
  const r = el.getBoundingClientRect()
  const l = layer.getBoundingClientRect()
  return { x: r.left - l.left, y: r.top - l.top, w: r.width, h: r.height }
}

function firstByKey(root: Element, within?: DOMRect): Map<string, HTMLElement> {
  const out = new Map<string, HTMLElement>()
  for (const el of root.querySelectorAll<HTMLElement>("[data-morph]")) {
    const key = el.dataset.morph!
    if (out.has(key)) continue
    if (within) {
      const r = el.getBoundingClientRect()
      if (r.right <= within.left + 1 || r.left >= within.right - 1) continue
    }
    out.set(key, el)
  }
  return out
}

function copyOf(el: HTMLElement, box: Box): HTMLElement {
  const copy = el.cloneNode(true) as HTMLElement
  copy.removeAttribute("data-morph")
  copy.removeAttribute("id")
  const cs = getComputedStyle(el)
  for (const p of COPIED) copy.style.setProperty(p, cs.getPropertyValue(p))
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
    overflow: "visible",
  })
  return copy
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
  const cardEls = firstByKey(card)
  const cardBox = card.getBoundingClientRect()
  const hidden: HTMLElement[] = []
  const copies: HTMLElement[] = []
  const runs: AnimationPlaybackControls[] = []

  for (const [key, f] of faceEls) {
    const c = cardEls.get(key)
    if (!c) continue
    const fb = boxIn(f, face)
    const cb = boxIn(c, card)
    if (fb.h < 1 || cb.h < 1) continue
    // A card element scrolled out of the card's view has nowhere to come from.
    const cr = c.getBoundingClientRect()
    if (cr.bottom < cardBox.top || cr.top > cardBox.bottom) continue
    const fc = copyOf(f, fb)
    const cc = copyOf(c, cb)
    layer.append(fc, cc)
    copies.push(fc, cc)
    for (const el of [f, c]) {
      el.style.visibility = "hidden"
      hidden.push(el)
    }
    const toCard = cb.h / fb.h
    const toFace = fb.h / cb.h
    const [from, to] = opening ? [fb, cb] : [cb, fb]
    // The tile's copy: at the tile's size where the tile has it.
    runs.push(
      animate(
        fc,
        {
          x: [from.x, to.x],
          y: [from.y, to.y],
          scale: opening ? [1, toCard] : [toCard, 1],
          opacity: opening ? [1, 0] : [0, 1],
        },
        { ...move, opacity: fade } as Transition,
      ),
    )
    // The card's copy: at the card's size where the card has it.
    runs.push(
      animate(
        cc,
        {
          x: [from.x, to.x],
          y: [from.y, to.y],
          scale: opening ? [toFace, 1] : [1, toFace],
          opacity: opening ? [0, 1] : [1, 0],
        },
        { ...move, opacity: fade } as Transition,
      ),
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
