"use client"

/**
 * The flight form's BRIEFING section: the way to a flight's briefing from the
 * flight itself. The briefing is found by its derived id (flight digits, UTC
 * date, departure — `briefingId`), so nothing links the two records; a PDF
 * imported anywhere shows up here. With none, the row imports one.
 */

import * as React from "react"
import { useRouter } from "next/navigation"
import { ChevronRight, FileText, FileUp } from "lucide-react"
import { briefingId } from "@/lib/briefing/ids"
import { groupNotams, notamCounts } from "@/lib/briefing/notams"
import { importBriefingFile } from "@/lib/briefing/import"
import { refreshBriefingCaches, useBriefing, useNotamRegister } from "@/hooks/data/use-briefings"
import { showToast } from "@/lib/utils/undo-toast"
import { appAlert } from "@/lib/utils/app-alert"
import { cn } from "@/lib/utils"

export function FlightBriefingRow({ flightNumber, date, dep }: { flightNumber: string; date: string; dep: string }) {
  const router = useRouter()
  const id = flightNumber && date && dep ? briefingId(flightNumber, date, dep) : null
  const { briefing } = useBriefing(id)
  const register = useNotamRegister()
  const input = React.useRef<HTMLInputElement>(null)
  const [busy, setBusy] = React.useState(false)

  const counts = React.useMemo(
    () => (briefing?.data ? notamCounts(groupNotams(briefing.data.notams.items, register, briefing.id)) : null),
    [briefing, register],
  )

  const open = (to: string) => router.push(`/briefing?id=${encodeURIComponent(to)}`)

  const onFile = async (file: File | undefined) => {
    if (!file) return
    setBusy(true)
    try {
      const r = await importBriefingFile(file)
      await refreshBriefingCaches()
      showToast(`${r.record.flightNumber} ${r.record.dep}–${r.record.arr} briefing saved · ${r.notams} NOTAMs, ${r.newNotams} new`)
      open(r.record.id)
    } catch (e) {
      void appAlert({ title: "Not a Briefing", message: e instanceof Error ? e.message : "This PDF could not be read as a briefing package." })
    } finally {
      setBusy(false)
    }
  }

  if (!id) return null
  return (
    <div className="rounded-xl bg-card border border-border overflow-hidden">
      <div className="px-4 py-2 bg-muted/30">
        <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Briefing</h2>
      </div>
      <input
        ref={input}
        type="file"
        accept="application/pdf,.pdf"
        className="hidden"
        onChange={(e) => {
          void onFile(e.target.files?.[0])
          e.target.value = ""
        }}
      />
      {briefing ? (
        <button type="button" onClick={() => open(briefing.id)} className="flex min-h-12 w-full items-center gap-3 px-4 py-3 text-left">
          <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[15px] text-foreground">
              OFP {briefing.ofpVersion} · {briefing.registration}
            </span>
            {counts && (
              <span className="block truncate text-[12px] tabular-nums text-muted-foreground">
                {counts.total} NOTAMs ·{" "}
                <span className={cn(counts.flagged > 0 && "text-status-warning")}>{counts.flagged} flagged</span> ·{" "}
                <span className={cn(counts.new > 0 && "text-primary")}>{counts.new} new</span>
              </span>
            )}
          </span>
          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
        </button>
      ) : (
        <button
          type="button"
          disabled={busy}
          onClick={() => input.current?.click()}
          className="flex min-h-12 w-full items-center gap-3 px-4 py-3 text-left text-[15px] text-primary disabled:opacity-60"
        >
          <FileUp className="h-4 w-4 shrink-0" />
          {busy ? "Reading the PDF…" : "Import Briefing PDF"}
        </button>
      )}
    </div>
  )
}
