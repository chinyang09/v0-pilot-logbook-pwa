/**
 * The company's briefing PDF, read into a `Briefing` (`types.ts` has the map
 * of its sections). Pure: it takes the pages as lines (`pdfToPages`) and
 * answers structure, so it is tested on the real packages.
 *
 * Read the way the package is printed, never by position on the page:
 *
 * - SECTIONS by the title under the running header ("OFP", "NOTAM",
 *   "INTAM" …); a page with no title continues the one before. The OFP is
 *   printed twice (alone, then in the package) and the first copy is read.
 * - The OFP's figures by their LABELS ("BURNOFF 01.07 002566", "PZFW 54877
 *   ...... 64300"), dots read as nothing.
 * - The nav log as its two-line records: name / elapsed / leg time, then the
 *   position and the planned figures, read from both ends of the line so a
 *   blank column (no MSA, no wind) cannot shift the rest.
 * - NOTAMs by the bulletin's own markers: a `====` section, a location over
 *   a dashed rule, a `++++ RUNWAY ++++` category, and each entry's
 *   `ID   VALID: from - to` line — never by indentation, which a page break
 *   can lose.
 */

import { dashRegistration } from "@/lib/lookup/changi"
import type {
  Briefing,
  BriefingAlternate,
  BriefingFuel,
  FuelLine,
  Intam,
  NavPoint,
  Notam,
  NotamBulletin,
  OptiClimb,
  Procedure,
  BriefingStation,
  StationRole,
  WindsAloft,
} from "./types"

const MONTHS: Record<string, number> = {
  JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5, JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11,
}

const TITLES = [
  "Important files",
  "OFP",
  "OPTIFLIGHT BRIEFING",
  "Additional Info",
  "Airport WX List",
  "NOTAM",
  "INTAM",
  "ABD File",
  "Additional Docs",
]

/** The running header and the page furniture — never content. */
const FURNITURE = [
  /^\s*Page \d+(?: of \d+)?\s*$/,
  /^\s*PAGE\s+\d+\s+OF\s+\d+\s/,
  /^\s*[A-Z]{3} ?\d+\/\d{1,2}[A-Za-z]{3}\d{2}\/[A-Z]{4}-[A-Z]{4} Reg:/,
  /^\s*[A-Z]{3}\/\d+\/[A-Z]{4}-[A-Z]{4}\s*$/,
]
const isFurniture = (l: string) => FURNITURE.some((r) => r.test(l))

/** The package as its sections, each the lines it holds (furniture removed). */
export function splitSections(pages: string[][]): { title: string; lines: string[] }[] {
  const out: { title: string; lines: string[] }[] = []
  for (const page of pages) {
    const lines = page.filter((l) => !isFurniture(l))
    const first = lines.findIndex((l) => l.trim() !== "")
    if (first < 0) continue
    const title = TITLES.find((t) => lines[first].trim() === t)
    if (title) out.push({ title, lines: lines.slice(first + 1) })
    else if (out.length) out[out.length - 1].lines.push(...lines)
    else out.push({ title: "", lines })
  }
  return out
}

/* ── small readers ───────────────────────────────────────────────────────── */

const num = (s: string | undefined | null): number | null => {
  if (!s || /^\.+$/.test(s)) return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}
