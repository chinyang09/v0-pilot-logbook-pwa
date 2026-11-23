/**
 * A METAR and a TAF READ — what a pilot does with them before a flight: which
 * TAF periods cover the times they will be there, what each period brings
 * (category, the hazards worth a second look), and the worst of it. Pure, so
 * the reading is tested on real reports (`__tests__/brief.test.ts`).
 *
 * The raw text stays the record; this is the highlighting over it. It reads
 * what a briefing reads and no more:
 *
 * | | Read |
 * |---|---|
 * | periods | the base forecast, `FM`, `BECMG` (from its start on), `TEMPO`, `PROB30/40` (and `PROB TEMPO`) |
 * | a change group | laid OVER what prevails when it starts — a `TEMPO 4000 TSRA` keeps the base's cloud |
 * | category | FAA's: LIFR ceiling < 500ft or vis < 1SM; IFR < 1000ft / 3SM; MVFR ≤ 3000ft / 5SM |
 * | hazards | thunderstorm, CB / TCU, freezing, fog, heavy or frozen precipitation, squall, funnel cloud, volcanic ash, dust / sand storm, gusts or wind ≥ 25kt, LIFR visibility or ceiling |
 *
 * A flight's window at an airport is its time there ± one hour — the span a
 * destination forecast is checked over (`stationWindows`).
 */

export type FlightCategory = "VFR" | "MVFR" | "IFR" | "LIFR"

export interface Cloud {
  cover: "FEW" | "SCT" | "BKN" | "OVC" | "VV"
  baseFt: number
  type: "" | "CB" | "TCU"
}

/** What one report or one TAF period says. `undefined` = not stated there. */
export interface Conditions {
  windDir?: number | null
  windKt?: number
  gustKt?: number
  /** CAVOK: visibility 10km or more, no cloud below 5,000ft or the MSA, no weather. */
  cavok?: boolean
  /** Metres; 9999 for "10km or more", CAVOK included. */
  visM?: number
  weather?: string[]
  clouds?: Cloud[]
}

export type PeriodKind = "base" | "FM" | "BECMG" | "TEMPO" | "PROB"

export interface TafPeriod {
  kind: PeriodKind
  /** 30 or 40 for a PROB group. */
  prob?: number
  /** A PROB TEMPO group. */
  tempo?: boolean
  /** When it applies, ms. A BECMG runs from the start of its change to the next FM or the TAF's end. */
  from: number
  to: number
  /** The group's own words — the line a briefing prints. */
  text: string
  /** What the group itself states. */
  stated: Conditions
  /** What prevails during it: the group laid over what was there when it began. */
  conditions: Conditions
}

export interface ParsedTaf {
  station: string
  from: number
  to: number
  periods: TafPeriod[]
}

const HOUR = 3600_000

/* ── Tokens ──────────────────────────────────────────────────────────────── */

const WIND = /^(\d{3}|VRB)(\d{2,3})(?:G(\d{2,3}))?(KT|MPS)$/
const VIS_M = /^(\d{4})(?:NDV)?$/
const VIS_SM = /^(M|P)?(\d+)?(?:\/(\d+))?SM$/
const CLOUD = /^(FEW|SCT|BKN|OVC|VV)(\d{3}|\/\/\/)(CB|TCU|\/\/\/)?$/
const WX =
  /^(?:[-+]|VC)?(?:MI|BC|PR|DR|BL|SH|TS|FZ)*(?:DZ|RA|SN|SG|IC|PL|GR|GS|UP|BR|FG|FU|VA|DU|SA|HZ|PY|PO|SQ|FC|SS|DS)*$/

