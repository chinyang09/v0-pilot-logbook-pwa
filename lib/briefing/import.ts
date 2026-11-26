/**
 * Bringing a briefing PDF in, from wherever it is chosen — the logbook's
 * import button (`import-flow.tsx`, which asks `isBriefingFile` first) or the
 * flight's own Briefing row. Read on the device (`pdfToPages`, offline),
 * parsed (`parseBriefing`), kept (`saveBriefing`), its NOTAMs folded into the
 * register.
 */

import { pdfToPages } from "./pdf-lines"
import { isBriefingPackage, parseBriefing } from "./parse"
import { saveBriefing } from "@/lib/db/stores/user/briefings.store"
import type { BriefingRecord } from "@/types/entities/briefing.types"
import { applyBriefingAircraft } from "./apply-aircraft"

/** Whether a chosen file is a company briefing package — read off its first pages only. */
export async function isBriefingFile(file: File): Promise<boolean> {
  if (!/\.pdf$/i.test(file.name) && file.type !== "application/pdf") return false
  try {
    // The OFP opens on the second page of the packages seen, after "Important
    // files" — a package with more attachments listed pushes it later.
    const head = await pdfToPages(new Uint8Array(await file.arrayBuffer()), 10)
    return isBriefingPackage(head)
  } catch {
    return false
  }
}

export interface BriefingImport {
  record: BriefingRecord
  notams: number
  newNotams: number
  /** How many logbook flights took the OFP's aeroplane (`applyBriefingAircraft`). */
  aircraft: number
}

export async function importBriefingFile(file: File): Promise<BriefingImport> {
  const pages = await pdfToPages(new Uint8Array(await file.arrayBuffer()))
  if (!isBriefingPackage(pages)) throw new Error(`${file.name} isn't a briefing package (no OFP found).`)
  const briefing = parseBriefing(pages)
  if (!briefing.flight.dep || !briefing.flight.date) throw new Error(`${file.name}: the OFP's flight could not be read.`)
  const { record, newNotams } = await saveBriefing(briefing, file.name)
  const aircraft = await applyBriefingAircraft(record).catch((e) => {
    console.warn("[Briefing] aircraft not applied", e)
    return 0
  })
  return { record, notams: briefing.notams.items.length, newNotams, aircraft }
}