/** "01.07" → "1:07"; dots → null. */
const hmm = (s: string | undefined | null): string | null => {
  const m = s?.match(/^(\d{1,2})[.:](\d{2})$/)
  return m ? `${Number(m[1])}:${m[2]}` : null
}
const minutesOf = (s: string): number => {
  const m = s.match(/^(\d{1,2})[.:](\d{2})$/)
  return m ? Number(m[1]) * 60 + Number(m[2]) : 0
}
/** "2230" → "22:30". */
const clock = (s: string | undefined) => (s && /^\d{4}$/.test(s) ? `${s.slice(0, 2)}:${s.slice(2)}` : "")
/** "P011" / "M010" → 11 / -10. */
const signed = (s: string | undefined | null): number | null => {
  const m = s?.match(/^([PM])(\d+)$/)
  return m ? (m[1] === "M" ? -1 : 1) * Number(m[2]) : null
}
/** "N01 29.6" → 1.4933. */
function coord(s: string): number {
  const m = s.match(/^([NSEW])(\d{2,3}) (\d{2}(?:\.\d+)?)$/)
  if (!m) return NaN
  const v = Number(m[2]) + Number(m[3]) / 60
  return m[1] === "S" || m[1] === "W" ? -v : v
}
/** "22NOV26" → "2026-11-22". */
function isoDay(s: string): string {
  const m = s.match(/^(\d{2})([A-Z]{3})(\d{2})$/)
  if (!m || MONTHS[m[2]] === undefined) return ""
  return `20${m[3]}-${String(MONTHS[m[2]] + 1).padStart(2, "0")}-${m[1]}`
}
/** "11-OCT-26 1600" → UTC ms. */
function notamTime(s: string): number | null {
  const m = s.trim().match(/^(\d{2})-([A-Z]{3})-(\d{2}) (\d{2})(\d{2})/)
  if (!m || MONTHS[m[2]] === undefined) return null
  return Date.UTC(2000 + Number(m[3]), MONTHS[m[2]], Number(m[1]), Number(m[4]), Number(m[5]))
}
/** "2611222230" → UTC ms. */
function compactTime(s: string): number | null {
  const m = s.match(/^(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/)
  return m ? Date.UTC(2000 + Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5])) : null
}
const titleCase = (s: string) =>
  s
    .toLowerCase()
    .replace(/(^|[\s(/-])([a-z])/g, (_, p: string, c: string) => p + c.toUpperCase())
    .replace(/\(S\)/g, "(s)")
const find = (lines: string[], re: RegExp) => {
  for (const l of lines) {
    const m = l.match(re)
    if (m) return m
  }
  return null
}

/* ── the OFP ─────────────────────────────────────────────────────────────── */

const ROUTE_START = /^\s*[A-Z]{4}\/\w+\s/
const ROUTE_END = /\s[A-Z]{4}\/\w+\s*$/
const ROUTE = /^\s*([A-Z]{4})\/(\w+) (.+) ([A-Z]{4})\/(\w+)\s*$/

/**
 * The ATC route — "WSSS/02C … VVTS/07L" — joined over the lines it WRAPS
 * onto. A long route runs past the print's width ("… L637 ANBOV" over
 * "ANBOV5E VVTS/07L", TR552); read as one line it matched nothing, the
 * departure and arrival came back blank and the import refused the package.
 * It starts on the line opening with an aerodrome and its runway and ends on
 * the line closing with one, a few lines at most, never past the schedule.
 */
export function readRoute(ofp: string[]): RegExpMatchArray | null {
  for (let i = 0; i < ofp.length; i++) {
    if (!ROUTE_START.test(ofp[i])) continue
    let joined = ofp[i].trim()
    for (let j = i; j < Math.min(ofp.length, i + 6); j++) {
      if (j > i) {
        if (/SCHED\s+DEP|FLT\s+RULES/.test(ofp[j])) break
        joined += " " + ofp[j].trim()
      }
      if (ROUTE_END.test(" " + joined)) {
        const m = joined.match(ROUTE)
        if (m) return m
        break
      }
    }
  }
  return null
}

function fuelLine(lines: string[], label: string): FuelLine {
  const m = find(lines, new RegExp(`${label.replace(/ /g, "\\s+")}\\s+(\\d{2}\\.\\d{2}|\\.+)?\\s*(\\d+|\\.+)\\s*$`))
  return { time: hmm(m?.[1]), kg: num(m?.[2]) }
}

function readFuel(lines: string[]): BriefingFuel {
  const alternate = fuelLine(lines, "ALTN FUEL")
  const finalReserve = fuelLine(lines, "ALTN HOLD")
  const additionalReasons: { reason: string; kg: number }[] = []
  for (const l of lines) {
    const m = l.match(/^\s*\d\.([A-Z ]+?)\s+(\d+)KG/)
    if (m) additionalReasons.push({ reason: titleCase(m[1].trim()), kg: Number(m[2]) })
    if (/^\s*PLAN \d/.test(l)) break
  }
  return {
    trip: fuelLine(lines, "BURNOFF"),
    contingency: fuelLine(lines, "\\d+(?:\\.\\d)?% CONT"),
    contingencyPct: num(find(lines, /(\d+(?:\.\d)?)%\s+CONT/)?.[1]),
    alternate,
    finalReserve,
    topup60: fuelLine(lines, "60 MIN TOPUP FUEL"),
    taxi: fuelLine(lines, "TAXI FUEL"),
    required: fuelLine(lines, "FLT PLAN REQMT"),
    additional: fuelLine(lines, "ADDITIONAL FUEL"),
    extra: fuelLine(lines, "EXTRA FUEL"),
    inTanks: fuelLine(lines, "FUEL IN TANKS"),
    mdf: alternate.kg !== null && finalReserve.kg !== null ? alternate.kg + finalReserve.kg : null,
    additionalReasons,
    burnPerTonneZfw: num(find(lines, /ZFW\s+CHANGE\s+P1000KG\s+BURN\s+ADD\s+(\d+)\s*KG/)?.[1]),
    burn2000Below: num(find(lines, /2000\s+FT\s+BELOW.*BURN\s+ADD\s+(\d+)\s*KG/)?.[1]),
  }
}

function weight(lines: string[], label: string) {
  const m = find(lines, new RegExp(`^\\s*${label}\\s+(\\d+|\\.+)\\s+\\S+\\s+(\\d+|\\.+)`))
  return { planned: num(m?.[1]), max: num(m?.[2]) }
}

function readAlternates(lines: string[]): BriefingAlternate[] {
  const out: BriefingAlternate[] = []
  const start = lines.findIndex((l) => /^\s*ALTN\/RWY\s+APPROACH/.test(l))
  if (start < 0) return out
  const row = /^\s*([A-Z]{4})\/(\w+)\s+(.+?)\s+(\d+FT\/\d+M)\s+(\d{3,4})\s+(\d{3})\s+([PM]\d{3})\s+(\d{4})\s+(\d{4,5})\s*$/
  let i = start + 1
  for (; i < lines.length; i++) {
    const m = lines[i].match(row)
    if (m) {
      out.push({
        icao: m[1],
        runway: m[2],
        approach: m[3].trim(),
        minima: m[4],
        distNm: Number(m[5]),
        fl: Number(m[6]),
        windKt: signed(m[7]),
        time: hmm(`${m[8].slice(0, 2)}.${m[8].slice(2)}`),
        fuelKg: Number(m[9]),
        route: "",
      })
    } else if (lines[i].trim() && out.length) break
  }
  // "WSSS RTE: WBGG MOXUN1D …", a long one carried on to an indented line.
  for (; i < lines.length; i++) {
    const m = lines[i].match(/^\s*([A-Z]{4})\s+RTE:\s+(.+)$/)
    if (!m) {
      if (/^\s*(EXTRA FUEL REASON|DISP BY|ARR ATIS|ATC)/.test(lines[i])) break
      continue
    }
    let text = m[2].trim()
    while (i + 1 < lines.length && /^\s{4,}[A-Z0-9 ]+$/.test(lines[i + 1]) && !/RTE:/.test(lines[i + 1])) {
      text += " " + lines[++i].trim()
    }
    const alt = out.find((a) => a.icao === m[1] && !a.route)
    if (alt) alt.route = text
  }
  return out
}

function readProcedure(lines: string[], kind: "SID" | "STAR"): Procedure | null {
  const start = lines.findIndex((l) => new RegExp(`^\\s*${kind}:\\s*([A-Z]{4})\\/(\\w+)\\s+(\\w+)`).test(l))
  if (start < 0) return null
  const head = lines[start].match(new RegExp(`${kind}:\\s*([A-Z]{4})\\/(\\w+)\\s+(\\w+)`))!
  const waypoints = []
  let totalNm: number | null = null
  for (let i = start + 1; i < lines.length; i++) {
    const total = lines[i].match(new RegExp(`${kind}\\s+TOTAL\\s+DIST:\\s*(\\d+)`))
    if (total) {
      totalNm = Number(total[1])
      break
    }
    const m = lines[i].match(/^\s*(\w+)\s+([NS]\d{2} \d{2}\.\d)\s+([EW]\d{3} \d{2}\.\d)(?:\s+(\d+) NM)?/)
    if (m) waypoints.push({ name: m[1], lat: coord(m[2]), lon: coord(m[3]), distNm: num(m[4]) })
  }
  return { name: head[3], runway: head[2], waypoints, totalNm }
}

const NAV_HEAD = /^\s*(-?[A-Z0-9]{2,7})\s+(\d{2}\.\d{2})\s+(\d+\.\d{2})\b(.*)$/
const NAV_POS = /^\s*([NS]\d{2} \d{2}\.\d) ([EW]\d{3} \d{2}\.\d)\s+(.*)$/

/** The nav log, point by point. */
export function readNavlog(lines: string[]): NavPoint[] {
  const out: NavPoint[] = []
  for (let i = 0; i < lines.length; i++) {
    const head = lines[i].match(NAV_HEAD)
    if (!head) continue
    let j = i + 1
    while (j < lines.length && !lines[j].trim()) j++
    const pos = lines[j]?.match(NAV_POS)
    if (!pos) continue
    const t = pos[3].split(/\s+/).filter((x) => x && !/^\.+$/.test(x))
    // From the back: fuel remaining, distance to go, ground speed, then the
    // optional wind and ISA deviation, then the track.
    const fuel = t.length && /^\d{3}\.\d$/.test(t[t.length - 1]) ? Number(t.pop()) * 1000 : null
    const toGo = t.length && /^\d{4}$/.test(t[t.length - 1]) ? Number(t.pop()) : null
    const gs = t.length && /^\d{3}$/.test(t[t.length - 1]) ? Number(t.pop()) : null
    const wind = t.length && /^\d{5}$/.test(t[t.length - 1]) ? t.pop()! : ""
    const isa = t.length && /^[PM]\d{2}$/.test(t[t.length - 1]) ? signed(t.pop()) : null
    if (t.length && /^\d{3}$/.test(t[t.length - 1])) t.pop() // the track
    // From the front: MSA, then the leg distance, then the level.
    let msa: number | null = null
    if (t.length >= 2 && /^\d{3}$/.test(t[0]) && /^\d{4}$/.test(t[1])) msa = Number(t.shift()) * 100
    const leg = t.length && /^\d{4}$/.test(t[0]) ? Number(t.shift()) : null
    const level = t.length && /^(CLB|DSC|\d{3})$/.test(t[0]) ? t.shift()! : ""
    const name = head[1]
    out.push({
      name,
      fir: name.startsWith("-") ? name.slice(1) : null,
      lat: coord(pos[1]),
      lon: coord(pos[2]),
      elapsedMin: minutesOf(head[2]),
      level,
      msaFt: msa,
      legNm: leg,
      wind,
      isaDev: isa,
      groundSpeedKt: gs,
      toGoNm: toGo,
      fuelRemainingKg: fuel,
    })
    i = j
  }
  return out
}

function readWinds(lines: string[], cruiseFl: number | null): WindsAloft {
  const rows: WindsAloft["rows"] = []
  const start = lines.findIndex((l) => /^\s*WPT ID FL\s+WIND/.test(l))
  if (start >= 0) {
    for (let i = start + 1; i < lines.length; i++) {
      const m = lines[i].match(/^\s*([A-Z0-9]{2,7})\s+(\d{3} .*)$/)
      if (!m) {
        if (lines[i].trim() && rows.length) break
        continue
      }
      const levels = [...m[2].matchAll(/(\d{3}) (\d{5}) ([PM]\d{2})/g)].map((x) => ({ fl: Number(x[1]), wind: x[2], oat: signed(x[3])! }))
      const trop = m[2].match(/[PM]\d{2}\s+(\d{3})\s*$/)
      rows.push({ name: m[1], levels, tropopause: trop ? Number(trop[1]) : null })
    }
  }
  const trops = rows.map((r) => r.tropopause).filter((x): x is number => x !== null)
  const cruise = rows
    .filter((r) => r.name !== "CLB" && r.name !== "DES")
    .flatMap((r) => r.levels.filter((l) => l.fl === cruiseFl).map((l) => l.oat))
  return {
    rows,
    tropopause: trops.length ? Math.min(...trops) : null,
    cruiseOat: cruise.length ? Math.round(cruise.reduce((a, b) => a + b, 0) / cruise.length) : null,
  }
}

function readOptiClimb(lines: string[]): OptiClimb | null {
  const head = find(lines, /OPTICLIMB\s+SPEEDS\s+FOR\s+PLANNED\s+TOW\s+(\d+)\s*KG\s+AND\s+TOC\s+FL(\d+)/)
  if (!head) return null
  const steps: { ias: number; fl: number }[] = []
  const first = find(lines, /IAS (\d{3})\s*\/\s*FL(\d{2,3})/)
  if (first) steps.push({ ias: Number(first[1]), fl: Number(first[2]) })
  const topFl = Number(head[2])
  for (const l of lines) {
    const m = l.match(/At FL(\d{2,3})\s*,\s*select IAS (\d{3})/)
    if (m) steps.push({ ias: Number(m[2]), fl: topFl })
  }
  // Each later speed holds to the next change, the last to the top of climb.
  const changes = lines.map((l) => l.match(/At FL(\d{2,3})\s*,\s*select IAS/)).filter(Boolean).map((m) => Number(m![1]))
  for (let k = 1; k < steps.length; k++) steps[k].fl = changes[k] ?? topFl
  return {
    plannedTowKg: Number(head[1]),
    maxTowKg: num(find(lines, /ACTUAL\s+TOW\s*>\s*(\d+)\s*KG/)?.[1]),
    topFl,
    steps,
  }
}

/* ── the weather list ────────────────────────────────────────────────────── */

const ROLES: [RegExp, StationRole][] = [
  [/^DEPARTURE AIRPORT:/, "departure"],
  [/^DESTINATION AIRPORT:/, "destination"],
  [/^DESTINATION ALTERNATE/, "alternate"],
  [/^ENROUTE AIRPORT/, "enroute"],
]

/**
 * The airports the list names, by role — departure, destination, the
 * alternates, en route. Their METAR and TAF are NOT kept: the briefing shows
 * live weather for them (`/api/lookup/weather`), which is newer than any the
 * PDF printed (the owner, Nov 2026). The list is read for who is who.
 */
function readStations(lines: string[]): BriefingStation[] {
  const stations: BriefingStation[] = []
  let role: StationRole | null = null
  for (const raw of lines) {
    const l = raw.trim()
    if (!l || /^AIRPORTLIST ENDED/.test(l)) continue
    const r = ROLES.find(([re]) => re.test(l))
    if (r) {
      role = r[1]
      continue
    }
    const st = l.match(/^([A-Z]{4})\/([A-Z0-9]{3})\s+(.+)$/)
    if (st && role && !stations.some((x) => x.icao === st[1])) {
      stations.push({ icao: st[1], iata: st[2], name: titleCase(st[3]), role })
      continue
    }
    // An advisory heading after the stations ("Space Weather Advisory:") ends them.
    if (/:$/.test(l) && !/^(SA|SP|FT)\s/.test(l)) role = null
  }
  return stations
}

/* ── NOTAMs ──────────────────────────────────────────────────────────────── */

const ITEM = /^\s*([A-Z0-9]{1,4}\d*\/\d{2})\s+VALID:\s*(\d{2}-[A-Z]{3}-\d{2} \d{4})\s*-\s*(\S.*?)\s*$/
const CATEGORY = /^\s*\+{3,}\s*(.+?)\s*\+{3,}\s*$/
const RULE = /^\s*-{5,}\s*$/
const BANNER = /^\s*={5,}\s*$/

/** 32-bit FNV-1a, base 36. */
function hash(s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(36)
}

/**
 * Which NOTAM this is, whatever number it is issued under and whatever its
 * dates: its location and its WORDS (the owner: "if there's an update of
 * validity or period while info remains the same, it continues to be
 * checked"). The words leave out what a re-issue changes — the reference
 * number, a "VALIDITY:" line, the schedule — and their spacing.
 */
export function notamKey(location: string, text: string): string {
  const words = text
    .toUpperCase()
    .split("\n")
    .filter((l) => !/^\s*VALIDITY\s*:/.test(l))
    .join(" ")
    .replace(/\b[A-Z0-9]{1,3}\d{2,5}\/\d{2}\b/g, " ")
    .replace(/[^A-Z0-9]+/g, " ")
    .trim()
  return `${location}|${hash(words)}`
}

/** A line that is only dates and times ("NOV 21-30 0030-0130 …", "DAILY 0000-1030", "0250 - 2300"). */
const SCHEDULE_WORDS = /\b(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC|DAILY|DLY|EXC|SR|SS|HJ|HN|MON|TUE|WED|THU|FRI|SAT|SUN|AND|TIL)\b/g
const isSchedule = (l: string) =>
  /^[A-Z0-9 ,\-]+$/.test(l) && !/[A-Z]{2,}/.test(l.replace(SCHEDULE_WORDS, "")) && (/\d{4}\s*-\s*\d{4}/.test(l) || /^\d{4}(?:\s|,|$)/.test(l))

export function readNotams(lines: string[]): NotamBulletin {
  const items: Notam[] = []
  const valid = find(lines, /VALID:\s*(\d{10})\s*-\s*(\d{10})/)
  let section = ""
  let location = ""
  let locationName = ""
  let category = ""
  let cur: { id: string; from: string; to: string; body: string[] } | null = null
  const flush = () => {
    if (!cur) return
    const body = cur.body.map((l) => l.trim()).filter(Boolean)
    let duplicate = false
    if (body[body.length - 1] === "DUPE") {
      duplicate = true
      body.pop()
    }
    const scheduleLines: string[] = []
    while (body.length > 1 && isSchedule(body[0])) scheduleLines.push(body.shift()!)
    const schedule = scheduleLines.join(" ")
    const text = body.join("\n")
    const fg = text.match(/^F\)[ \t]*(\S.*?)[ \t]+G\)[ \t]*(\S.*?)[ \t]*$/m)
    const to = cur.to.toUpperCase()
    items.push({
      key: notamKey(location, text),
      id: cur.id,
      location,
      locationName,
      section,
      category,
      fromMs: notamTime(cur.from),
      toMs: notamTime(to),
      toText: /^(PERM|UFN)/.test(to) ? to.split(/\s/)[0] : to,
      schedule,
      limits: fg ? `${fg[1]} – ${fg[2]}` : "",
      text,
      duplicate,
    })
    cur = null
  }
  const nextText = (i: number) => {
    for (let k = i + 1; k < lines.length; k++) if (lines[k].trim()) return { line: lines[k], at: k }
    return null
  }
  const start = lines.findIndex((l) => /LIDO-NOTAM-BULLETIN INCLUDES|^\s*={5,}\s*$/.test(l))
  for (let i = Math.max(0, start); i < lines.length; i++) {
    const l = lines[i]
    if (/END OF LIDO-NOTAM-BULLETIN/.test(l)) break
    // A section: its title between two rules of "=".
    if (BANNER.test(l)) {
      const t = nextText(i)
      const after = t ? nextText(t.at) : null
      if (t && after && BANNER.test(after.line)) {
        flush()
        section = titleCase(t.line.trim())
        location = ""
        locationName = ""
        category = ""
        i = after.at
      }
      continue
    }
    // A location: its line over a dashed rule, then a category, an entry or NIL.
    const below = nextText(i)
    if (below && RULE.test(below.line) && !RULE.test(l)) {
      const then = nextText(below.at)
      if (!then || CATEGORY.test(then.line) || ITEM.test(then.line) || /^\s*NIL\s*$/.test(then.line)) {
        flush()
        const ap = l.trim().match(/^([A-Z]{4}) \/([A-Z0-9]{3})\s+(.+?)(?:\s+\/[A-Z ]+?)?(?:\s+-\s+DETAILED INFO)?$/)
        const area = l.trim().match(/^([A-Z0-9]{2,5})\s{2,}(.+)$/)
        if (ap) {
          location = ap[1]
          locationName = titleCase(ap[3])
        } else if (area) {
          location = area[1]
          locationName = titleCase(area[2])
        } else {
          location = l.trim().replace(/\s{2,}/g, " ")
          locationName = ""
        }
        category = ""
        i = below.at
        continue
      }
    }
    const cat = l.match(CATEGORY)
    if (cat) {
      flush()
      category = cat[1]
      continue
    }
    const item = l.match(ITEM)
    if (item) {
      flush()
      cur = { id: item[1], from: item[2], to: item[3], body: [] }
      continue
    }
    if (cur) cur.body.push(l)
  }
  flush()
  return { validFromMs: compactTime(valid?.[1] ?? ""), validToMs: compactTime(valid?.[2] ?? ""), items }
}