/** What a run of tokens states. `SM` visibility may span two tokens ("1 1/2SM"). */
export function readConditions(tokens: readonly string[]): Conditions {
  const c: Conditions = {}
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]
    let m: RegExpMatchArray | null
    if ((m = t.match(WIND))) {
      const mps = m[4] === "MPS"
      const kt = (n: number) => (mps ? Math.round(n * 1.944) : n)
      c.windDir = m[1] === "VRB" ? null : Number(m[1])
      c.windKt = kt(Number(m[2]))
      if (m[3]) c.gustKt = kt(Number(m[3]))
    } else if (t === "CAVOK") {
      c.cavok = true
      c.visM = 9999
      c.clouds = []
      c.weather = []
    } else if ((m = t.match(VIS_M)) && !/^\d{4}\/\d{4}$/.test(t)) {
      c.visM = Number(m[1])
    } else if ((m = t.match(VIS_SM))) {
      let miles = m[3] ? Number(m[2] ?? 1) / Number(m[3]) : Number(m[2] ?? 0)
      // "1 1/2SM": the whole mile is the token before.
      if (m[3] && /^\d+$/.test(tokens[i - 1] ?? "")) miles += Number(tokens[i - 1])
      c.visM = m[1] === "P" ? 9999 : Math.round(miles * 1609)
    } else if (t === "NSC" || t === "SKC" || t === "CLR" || t === "NCD") {
      c.clouds = []
    } else if ((m = t.match(CLOUD))) {
      if (m[2] === "///") continue
      ;(c.clouds ??= []).push({
        cover: m[1] as Cloud["cover"],
        baseFt: Number(m[2]) * 100,
        type: m[3] === "CB" || m[3] === "TCU" ? m[3] : "",
      })
    } else if (t === "NSW") {
      c.weather = []
    } else if (t.length >= 2 && WX.test(t) && t !== "AUTO") {
      ;(c.weather ??= []).push(t)
    }
  }
  return c
}

/** `b` laid over `a`: whatever `b` states replaces what `a` said. */
function overlay(a: Conditions, b: Conditions): Conditions {
  return {
    windDir: b.windKt !== undefined ? b.windDir : a.windDir,
    windKt: b.windKt ?? a.windKt,
    // A new wind without a gust has none.
    gustKt: b.windKt !== undefined ? b.gustKt : a.gustKt,
    visM: b.visM ?? a.visM,
    weather: b.weather ?? a.weather,
    clouds: b.clouds ?? a.clouds,
  }
}

/** The lowest broken, overcast or obscured layer, ft. */
export function ceilingFt(c: Conditions): number | null {
  const layers = (c.clouds ?? []).filter((l) => l.cover === "BKN" || l.cover === "OVC" || l.cover === "VV")
  return layers.length ? Math.min(...layers.map((l) => l.baseFt)) : null
}

/** FAA's flight category, from what is stated (an unstated ceiling is none). Null when neither is stated. */
export function categoryOf(c: Conditions): FlightCategory | null {
  const ceil = ceilingFt(c)
  if (c.visM === undefined && ceil === null && c.clouds === undefined) return null
  const vis = c.visM ?? 9999
  const ft = ceil ?? Infinity
  if (ft < 500 || vis < 1609) return "LIFR"
  if (ft < 1000 || vis < 4828) return "IFR"
  if (ft <= 3000 || vis <= 8047) return "MVFR"
  return "VFR"
}

const CATEGORY_RANK: Record<FlightCategory, number> = { VFR: 0, MVFR: 1, IFR: 2, LIFR: 3 }

export function worseCategory(a: FlightCategory | null, b: FlightCategory | null): FlightCategory | null {
  if (!a) return b
  if (!b) return a
  return CATEGORY_RANK[b] > CATEGORY_RANK[a] ? b : a
}

/** At or above this, wind or gust is worth a word. */
const WIND_HAZARD_KT = 25

/**
 * The hazards in some conditions, most serious first, as a briefing writes
 * them ("TS", "CB", "G35KT", "Vis 800m").
 */
export function hazardsOf(c: Conditions): string[] {
  const out: string[] = []
  const wx = c.weather ?? []
  const has = (re: RegExp) => wx.some((w) => re.test(w))
  if (has(/TS/)) out.push("TS")
  if ((c.clouds ?? []).some((l) => l.type === "CB")) out.push("CB")
  if (has(/FC/)) out.push("FC")
  if (has(/SQ/)) out.push("SQ")
  if (has(/VA/)) out.push("VA")
  if (has(/FZ/)) out.push("FZ")
  if (has(/GR|GS|PL|IC/)) out.push("GR")
  if (has(/SN|SG/)) out.push("SN")
  if (has(/^\+/)) out.push(wx.find((w) => w.startsWith("+"))!)
  if (has(/FG/) && !has(/^(MI|BC|PR|VC)FG$/)) out.push("FG")
  if (has(/DS|SS/)) out.push("DS")
  if ((c.clouds ?? []).some((l) => l.type === "TCU")) out.push("TCU")
  if ((c.gustKt ?? 0) >= WIND_HAZARD_KT) out.push(`G${c.gustKt}KT`)
  else if ((c.windKt ?? 0) >= WIND_HAZARD_KT) out.push(`${c.windKt}KT`)
  if (c.visM !== undefined && c.visM < 1609) out.push(`Vis ${c.visM}m`)
  const ceil = ceilingFt(c)
  if (ceil !== null && ceil < 500) out.push(`Ceiling ${ceil}ft`)
  return out
}

