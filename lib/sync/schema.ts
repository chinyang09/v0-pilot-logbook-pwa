/**
 * The canonical SERVER document shape for every synced collection — PURE,
 * shared by the client and the server.
 *
 * Before this, a MongoDB document was whatever JSON a client happened to send:
 * an old row carried the fields that existed when it was written, a new one
 * carried the ones that exist now, `JSON.stringify` dropped every `undefined`
 * on the way, and an update could only ever ADD keys (`$set` of the payload).
 * Two flights in the same collection could differ by thirty keys, and a field a
 * client cleared stayed set on the server forever.
 *
 * Now every document in a collection has EXACTLY the same keys, in the same
 * order:
 *
 *   _id                                            (Mongo)
 *   id, userId, schemaVersion,                     ┐
 *   createdAt, updatedAt, deletedAt,               │ the ENVELOPE — identical
 *   deviceId, serverSeq, syncedAt, fieldVersions   ┘ across all six collections
 *   …every field of the entity, in declared order  the PAYLOAD — per collection
 *
 * A field with no value is stored as its default — `""`, `0`, `[]`, or `null`
 * for anything optional — never absent. `null` is stripped again on the way
 * DOWN (`toWireRecord`), so the client sees exactly the shape it always has.
 *
 * The field tables below are `satisfies`-checked against the entity types:
 * adding a field to `FlightLog` and not here is a compile error, which is what
 * keeps the server shape from drifting behind the app again.
 */

import type { FlightLog } from "@/types/entities/flight.types"
import type { Aircraft } from "@/types/entities/aircraft.types"
import type { Personnel } from "@/types/entities/crew.types"
import type { ScheduleEntry, Currency, Discrepancy } from "@/types/entities/roster.types"
import type { SyncCollection } from "@/types/sync/sync.types"
import { toTimestamp } from "./authorship"

/**
 * Bump when a field table below changes in a way the server must rewrite
 * existing documents for (a new field needs its default written into every
 * document). The server migrates each user's documents lazily up to this
 * version, and a client declares the version it was built with on every push
 * so the server knows whether the payload is COMPLETE (see `writeMode`).
 *
 * 1 is the implicit legacy version: no envelope, no defaults.
 */
export const SYNC_SCHEMA_VERSION = 2

/**
 * Push/pull order: dependency-light collections first, so a flight never
 * arrives referencing an aircraft or crew member the other side hasn't seen.
 */
export const SYNC_COLLECTIONS: readonly SyncCollection[] = [
  "aircraft",
  "personnel",
  "scheduleEntries",
  "currencies",
  "discrepancies",
  "flights",
]

export function isSyncCollection(v: unknown): v is SyncCollection {
  return typeof v === "string" && (SYNC_COLLECTIONS as readonly string[]).includes(v)
}

/** Keys every collection shares. Built by `buildEnvelope`, never by a field table. */
export const ENVELOPE_KEYS = [
  "id",
  "userId",
  "schemaVersion",
  "createdAt",
  "updatedAt",
  "deletedAt",
  "deviceId",
  "serverSeq",
  "syncedAt",
  "fieldVersions",
] as const

/** Device-local bookkeeping — never stored on the server. */
const CLIENT_ONLY_KEYS = ["syncStatus"] as const

/** Server-only bookkeeping — never sent to a client. */
const SERVER_ONLY_KEYS = ["_id", "syncedAt", "schemaVersion", "fieldVersions"] as const

const RESERVED = new Set<string>([...ENVELOPE_KEYS, ...CLIENT_ONLY_KEYS, "_id"])

type EnvelopeKey = (typeof ENVELOPE_KEYS)[number] | (typeof CLIENT_ONLY_KEYS)[number]
type PayloadKeys<T> = Exclude<keyof T, EnvelopeKey>

/**
 * A field's default. A FUNCTION default is computed from the record being
 * built (and returns a fresh value, so an array default is never shared
 * between two documents).
 */
type FieldDefault = string | number | boolean | null | ((src: Record<string, unknown>) => unknown)
type FieldTable<T> = { [K in PayloadKeys<T>]-?: FieldDefault }

const emptyArray = () => []
const emptyObject = () => ({})
const ZERO_TIME = "00:00"

/**
 * Required fields take the default the client's normalizer already fills on
 * pull (so writing it server-side changes nothing a device would read);
 * optional fields take `null`.
 */
