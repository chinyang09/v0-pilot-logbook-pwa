/**
 * A flight's BRIEFING PACKAGE as the company issues it (the owner, Nov 2026:
 * "upload PDFs exported from my company into the PWA … for reference"), read
 * into structure by `parseBriefing` (`parse.ts`).
 *
 * The package is one PDF in sections, each a page whose title follows the
 * running header (`TGW 438/22Nov26/WSSS-WBGG Reg:9VTNG OFP:4/0/0`):
 *
 * | section | holds | here |
 * |---|---|---|
 * | OFP (9 pages, printed twice — once alone under "Important files") | route, fuel, weights, alternates, RTOW, SID / nav log / STAR, forecast winds | `flight`, `route`, `fuel`, `weights`, `alternates`, `rtow`, `sid`, `star`, `navlog`, `winds` |
 * | OPTIFLIGHT BRIEFING | OptiClimb speeds for the planned TOW | `optiClimb` |
 * | Additional Info | the dispatch line ("TR438 WSSS/WBGG") | the IATA flight number |
 * | Airport WX List | METAR (SA) and TAF (FT) by role, advisories | `weather` |
 * | NOTAM (LIDO bulletin) | NOTAMs by section → location → category | `notams` |
 * | INTAM | company bulletins | `intams` |
 * | charts, ABD File, Additional Docs | pictures, or "NO DATA" | not read |
 *
 * Times are UTC. A figure the PDF leaves as dots ("......") is null.
 */

export interface Briefing {
  /** Bumped when the shape changes — a stored briefing older than this is re-read from its source, never guessed at. */
  version: 1
  flight: BriefingFlight
  route: BriefingRoute
  fuel: BriefingFuel
  weights: BriefingWeights
  alternates: BriefingAlternate[]
  rtow: BriefingRtow | null
  sid: Procedure | null
  star: Procedure | null
  navlog: NavPoint[]
  winds: WindsAloft
  optiClimb: OptiClimb | null
  weather: StationReport[]
  /** AIRMET / SIGMET / advisory text, by heading, where the list gives any. */
  advisories: { heading: string; text: string }[]
  notams: NotamBulletin
  intams: Intam[]
}

export interface BriefingFlight {
  /** As the app logs it — the IATA form where the package gives one ("TR438"), else the callsign. */
  number: string
  callsign: string
  /** UTC date of departure, "YYYY-MM-DD". */
  date: string
  dep: string
  arr: string
  depIata: string
  arrIata: string
  /** "9V-TNG". */
  registration: string
  /** "A320-271N". */
  aircraftType: string
  ofpVersion: string
  /** "SINKCH01". */
  routeNumber: string
  captain: string
  /** "+0800" → 480: the destination's offset the OFP states. */
  arrUtcOffsetMinutes: number | null
  generatedAtMs: number | null
}

export interface BriefingRoute {
  /** "WSSS/02C DODSO G580 ATETI DCT MOXUN MOXUN1A WBGG/25". */
  text: string
  /** The ATC route as the NOTAM bulletin files it ("N0450F290 DODSO G580 …"). */
  atc: string
  depRunway: string
  arrRunway: string
  cruiseFl: number | null
  costIndex: number | null
  rules: string
  groundNm: number | null
  airNm: number | null
  /** Average wind component, knots, a headwind negative ("CRZ COMP M010" → -10). */
  avgWindKt: number | null
  schedDep: string
  schedArr: string
  /** The trip's time, "1:07". */
  tripTime: string
}

export interface FuelLine {
  /** "h:mm", or null where the OFP gives no time. */
  time: string | null
  kg: number | null
}

export interface BriefingFuel {
  trip: FuelLine
  /** The route reserve — "5% CONT". */
  contingency: FuelLine
  alternate: FuelLine
  /** Final reserve — "ALTN HOLD". */
  finalReserve: FuelLine
  topup60: FuelLine
  taxi: FuelLine
  required: FuelLine
  additional: FuelLine
  extra: FuelLine
  inTanks: FuelLine
  /** Minimum diversion fuel: alternate + final reserve. */
  mdf: number | null
  /** "ADDITIONAL FUEL: 1.INTAM 0KG …" — each reason and its kilograms. */
  additionalReasons: { reason: string; kg: number }[]
  /** Burn per tonne of ZFW above plan ("P1000KG BURN ADD 25KG"). */
  burnPerTonneZfw: number | null
  /** Extra burn 2000ft below plan. */
  burn2000Below: number | null
}