/* ── INTAMs ──────────────────────────────────────────────────────────────── */

export function readIntams(lines: string[]): Intam[] {
  const out: Intam[] = []
  let cur: Intam | null = null
  let body: string[] = []
  const flush = () => {
    if (!cur) return
    cur.body = body
      .join("\n")
      .replace(/^\s*-{5,}\s*$/m, "")
      .trim()
      .replace(/\n{3,}/g, "\n\n")
    out.push(cur)
    cur = null
    body = []
  }
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]
    const head = l.match(/^\s*[A-Z]{3} INTAM (\w+)\s*$/)
    if (head) {
      flush()
      let t = i + 1
      while (t < lines.length && !lines[t].trim()) t++
      cur = { id: head[1], title: lines[t]?.trim() ?? "", body: "", auth: "" }
      i = t
      continue
    }
    if (!cur) continue
    const auth = l.match(/^\s*AUTH:\s*(.+?)["”]?\s*$/)
    if (auth) {
      cur.auth = auth[1]
      flush()
      continue
    }
    if (/^\s*={5,}\s*$/.test(l)) continue
    body.push(l.trim())
  }
  flush()
  return out
}

/* ── the whole package ───────────────────────────────────────────────────── */

/** Whether pages look like a company briefing package (an OFP and its NOTAM bulletin). */
export function isBriefingPackage(pages: string[][]): boolean {
  const text = pages.slice(0, 20).flat().join("\n")
  return /STANDARD OFP/.test(text) && /PLAN \d+/.test(text) && /FLT PLAN REQMT/.test(text)
}

