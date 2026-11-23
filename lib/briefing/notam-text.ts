/**
 * A NOTAM's or an INTAM's words as a reader wants them (the owner, Nov 2026:
 * "many unnecessary newlines … improve the algorithm to better format the
 * notams", and "bold and highlight keywords relating to runway, rwy, taxiway,
 * twy, u/s, unserviceable, inactive").
 *
 * The bulletin is printed at ~65 characters a line, so most of its newlines
 * are the printer's, not the writer's. `reflowLines` joins a line to the next
 * unless something says the writer broke it: the next line starts an item
 * ("- ", "A)", "II)", "2.1", "A. ", "1.THE"), a label ("NR:", "RMK:"), or a
 * rule of dashes; or this line ends a thought (":" or ";", or "." on a line
 * that stopped short of the width); or it is a short line on its own (a
 * heading). A number alone on its line ("2", "2.1") is the numbering of the
 * line after it. `highlightSpans` marks the facilities (RWY 02R/20L, TWY N2,
 * ACFT STAND 604, ILS …) and the words that say one cannot be used (CLSD,
 * U/S, NOT AVBL …). Pure.
 */

import type { Notam } from "./types"

export interface TextBlock {
  kind: "para" | "item" | "heading" | "rule"
  text: string
}

const ITEM = /^(?:[-•*]\s+|\(?[A-Z]\)\s*|\(?[a-z]\)\s+|[IVX]{1,4}\)\s*|\d{1,2}(?:\.\d{1,2})*\.?\s+|\d{1,2}\.(?=[A-Z])|[A-Z]\.\s+)/
const LABEL = /^[A-Z][A-Z0-9 ()/-]{1,28}:(?:\s|$)/
const RULE = /^[-=_]{4,}$/
const LONE_NUMBER = /^\d{1,2}(?:\.\d{1,2})*\.?$/
/** A line cut on a word that cannot end a thought carries on. */
const JOINING = /(?:\b(?:AND|OR|OF|TO|THE|AT|FOR|WITH|IN|ON|BY|FROM|BTN|WI|A|AN|IS|ARE|BE|WILL|SHALL|THAT)|[,-])$/

/** Lines, as printed, into the blocks the writer meant. */
export function reflowLines(input: readonly string[]): TextBlock[] {
  // A lone number belongs to the line after it ("2" over "STEEL AND FRANGIBLE FRAMES").
  const lines: string[] = []
  for (let i = 0; i < input.length; i++) {
    const l = input[i].replace(/\s+/g, " ").trim()
    if (!l) continue
    const next = input[i + 1]?.trim()
    if (LONE_NUMBER.test(l) && next && !LONE_NUMBER.test(next)) {
      lines.push(`${l} ${next.replace(/\s+/g, " ")}`)
      i++
    } else lines.push(l)
  }
  if (lines.length === 0) return []
  const width = Math.max(48, ...lines.map((l) => l.length))
  const short = (l: string) => l.length < width * 0.55

  const blocks: TextBlock[] = []
  let cur: { kind: TextBlock["kind"]; parts: string[] } | null = null
  const flush = () => {
    if (!cur) return
    const text = cur.parts.join(" ")
    const kind = cur.kind === "para" && cur.parts.length === 1 && short(text) && !/[.:;!?)]$/.test(text) ? "heading" : cur.kind
    blocks.push({ kind, text })
    cur = null
  }
  lines.forEach((line, i) => {
    if (RULE.test(line)) {
      flush()
      blocks.push({ kind: "rule", text: "" })
      return
    }
    const startsItem = ITEM.test(line) || LABEL.test(line)
    if (!cur || startsItem) {
      flush()
      cur = { kind: ITEM.test(line) && !LABEL.test(line) ? "item" : "para", parts: [line] }
    } else cur.parts.push(line)
    const next = lines[i + 1]
    const ends =
      /[:;]$/.test(line) ||
      (/[.!?)]$/.test(line) && line.length < width - 10) ||
      // A short line on its own is a heading; a short last line of a wrapped
      // paragraph usually ends it ("… 1100" / "UTC" before a heading), though
      // now and then a sentence carries on past one ("… FOR" / "SAFETY").
      (short(line) && !JOINING.test(line) && !(next && /^[a-z]/.test(next)))
    if (ends) flush()
  })
  flush()
  // Two rules in a row are one, and none opens or closes the text; a heading needs something under it.
  return blocks
    .filter((b, i) => !(b.kind === "rule" && (i === 0 || blocks[i - 1].kind === "rule" || i === blocks.length - 1)))
    .map((b, i, all) => (b.kind === "heading" && (i === all.length - 1 || all[i + 1].kind === "rule") ? { ...b, kind: "para" as const } : b))
}