/* ── METAR ───────────────────────────────────────────────────────────────── */

/**
 * What a METAR observes — its body only: the trend after it (TEMPO, BECMG,
 * NOSIG) is a forecast, and the remarks are not conditions.
 */
export function metarConditions(raw: string): Conditions {
  const tokens = raw.trim().split(/\s+/)
  const body: string[] = []
  for (const t of tokens.slice(2)) {
    if (t === "RMK" || t === "TEMPO" || t === "BECMG" || t === "NOSIG") break
    // The temperature group "26/25" and the pressure are not conditions.
    if (/^M?\d{2}\/(M?\d{2})?$/.test(t) || /^[QA]\d{4}$/.test(t)) continue
    body.push(t)
  }
  return readConditions(body)
}

/**
 * The METAR's temperature, dew point and QNH — read off its body, which
 * `metarConditions` skips (they are not conditions). An "A2992" altimeter is
 * turned into hectopascals; nulls where the report does not give them.
 */
export function metarReadings(raw: string): { tempC: number | null; dewC: number | null; qnhHpa: number | null } {
  let tempC: number | null = null
  let dewC: number | null = null
  let qnhHpa: number | null = null
  const num = (s: string) => (s.startsWith("M") ? -Number(s.slice(1)) : Number(s))
  for (const t of raw.trim().split(/\s+/).slice(2)) {
    if (t === "RMK" || t === "TEMPO" || t === "BECMG" || t === "NOSIG") break
    let m: RegExpMatchArray | null
    if ((m = t.match(/^(M?\d{2})\/(M?\d{2})?$/))) {
      tempC = num(m[1])
      dewC = m[2] ? num(m[2]) : null
    } else if ((m = t.match(/^Q(\d{4})$/))) {
      qnhHpa = Number(m[1])
    } else if ((m = t.match(/^A(\d{4})$/))) {
      qnhHpa = Math.round(Number(m[1]) * 0.338639)
    }
  }
  return { tempC, dewC, qnhHpa }
}

/* ── TAF ─────────────────────────────────────────────────────────────────── */

/**
 * A "DDHH" or "DDHHMM" on the TAF's calendar: the issue's month, the next one
 * when the day is well before the issue's (a TAF issued on the 31st runs into
 * the 1st). Hour 24 is midnight of the next day.
 */
function dayTime(issued: number, dd: number, hh: number, mm = 0): number {
  const d = new Date(issued)
  let year = d.getUTCFullYear()
  let month = d.getUTCMonth()
  if (dd < d.getUTCDate() - 20) month += 1
  if (month > 11) {
    month = 0
    year += 1
  }
  return Date.UTC(year, month, dd, hh, mm)
}

const PERIOD = /^(\d{2})(\d{2})\/(\d{2})(\d{2})$/

/**
 * A TAF's periods, in order, each with what it states and what prevails
 * during it. `issued` is the issue time the cache file gives; a TAF with no
 * readable validity comes back with no periods.
 */