export function parseBriefing(pages: string[][]): Briefing {
  const sections = splitSections(pages)
  const of = (title: string) => sections.find((s) => s.title === title)?.lines ?? []
  const all = sections.flatMap((s) => s.lines)
  const ofp = of("OFP").length ? of("OFP") : all

  const flightLine = find(ofp, /^\s*(\w{4,6})\s+([A-Z]{3})(\d{1,4}[A-Z]?)\s+([A-Z]{3})\/([A-Z]{3})\s+ETD\s+(\d{4})\s+(\d{2}[A-Z]{3}\d{2})/)
  const routeNo = find(ofp, /RTE\s+NO\s+(\S+)\s+(\S+)\s+CAPT\s+(.+?)\s*$/)
  const routeText = readRoute(ofp)
  const sched = find(ofp, /SCHED\s+DEP\s+(\d{4})\s+UTC\s+SCHED\s+ARR\s+(\d{4})/)
  const rules = find(ofp, /FLT\s+RULES:\s*(\S+)\s+CRUISE\s+CI\s*(\d+)/)
  const cruise = find(ofp, /^\s*[A-Z]{3}\/(\d{3})\s*$/)
  const bulletin = of("NOTAM")
  const atc = bulletin.find((l) => /^\s*N\d{4}F\d{3}\s/.test(l))?.trim() ?? ""
  const cruiseFl = num(cruise?.[1]) ?? num(atc.match(/^N\d{4}F(\d{3})/)?.[1])
  const fuel = readFuel(ofp)

  // The IATA number from the dispatch line ("I N F O TR438 WSSS/WBGG").
  const iata = find(of("Additional Info"), /I\s*N\s*F\s*O\s+([A-Z0-9]{2})(\d{1,4}[A-Z]?)\s/)
  const header = find(pages.flat(), /Reg:\s*(\w+)\s+OFP:\s*(\d+)/)
  const generated = find(pages.flat(), /Generated\s+Date\s+Time:\s*(\d{1,2}) ([A-Za-z]{3}) (\d{4}) (\d{2}):(\d{2}) UTC/)
  const utcVar = find(ofp, /UTC VAR\s+([+-])(\d{2})(\d{2})/)

  const dep = routeText?.[1] ?? ""
  const arr = routeText?.[4] ?? ""
  const stations = readStations(of("Airport WX List"))
  const iataOf = (icao: string, fallback: string) => stations.find((s) => s.icao === icao)?.iata ?? fallback

  const rtowHead = find(ofp, /^\s*([A-Z]{4})\s+RWY\s+(\w+)\s+STD\s+RATING:\s*(.+?)\s*$/)
  const rtow = rtowHead
    ? {
        airport: rtowHead[1],
        runway: rtowHead[2],
        rating: rtowHead[3],
        condition: find(ofp, /RWY\s+COND:\s*(\S+)/)?.[1] ?? "",
        flaps: find(ofp, /FLAPS\s+(\S+)/)?.[1] ?? "",
        limit: find(ofp, /^\s*LIMIT\s+(\S+)/)?.[1] ?? "",
        rtowKg: num(find(ofp, /^\s*RTOW\s+(\d+)\s*$/)?.[1]),
        perfKg: num(find(ofp, /RTOW\(PERF\)\s+(\d+)/)?.[1]),
        landKg: num(find(ofp, /RTOW\(LAND\)\s+(\d+)/)?.[1]),
        structKg: num(find(ofp, /RTOW\(STRUC\)\s+(\d+)/)?.[1]),
        eosid: find(ofp, /EOSID\s*:\s*(.+?)\s*$/)?.[1] ?? "",
        maxFuelAvailKg: num(find(ofp, /MAX\s+FUEL\s+AVAIL:\s*(\d+)/)?.[1]),
        excessKg: num(find(ofp, /EXCESS\s+AVAIL:\s*(\d+)/)?.[1]),
      }
    : null

  const winds = readWinds(ofp, cruiseFl)
  const airNm = num(find(ofp, /AIR\s+MILES\s+(\d+)/)?.[1])

  return {
    version: 2,
    flight: {
      number: iata ? `${iata[1]}${iata[2]}` : flightLine ? `${flightLine[2]}${flightLine[3]}` : "",
      callsign: flightLine ? `${flightLine[2]}${flightLine[3]}` : "",
      date: flightLine ? isoDay(flightLine[7]) : "",
      dep,
      arr,
      depIata: iataOf(dep, flightLine?.[4] ?? ""),
      arrIata: iataOf(arr, flightLine?.[5] ?? ""),
      registration: dashRegistration(header?.[1] ?? flightLine?.[1] ?? ""),
      aircraftType: routeNo?.[2] ?? "",
      ofpVersion: header?.[2] ?? find(ofp, /^\s*PLAN (\d+)/)?.[1] ?? "",
      routeNumber: routeNo?.[1] ?? "",
      captain: routeNo ? titleCase(routeNo[3]) : "",
      arrUtcOffsetMinutes: utcVar ? (utcVar[1] === "-" ? -1 : 1) * (Number(utcVar[2]) * 60 + Number(utcVar[3])) : null,
      generatedAtMs: generated
        ? Date.UTC(Number(generated[3]), MONTHS[generated[2].toUpperCase()], Number(generated[1]), Number(generated[4]), Number(generated[5]))
        : null,
    },
    route: {
      text: routeText ? routeText[0].trim() : "",
      atc,
      depRunway: routeText?.[2] ?? "",
      arrRunway: routeText?.[5] ?? "",
      cruiseFl,
      costIndex: num(rules?.[2]),
      rules: rules?.[1] ?? "",
      groundNm: num(find(ofp, /GND\s+MILES\s+(\d+)/)?.[1]),
      airNm,
      avgWindKt: signed(find(ofp, /CRZ\s+COMP\s+([PM]\d{3})/)?.[1]),
      schedDep: clock(sched?.[1]),
      schedArr: clock(sched?.[2]),
      tripTime: fuel.trip.time ?? "",
    },
    fuel,
    weights: { zfw: weight(ofp, "PZFW"), tow: weight(ofp, "PTOW"), lw: weight(ofp, "PLWT") },
    alternates: readAlternates(ofp),
    rtow,
    sid: readProcedure(ofp, "SID"),
    star: readProcedure(ofp, "STAR"),
    navlog: readNavlog(ofp),
    winds,
    optiClimb: readOptiClimb(of("OPTIFLIGHT BRIEFING")),
    stations,
    notams: readNotams(bulletin),
    intams: readIntams(of("INTAM")),
  }
}