export interface WeightLine {
  planned: number | null
  max: number | null
}

export interface BriefingWeights {
  zfw: WeightLine
  tow: WeightLine
  lw: WeightLine
}

export interface BriefingAlternate {
  icao: string
  runway: string
  approach: string
  minima: string
  distNm: number | null
  fl: number | null
  /** Wind component, knots, a headwind negative. */
  windKt: number | null
  time: string | null
  fuelKg: number | null
  /** "WBGG MOXUN1D MOXUN DCT ATETI G580 TOMAN". */
  route: string
}

export interface BriefingRtow {
  airport: string
  runway: string
  condition: string
  flaps: string
  rating: string
  limit: string
  rtowKg: number | null
  perfKg: number | null
  landKg: number | null
  structKg: number | null
  eosid: string
  maxFuelAvailKg: number | null
  excessKg: number | null
}

export interface Waypoint {
  name: string
  lat: number
  lon: number
  /** Leg distance into this point, nm, where the OFP gives one. */
  distNm: number | null
}

export interface Procedure {
  /** "DODSO1A". */
  name: string
  runway: string
  waypoints: Waypoint[]
  totalNm: number | null
}

export interface NavPoint {
  /** "TOMAN"; a FIR boundary is "-WIIF"; "TOC" / "TOD". */
  name: string
  /** A FIR boundary's FIR, where the point is one ("WIIF"). */
  fir: string | null
  lat: number
  lon: number
  /** Elapsed from take-off, minutes. */
  elapsedMin: number
  /** "290", "CLB", "DSC", or "" at the end. */
  level: string
  msaFt: number | null
  legNm: number | null
  /** Wind as the OFP writes it ("09014" — 090° 14kt), or "". */
  wind: string
  /** ISA deviation, °C. */
  isaDev: number | null
  groundSpeedKt: number | null
  /** Distance still to fly, nm. */
  toGoNm: number | null
  /** Planned fuel remaining, kg. */
  fuelRemainingKg: number | null
}

export interface WindsAloft {
  /** Per waypoint: each flight level with its wind and OAT. */
  rows: { name: string; levels: { fl: number; wind: string; oat: number }[]; tropopause: number | null }[]
  /** The tropopause, FL, the forecast gives. */
  tropopause: number | null
  /** The forecast OAT at the cruise level, °C — averaged over the cruise waypoints. */
  cruiseOat: number | null
}

export interface OptiClimb {
  plannedTowKg: number | null
  maxTowKg: number | null
  topFl: number | null
  /** "IAS 244 to FL154", then "279 to FL290". */
  steps: { ias: number; fl: number }[]
}

export type StationRole = "departure" | "destination" | "alternate" | "enroute"

export interface StationReport {
  icao: string
  iata: string
  name: string
  role: StationRole
  /** The METAR as printed, without its "SA" tag; "" when the list gives none. */
  metar: string
  taf: string
}

export interface NotamBulletin {
  /** The bulletin's own window, UTC ms ("ETD+TRIP+ALTN+3HRS"). */
  validFromMs: number | null
  validToMs: number | null
  items: Notam[]
}

export interface Notam {
  /** Who it is FOR, whatever NOTAM number it is issued under: location + its text (`notamKey`). */
  key: string
  /** "1A3541/26", "SX171/26". */
  id: string
  /** "WSSS", "WMFC", "D8/CHINA SEA NORTH RANGE". */
  location: string
  locationName: string
  /** The bulletin's section: "Departure Airport", "Destination Alternate(s)", … */
  section: string
  /** "RUNWAY", "AIRPORT", "APPROACH PROCEDURE" — "" for an area. */
  category: string
  fromMs: number | null
  /** null with `permanent` or `ufn`. */
  toMs: number | null
  toText: string
  /** The first line when it is only times ("NOV 21-30 0030-0130 …"). */
  schedule: string
  /** "SFC – FL400", from F) and G). */
  limits: string
  text: string
  /** The bulletin marked it a duplicate of the one above. */
  duplicate: boolean
}

export interface Intam {
  /** "26063". */
  id: string
  title: string
  body: string
  auth: string
}
