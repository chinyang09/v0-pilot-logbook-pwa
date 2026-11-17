/**
 * Changi's own flight enquiry — the airport's record of a flight at SIN.
 *
 * For a flight departing or arriving Singapore it is the most current gate
 * there is (the pilot's own finding: ahead of the flight trackers), and it
 * also carries the STAND, the baggage BELT, the REGISTRATION and the linked
 * rotation — the inbound flight a departure's aeroplane arrives on, or the
 * departure an arrival turns into.
 *
 * What it is, measured 17 Nov 2026:
 *
 * | | |
 * |---|---|
 * | request | `POST /icargo/do/searchFlight`, form-encoded, no cookie or session |
 * | dates | the SINGAPORE date of the movement at SIN, as day / "Nov" / year |
 * | reach | about a week back and two days ahead; else "No Flight Record Found." |
 * | times | Singapore local, "17 Nov 2026 / 10:25" — scheduled, estimated, actual |
 * | status | DP departed, LD landed, blank until then |
 * | registration | "9VTNG", no dash; blank until the aeroplane is assigned |
 *
 * The page is HTML for a person; it is read by LABEL, never by position, and
 * a field it leaves blank is "". Server-side only (the door, on the Edge):
 * the page is plain http and answers no CORS.
 */

export const CHANGI_URL = "http://www.icargo.net/icargo/do/searchFlight"

/** Singapore is UTC+8 all year. */
const SGT_MS = 8 * 3600_000

export interface ChangiFlight {
  /** "TR288" — the page writes "TR 288". */
  flightNumber: string
  /** The movement AT Singapore. */
  direction: "departure" | "arrival"
  /** DP departed, LD landed, "" until then. */
  status: string
  /** The rotation: an arrival's onward departure, a departure's inbound. */
  linkedFlight: string
  /** ISO UTC, null where the page leaves it blank. */
  scheduled: string | null
  estimated: string | null
  actual: string | null
  terminal: string
  /** The other end's IATA code. */
  otherEnd: string
  /** "9V-TNG"; "" until assigned. */
  registration: string
  aircraftType: string
  /** The gate as it stands now — the current gate, else the scheduled one. */
  gate: string
  stand: string
  belt: string
}

const LABELS = [
  "Flight No",
  "Date",
  "Status",
  "Corr. Arrival Flight",
  "Corr. Departure Flight",
  "Scheduled Date/ Time",
  "Terminal",
  "Estimated Date/ Time",
  "Frequency",
  "Actual Date/Time",
  "Valid Date",
  "Destination",
  "Origin",
  "Registration",
  "Port",
  "Aircraft Type",
  "Scheduled Gate",
  "Current Gate",
  "Scheduled Stand",
  "Current Stand",
  "Belt",
] as const
type Label = (typeof LABELS)[number]
const IS_LABEL = new Set<string>([...LABELS, "Departure", "Arrival"])

const MONTHS: Record<string, number> = {
  Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11,
}

/** "17 Nov 2026 / 10:25" (Singapore) → ISO UTC. */
export function changiTimeToIso(text: string): string | null {
  const m = /^(\d{1,2}) ([A-Z][a-z]{2}) (\d{4}) \/ (\d{2}):(\d{2})$/.exec(text.trim())
  if (!m || MONTHS[m[2]] === undefined) return null
  const ms = Date.UTC(Number(m[3]), MONTHS[m[2]], Number(m[1]), Number(m[4]), Number(m[5])) - SGT_MS
  return new Date(ms).toISOString()
}

/** "9VTNG" → "9V-TNG". Singapore's marks; any other is left as written. */
export function dashRegistration(reg: string): string {
  const r = reg.trim().toUpperCase()
  if (!r || r.includes("-")) return r
  return /^9V[A-Z0-9]{3}$/.test(r) ? `9V-${r.slice(2)}` : r
}

/** The page's text as one token per cell. */
function tokens(html: string): string[] {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<select[\s\S]*?<\/select>/gi, "")
    .replace(/<[^>]+>/g, "\n")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .split("\n")
    .map((t) => t.replace(/\s+/g, " ").trim())
    .filter(Boolean)
}