/** Lines that only say which NOTAM this is and when: its number, "AIP SUPPLEMENT", the aerodrome, VALIDITY. */
function isNoise(l: string, location: string): boolean {
  return (
    /^[A-Z0-9]{1,3}\d{2,4}\/\d{2}\b/.test(l) ||
    /^AIP\s+SUP/i.test(l) ||
    /^[A-Z]{4}\s*[/-]\s*[A-Z]/.test(l) ||
    /^VALIDITY/i.test(l) ||
    l === location
  )
}

/**
 * The title line(s) of a NOTAM and where they sit among its non-noise lines.
 * The PDF wraps at ~65 characters, so a title cut on a joining word ("… AND")
 * carries on into the next line.
 */
function titleOf(n: Pick<Notam, "text" | "location">): { title: string; lines: string[]; used: number } {
  const all = n.text.split("\n").map((l) => l.trim()).filter(Boolean)
  const lines = all.filter((l) => !isNoise(l, n.location))
  if (lines.length === 0) return { title: (all[0] ?? "").replace(/\s+/g, " "), lines: [], used: 0 }
  let title = lines[0]
  let used = 1
  while (used < lines.length && title.length < 140 && /\b(AND|OR|OF|TO|THE|AT|FOR|WITH|IN|ON|BY|FROM|BTN|WI)$|[-,]$/.test(title)) {
    if (/^(\d|-{3,}|F\))/.test(lines[used])) break
    title += ` ${lines[used]}`
    used++
  }
  title = title
    .replace(/^[A-Z][A-Z ]+ (AP|AIRPORT|INTL)\s+-\s+(?=\S)/, "")
    .replace(/\s+F\)\s.*$/, "")
    .replace(/\s+/g, " ")
  return { title, lines, used }
}

/**
 * A NOTAM's TITLE — the line that says what it is about, for the collapsed
 * row (the owner, Nov 2026: "ID or header or title, with validity shown when
 * collapsed"). An AIP supplement opens with its own number, "AIP SUPPLEMENT",
 * the aerodrome and a VALIDITY line before it says anything; those are skipped.
 */
export function notamTitle(n: Pick<Notam, "text" | "location">): string {
  return titleOf(n).title
}

/**
 * What a NOTAM says past its title, reflowed — nothing when the title is all
 * of it ("TWY S2 CLSD"). The number, the aerodrome and the VALIDITY line are
 * not repeated: the row's header says them.
 */
export function notamBody(n: Pick<Notam, "text" | "location">): TextBlock[] {
  const { lines, used } = titleOf(n)
  // A one-sentence NOTAM is its title — but a title that is a short heading
  // over a long text keeps the text whole.
  return reflowLines(lines.slice(used))
}

/* ── keywords ────────────────────────────────────────────────────────────── */

export interface TextSpan {
  text: string
  /** A facility (RWY 02R/20L, TWY N2) or a word that says it cannot be used (CLSD, U/S). */
  tone?: "facility" | "status"
}

const DESIGNATOR = String.raw`(?:\s+(?:\d{3}[LR]?(?![\dA-Z])|\d{2}[LRC]?(?:\/\d{2}[LRC]?)?(?![\dA-Z])|[A-Z]{1,2}\d{1,2}[A-Z]?\b))?`
const FACILITY = String.raw`\b(?:RWYS?|RUNWAYS?|TWYS?|TAXIWAYS?|TXL|TAXILANES?|RET|(?:ACFT |AIRCRAFT )?STANDS?|ILS|LOC|GP|GS|DME|VOR|NDB|PAPI|ALS|RVR|ATIS)\b${DESIGNATOR}`
const STATUS = String.raw`\b(?:CLSD|CLOSED|CLOSURES?|U\/S|UNSERVICEABLE|UNSERVICEABILITY|INACTIVE|NOT AVBL|NOT AVAILABLE|NOT IN SERVICE|WITHDRAWN|OUT OF SERVICE|OTS|DEACTIVATED|SUSPENDED|INOP|DOWNGRAD(?:ED|ING)?|NOT AUTH|PROHIBITED|WIP|WORK IN PROGRESS)\b`
const KEYWORDS = new RegExp(`(${STATUS})|(${FACILITY})`, "g")

/** A line of text cut into spans, its facilities and its "cannot be used" words marked. */
export function highlightSpans(text: string): TextSpan[] {
  const out: TextSpan[] = []
  let last = 0
  for (const m of text.matchAll(KEYWORDS)) {
    const at = m.index ?? 0
    if (at > last) out.push({ text: text.slice(last, at) })
    out.push({ text: m[0], tone: m[1] ? "status" : "facility" })
    last = at + m[0].length
  }
  if (last < text.length) out.push({ text: text.slice(last) })
  return out
}
