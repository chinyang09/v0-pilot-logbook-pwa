/**
 * What a pilot keeps from the company's briefing packages, synced like every
 * other record (`lib/briefing/`; the owner, Nov 2026: "do away with my notes
 * taking app and prepare with my PWA").
 *
 * | collection | one record per | id (DERIVED, so two devices importing one PDF land on one record) |
 * |---|---|---|
 * | `briefings` | flight — the package as read (`Briefing`) | `brief:<flight digits>:<date>:<dep>` |
 * | `notams` | NOTAM, by what it SAYS where — whatever number it is issued under | `notam:<location>|<text hash>` |
 * | `briefingNotes` | route ("WSSS-WBGG") or airport ("WBGG") — the pilot's own and the community's notes | `note:route:WSSS-WBGG`, `note:airport:WBGG` |
 */

import type { Briefing } from "@/lib/briefing/types"

interface Envelope {
  id: string
  userId?: string
  createdAt: number
  updatedAt?: number
  deletedAt?: number | null
  deviceId?: string
  serverSeq?: number
  syncStatus?: "pending" | "synced" | "error"
}

export interface BriefingRecord extends Envelope {
  /** As the app logs it ("TR438"). */
  flightNumber: string
  /** UTC date of departure. */
  date: string
  dep: string
  arr: string
  registration: string
  aircraftType: string
  ofpVersion: string
  /** When the company generated the package, UTC ms. */
  generatedAt: number | null
  importedAt: number
  fileName: string
  data: Briefing | null
}

export interface NotamRecord extends Envelope {
  key: string
  /** The number it was last seen under ("1A3541/26"). */
  notamId: string
  location: string
  locationName: string
  category: string
  section: string
  fromMs: number | null
  toMs: number | null
  toText: string
  schedule: string
  limits: string
  text: string
  /** The pilot marked it as one that matters — kept through its validity, and through a re-issue that says the same thing. */
  flagged: boolean
  /** The briefing it first came in with — "new" in that briefing, known after. */
  firstBriefingId: string
  firstSeenAt: number
  lastSeenAt: number
}

export interface ProcedureNote {
  /** What the OFP plans, in the pilot's shorthand ("DODSO 02: 1A 20: 1B"). */
  plan: string
  /** What colleagues report on the route ("25: 1A (DCT DUKIP)"). */
  sector: string
}

export interface FrequencyNote {
  fir: string
  wp: string
  freq: string
}

export type ProcedureRow = "taxiOut" | "sid" | "star" | "app" | "taxiIn"

export interface BriefingNoteRecord extends Envelope {
  scope: "route" | "airport"
  /** "WSSS-WBGG" for a route, "WBGG" for an airport. */
  ref: string
  /** A route's TAXI / SID / STAR / APP / TAXI rows. */
  procedures: Partial<Record<ProcedureRow, ProcedureNote>> | null
  /** A route's frequency changes, in the order they come. */
  frequencies: FrequencyNote[]
  /** An airport's company summary (the green box). */
  company: string
  /** An airport's pilot-community notes (the pink box). */
  community: string
  notes: string
}