/**
 * Every flight record on a result page — usually one, two where a number
 * both arrives and departs that day. Empty for "No Flight Record Found."
 * and for the bare search form.
 */
export function parseChangiFlightPage(html: string): ChangiFlight[] {
  const t = tokens(html)
  const out: ChangiFlight[] = []
  for (let i = 0; i < t.length; i++) {
    // A record starts at "Flight No" followed by a VALUE (the search form's
    // own "Flight No" is followed by its "*" and selects).
    if (t[i] !== "Flight No" || !/^[A-Z0-9]{2,3} ?\d+[A-Z]?$/.test(t[i + 1] ?? "")) continue
    const fields = new Map<Label, string>()
    let direction: ChangiFlight["direction"] | null = null
    let j = i
    for (; j < t.length; j++) {
      const tok = t[j]
      if (j > i && tok === "Flight No") break
      if (tok === "Departure" || tok === "Arrival") {
        direction ??= tok === "Departure" ? "departure" : "arrival"
        continue
      }
      if ((LABELS as readonly string[]).includes(tok)) {
        const next = t[j + 1]
        fields.set(tok as Label, next !== undefined && !IS_LABEL.has(next) ? next : "")
      }
    }
    i = j - 1
    if (!direction) continue
    const f = (l: Label) => fields.get(l) ?? ""
    out.push({
      flightNumber: f("Flight No").replace(/\s+/g, ""),
      direction,
      status: f("Status"),
      linkedFlight: (direction === "departure" ? f("Corr. Arrival Flight") : f("Corr. Departure Flight")).replace(/\s+/g, ""),
      scheduled: changiTimeToIso(f("Scheduled Date/ Time")),
      estimated: changiTimeToIso(f("Estimated Date/ Time")),
      actual: changiTimeToIso(f("Actual Date/Time")),
      terminal: f("Terminal"),
      otherEnd: direction === "departure" ? f("Destination") : f("Origin"),
      registration: dashRegistration(f("Registration")),
      aircraftType: f("Aircraft Type"),
      gate: f("Current Gate") || f("Scheduled Gate"),
      stand: f("Current Stand") || f("Scheduled Stand"),
      belt: f("Belt"),
    })
  }
  return out
}

/** The Singapore calendar date of an instant: what the enquiry is keyed on. */
export function singaporeDate(ms: number): string {
  return new Date(ms + SGT_MS).toISOString().slice(0, 10)
}

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

/** The form the page posts, for `number` on a Singapore date "YYYY-MM-DD". */
export function changiRequestBody(number: string, sgtDate: string): string {
  const m = /^([A-Z0-9]{2})(\d+[A-Z]?)$/.exec(number.toUpperCase().replace(/[^A-Z0-9]/g, ""))
  const [y, mo, d] = sgtDate.split("-").map(Number)
  return new URLSearchParams({
    action: "submit",
    option: "SearchFlight",
    flightNo1: m?.[1] ?? "",
    flightNo2: m ? String(Number(m[2].replace(/\D/g, ""))) + m[2].replace(/\d/g, "") : "",
    flightDate1: String(d).padStart(2, "0"),
    flightDate2: MON[mo - 1] ?? "",
    flightDate3: String(y),
  }).toString()
}

/**
 * Ask the enquiry. Resolves to the records found (possibly none); rejects
 * when the page could not be read at all, so a caller can tell "no record"
 * from "not asked".
 */
export async function fetchChangiFlights(
  number: string,
  sgtDate: string,
  timeoutMs = 7000,
  fetchImpl: typeof fetch = fetch,
): Promise<ChangiFlight[]> {
  const res = await fetchImpl(CHANGI_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: changiRequestBody(number, sgtDate),
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!res.ok) throw new Error(`Changi enquiry answered ${res.status}`)
  const html = await res.text()
  if (!html.includes("Flight Enquiry")) throw new Error("Changi enquiry answered something else")
  return parseChangiFlightPage(html)
}