export function parseTaf(raw: string, issued: number): ParsedTaf {
  const tokens = raw.replace(/\s+/g, " ").trim().split(" ")
  let i = 0
  if (tokens[i] === "TAF") i++
  while (tokens[i] === "AMD" || tokens[i] === "COR" || tokens[i] === "RTD") i++
  const station = tokens[i++] ?? ""
  if (/^\d{6}Z$/.test(tokens[i] ?? "")) i++
  const validity = (tokens[i] ?? "").match(PERIOD)
  if (!validity) return { station, from: issued, to: issued, periods: [] }
  i++
  const header = tokens.slice(0, i).join(" ")
  const from = dayTime(issued, +validity[1], +validity[2])
  const to = dayTime(issued, +validity[3], +validity[4])

  // Split the rest into groups at each change indicator.
  type Raw = { head: string[]; body: string[] }
  const groups: Raw[] = [{ head: [], body: [] }]
  for (; i < tokens.length; i++) {
    const t = tokens[i]
    // Temperature forecasts (TX22/1906Z) are not conditions.
    if (/^T[XN]M?\d{2}\/\d{4}Z$/.test(t)) continue
    if (/^FM\d{6}$/.test(t) || t === "BECMG" || t === "TEMPO") {
      // PROB30 TEMPO is one indicator.
      const prev = groups[groups.length - 1]
      if (t === "TEMPO" && prev.head.length === 1 && /^PROB\d{2}$/.test(prev.head[0]) && prev.body.length === 0) {
        prev.head.push(t)
        continue
      }
      groups.push({ head: [t], body: [] })
    } else if (/^PROB\d{2}$/.test(t)) {
      groups.push({ head: [t], body: [] })
    } else {
      groups[groups.length - 1].body.push(t)
    }
  }

  const periods: TafPeriod[] = []
  // What prevails, period by period: the base, then each FM and BECMG.
  const prevailing: { at: number; c: Conditions }[] = []
  const prevailingAt = (ms: number): Conditions => {
    let c: Conditions = {}
    for (const p of prevailing) if (p.at <= ms) c = p.c
    return c
  }
  for (const g of groups) {
    const head = g.head[0]
    let body = g.body
    let start = from
    let end = to
    let kind: PeriodKind = "base"
    let prob: number | undefined
    let tempo = false
    if (head?.startsWith("FM")) {
      kind = "FM"
      const m = head.match(/^FM(\d{2})(\d{2})(\d{2})$/)!
      start = dayTime(issued, +m[1], +m[2], +m[3])
    } else if (head) {
      kind = head === "BECMG" ? "BECMG" : head === "TEMPO" ? "TEMPO" : "PROB"
      if (kind === "PROB") {
        prob = Number(head.slice(4))
        tempo = g.head[1] === "TEMPO"
      }
      const m = (body[0] ?? "").match(PERIOD)
      if (m) {
        start = dayTime(issued, +m[1], +m[2])
        end = dayTime(issued, +m[3], +m[4])
        body = body.slice(1)
      }
    }
    const stated = readConditions(body)
    const text = [...g.head, ...g.body].join(" ")
    if (kind === "base") {
      prevailing.push({ at: start, c: stated })
      periods.push({ kind, from: start, to: end, text: [header, ...g.body].join(" "), stated, conditions: stated })
    } else if (kind === "FM") {
      prevailing.push({ at: start, c: stated })
      periods.push({ kind, from: start, to: end, text, stated, conditions: stated })
    } else if (kind === "BECMG") {
      // From the start of the change it is the forecast, until the next FM.
      const c = overlay(prevailingAt(start), stated)
      prevailing.push({ at: start, c })
      periods.push({ kind, from: start, to: end, text, stated, conditions: c })
    } else {
      periods.push({ kind, prob, tempo, from: start, to: end, text, stated, conditions: overlay(prevailingAt(start), stated) })
    }
  }

  // A base or FM period runs to the next FM; a BECMG to the next FM or BECMG.
  const firm = periods.filter((p) => p.kind === "base" || p.kind === "FM" || p.kind === "BECMG")
  for (const p of periods) {
    if (p.kind === "TEMPO" || p.kind === "PROB") continue
    const next = firm.find((q) => q !== p && q.from > p.from && (q.kind === "FM" || (p.kind !== "base" && q.kind === "BECMG")))
    p.to = next ? next.from : to
  }
  return { station, from, to, periods }
}

/* ── A flight's window ───────────────────────────────────────────────────── */

export interface WindowBrief {
  /** Indexes into `periods` that touch the window. */
  touching: number[]
  /** The worst category those periods bring. */
  worst: FlightCategory | null
  /** Their hazards, each once, most serious first; a TEMPO / PROB one marked so ("TEMPO TS"). */
  hazards: string[]
}

/** What the TAF's periods bring between `fromMs` and `toMs`. */
export function briefWindow(taf: ParsedTaf, fromMs: number, toMs: number): WindowBrief {
  const touching: number[] = []
  let worst: FlightCategory | null = null
  const hazards: string[] = []
  taf.periods.forEach((p, i) => {
    if (p.to <= fromMs || p.from >= toMs) return
    touching.push(i)
    worst = worseCategory(worst, categoryOf(p.conditions))
    // A change group's hazards are the ones IT brings, not the base's again.
    const own = p.kind === "base" || p.kind === "FM" ? hazardsOf(p.conditions) : hazardsOf(p.stated)
    const tag = p.kind === "TEMPO" ? "TEMPO " : p.kind === "PROB" ? `PROB${p.prob} ` : ""
    for (const h of own) {
      const word = tag + h
      if (!hazards.includes(word) && !hazards.includes(h)) hazards.push(word)
    }
  })
  return { touching, worst, hazards }
}