const FLIGHT_FIELDS = {
  date: "",
  flightNumber: "",
  aircraftReg: "",
  aircraftType: "",
  departureIcao: "",
  departureIata: "",
  arrivalIcao: "",
  arrivalIata: "",
  departureTimezone: 0,
  arrivalTimezone: 0,
  reportTime: null,
  scheduledOut: "",
  scheduledIn: "",
  outTime: "",
  offTime: "",
  onTime: "",
  inTime: "",
  blockTime: ZERO_TIME,
  flightTime: ZERO_TIME,
  nightTime: ZERO_TIME,
  dayTime: ZERO_TIME,
  picId: "",
  picName: "",
  sicId: "",
  sicName: "",
  additionalCrew: emptyArray,
  pilotFlying: true,
  pilotRole: "PIC",
  picTime: ZERO_TIME,
  sicTime: ZERO_TIME,
  picusTime: ZERO_TIME,
  dualTime: ZERO_TIME,
  instructorTime: ZERO_TIME,
  dayTakeoffs: 0,
  dayLandings: 0,
  nightTakeoffs: 0,
  nightLandings: 0,
  autolands: 0,
  remarks: "",
  endorsements: "",
  manualOverrides: emptyObject,
  ifrTime: ZERO_TIME,
  actualInstrumentTime: ZERO_TIME,
  simulatedInstrumentTime: ZERO_TIME,
  crossCountryTime: ZERO_TIME,
  approaches: emptyArray,
  holds: 0,
  ipcIcc: false,
  isLocked: null,
  signature: null,
  lastSyncedAt: null,
  reportGeneratedAt: null,
  scheduleReportAt: null,
  logbookReportAt: null,
  importSource: null,
  toLdgDecidedAt: null,
  importDecisions: null,
  entryType: null,
  isSimulator: null,
  simSessionCode: null,
} satisfies FieldTable<FlightLog>

const AIRCRAFT_FIELDS = {
  registration: "",
  type: "",
  typeDesignator: "",
  model: "",
  category: "",
  engineType: "SEP",
  isComplex: false,
  isHighPerformance: false,
  serialNumber: null,
  operator: null,
  owner: null,
  year: null,
  notes: null,
} satisfies FieldTable<Aircraft>

const PERSONNEL_FIELDS = {
  name: "",
  crewId: null,
  organization: null,
  roles: emptyArray,
  licenceNumber: null,
  contact: emptyObject,
  comment: null,
  isMe: null,
  favorite: null,
  defaultPIC: null,
  defaultSIC: null,
} satisfies FieldTable<Personnel>

const SCHEDULE_ENTRY_FIELDS = {
  date: "",
  timeReference: null,
  reportTime: null,
  debriefTime: null,
  dutyType: null,
  dutyCode: null,
  dutyDescription: null,
  sectors: emptyArray,
  crew: emptyArray,
  indicators: null,
  memo: null,
  training: null,
  standbyWindow: null,
  linkedFlightIds: null,
  sourceFile: null,
  importedAt: (src) => toTimestamp(src.createdAt) ?? 0,
} satisfies FieldTable<ScheduleEntry>

const CURRENCY_FIELDS = {
  code: "",
  description: "",
  expiryDate: "",
  warningDays: 30,
  criticalDays: 7,
  issuedDate: null,
  issuingAuthority: null,
  documentNumber: null,
  notes: null,
  autoUpdate: true,
  lastUpdatedFrom: null,
} satisfies FieldTable<Currency>

const DISCREPANCY_FIELDS = {
  type: null,
  severity: "info",
  scheduleEntryId: null,
  flightLogId: null,
  field: null,
  scheduleValue: null,
  logbookValue: null,
  message: null,
  holding: null,
  acceptedAt: null,
  resolved: false,
  resolvedAt: null,
  resolvedBy: null,
  resolutionNotes: null,
} satisfies FieldTable<Discrepancy>

export const SYNC_FIELDS: Record<SyncCollection, Record<string, FieldDefault>> = {
  flights: FLIGHT_FIELDS,
  aircraft: AIRCRAFT_FIELDS,
  personnel: PERSONNEL_FIELDS,
  scheduleEntries: SCHEDULE_ENTRY_FIELDS,
  currencies: CURRENCY_FIELDS,
  discrepancies: DISCREPANCY_FIELDS,
}

export interface Envelope {
  id: string
  userId: string
  schemaVersion: number
  createdAt: number
  updatedAt: number
  deletedAt: number | null
  deviceId: string | null
  serverSeq: number
  syncedAt: number
  /**
   * Which write last changed each field — `{ seq, at, by }` per field that has
   * been edited since the record was created. It is what lets the server tell
   * a genuine conflict (the same field edited on two devices) from two edits
   * to different fields, which simply merge. Server-only: never sent down.
   */
  fieldVersions: Record<string, unknown>
}

type Doc = Record<string, unknown>

/**
 * Build the envelope for a document being written.
 *
 * `createdAt` is the EXISTING document's when there is one — a client can't
 * move when a record was created. `updatedAt` is the authoring device's clock,
 * because it is what last-write-wins compares.
 */
export function buildEnvelope(args: {
  id: string
  userId: string
  /** The write's author side: `updatedAt` and `deviceId` come from here. */
  incoming: Doc
  existing?: Doc | null
  /** The record's resulting state, for `deletedAt` (defaults to `incoming`). */
  state?: Doc
  serverSeq: number
  now: number
  fieldVersions?: Record<string, unknown>
}): Envelope {
  const { id, userId, incoming, existing, serverSeq, now } = args
  const state = args.state ?? incoming
  const createdAt =
    toTimestamp(existing?.createdAt) ?? toTimestamp(incoming.createdAt) ?? toTimestamp(incoming.updatedAt) ?? now
  const existingFv = existing?.fieldVersions
  return {
    id,
    userId,
    schemaVersion: SYNC_SCHEMA_VERSION,
    createdAt,
    updatedAt: toTimestamp(incoming.updatedAt) ?? createdAt,
    deletedAt: toTimestamp(state.deletedAt) ?? null,
    deviceId: typeof incoming.deviceId === "string" && incoming.deviceId ? incoming.deviceId : null,
    serverSeq,
    syncedAt: now,
    fieldVersions:
      args.fieldVersions ??
      (existingFv && typeof existingFv === "object" && !Array.isArray(existingFv) ? (existingFv as Record<string, unknown>) : {}),
  }
}

/**
 * Lay a record out in the canonical shape: envelope, then every field of the
 * collection in declared order (missing → its default), then any key the
 * table doesn't know.
 *
 * Unknown keys are KEPT, at the end, rather than dropped: one is either a
 * field a newer build added (which this build must not destroy) or legacy
 * data nobody has looked at yet. Dropping either silently is data loss.
 */
export function canonicalizeDocument(collection: SyncCollection, source: Doc, envelope: Envelope): Doc {
  const out: Doc = { ...envelope }
  for (const [key, def] of Object.entries(SYNC_FIELDS[collection])) {
    const value = source[key]
    out[key] = value !== undefined ? value : typeof def === "function" ? def(source) : def
  }
  for (const [key, value] of Object.entries(source)) {
    if (value === undefined || RESERVED.has(key) || key in out) continue
    out[key] = value
  }
  return out
}

/** The keys of `doc` that the field table does not know (excluding reserved). */
export function extraKeys(collection: SyncCollection, doc: Doc): string[] {
  const fields = SYNC_FIELDS[collection]
  return Object.keys(doc).filter((k) => !RESERVED.has(k) && !(k in fields))
}

/**
 * How an incoming payload is combined with the document already stored.
 *
 * - `replace` — the client sent a COMPLETE entity under the current schema, so
 *   the payload IS the record: a key it omits has been cleared. This is what
 *   finally lets a sync clear a field (`$set` never could).
 * - `merge` — the client is older than the server's schema (or didn't say), so
 *   a key it omits may simply be one it doesn't know about. Keep the stored
 *   value for those; overlay what it sent. That is the old `$set` behaviour,
 *   and the reason an outdated device can't wipe fields a newer one wrote.
 *
 * In both, unknown extra keys on the stored document survive.
 */
export type WriteMode = "replace" | "merge"

export function writeMode(clientSchemaVersion: unknown): WriteMode {
  return typeof clientSchemaVersion === "number" && clientSchemaVersion >= SYNC_SCHEMA_VERSION
    ? "replace"
    : "merge"
}

/** The payload a write is canonicalized FROM, per `writeMode`. */
export function writeSource(collection: SyncCollection, mode: WriteMode, incoming: Doc, existing?: Doc | null): Doc {
  if (!existing) return incoming
  if (mode === "merge") return { ...existing, ...incoming }
  const preserved: Doc = {}
  for (const key of extraKeys(collection, existing)) preserved[key] = existing[key]
  return { ...preserved, ...incoming }
}

/**
 * A stored document as a client receives it: server-only bookkeeping removed,
 * `null` placeholders removed (the client has always represented "no value" as
 * an absent key), and `syncStatus` set.
 *
 * Removing `deletedAt: null` is safe: a pulled record REPLACES the local row
 * whole, so an absent `deletedAt` is a restored record.
 */
export function toWireRecord(doc: Doc): Doc {
  const out: Doc = {}
  for (const [key, value] of Object.entries(doc)) {
    if (value === null || value === undefined) continue
    if ((SERVER_ONLY_KEYS as readonly string[]).includes(key)) continue
    out[key] = value
  }
  out.syncStatus = "synced"
  return out
}

/** Approximate serialized size, for keeping a request/response under a byte budget. */
export function approxBytes(value: unknown): number {
  try {
    return JSON.stringify(value)?.length ?? 0
  } catch {
    return 0
  }
}