/* ── Where and when a duty is at each airport ────────────────────────────── */

export interface LegTimes {
  /** For the label: "TR490". */
  label: string
  departureIcao: string
  arrivalIcao: string
  /** When it leaves / arrives, ms — actual where known, else planned. */
  departMs: number | null
  arriveMs: number | null
}

export interface StationWindow {
  station: string
  role: "dep" | "arr"
  label: string
  atMs: number
  fromMs: number
  toMs: number
}

/** ± this around the time at an airport — the span a destination forecast is checked over. */
export const WINDOW_MS = HOUR

/** Each airport's times in the duty, in the order flown. */
export function stationWindows(legs: readonly LegTimes[]): StationWindow[] {
  const out: StationWindow[] = []
  for (const l of legs) {
    if (l.departMs !== null && l.departureIcao)
      out.push({ station: l.departureIcao, role: "dep", label: l.label, atMs: l.departMs, fromMs: l.departMs - WINDOW_MS, toMs: l.departMs + WINDOW_MS })
    if (l.arriveMs !== null && l.arrivalIcao)
      out.push({ station: l.arrivalIcao, role: "arr", label: l.label, atMs: l.arriveMs, fromMs: l.arriveMs - WINDOW_MS, toMs: l.arriveMs + WINDOW_MS })
  }
  return out
}

/* ── Each airport, briefed ───────────────────────────────────────────────── */

export interface StationBrief {
  station: string
  /** The duty's times there. */
  windows: StationWindow[]
  metar: { raw: string; at: number; category: FlightCategory | null; hazards: string[] } | null
  taf: ParsedTaf | null
  /** For each window, what the TAF brings over it. */
  briefs: { window: StationWindow; brief: WindowBrief }[]
  /** Every TAF period that touches one of the windows, with the windows it touches. */
  touchedBy: Map<number, StationWindow[]>
  /** The worst the duty meets there: the TAF over its windows, else the METAR. */
  worst: FlightCategory | null
  /** The hazards it meets there, each once. */
  hazards: string[]
}

/**
 * Every airport of the duty, briefed: its METAR read, its TAF read over each
 * of the duty's times there. A station the source has nothing for keeps its
 * windows, with nothing read.
 */
export function briefStations(
  stations: readonly string[],
  windows: readonly StationWindow[],
  answer: { metar: Record<string, { raw: string; at: number; category: string }>; taf: Record<string, { raw: string; issued: number }> } | null,
): StationBrief[] {
  return stations.map((station) => {
    const mine = windows.filter((w) => w.station === station)
    const m = answer?.metar[station]
    const metarC = m ? metarConditions(m.raw) : null
    const metar = m
      ? {
          raw: m.raw,
          at: m.at,
          category: (["VFR", "MVFR", "IFR", "LIFR"].includes(m.category) ? m.category : categoryOf(metarC!)) as FlightCategory | null,
          hazards: hazardsOf(metarC!),
        }
      : null
    const t = answer?.taf[station]
    const taf = t ? parseTaf(t.raw, t.issued) : null
    const briefs = taf ? mine.map((window) => ({ window, brief: briefWindow(taf, window.fromMs, window.toMs) })) : []
    const touchedBy = new Map<number, StationWindow[]>()
    for (const { window, brief } of briefs) for (const i of brief.touching) touchedBy.set(i, [...(touchedBy.get(i) ?? []), window])
    let worst: FlightCategory | null = null
    const hazards: string[] = []
    for (const { brief } of briefs) {
      worst = worseCategory(worst, brief.worst)
      for (const h of brief.hazards) if (!hazards.includes(h)) hazards.push(h)
    }
    if (briefs.length === 0 && metar) {
      worst = metar.category
      hazards.push(...metar.hazards)
    }
    return { station, windows: mine, metar, taf, briefs, touchedBy, worst, hazards }
  })
}

/**
 * Hazards as a briefing line: those of one group together under its tag —
 * "TS CB · TEMPO TS CB G25KT", not "TEMPO TS TEMPO CB".
 */
export function hazardLine(hazards: readonly string[]): string {
  const groups = new Map<string, string[]>()
  for (const h of hazards) {
    const m = h.match(/^((?:TEMPO|PROB\d{2}) )?(.+)$/)!
    const tag = (m[1] ?? "").trim()
    groups.set(tag, [...(groups.get(tag) ?? []), m[2]])
  }
  return [...groups].map(([tag, hs]) => [tag, ...hs].filter(Boolean).join(" ")).join(" · ")
}
