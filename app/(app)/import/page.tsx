"use client"

/**
 * Import & Export — the app's way in and out of the pilot's other records, a
 * nav destination of its own (the owner, Nov 2026: "move imports and exports
 * to a separate nav tab instead of action button"). One picker reads them
 * all — the kind is told from the file (`import-flow.tsx`) — so every row
 * below opens the same picker; the rows say what it reads. The briefings
 * already imported are listed, newest first, so a briefing is a tap away from
 * any page the tab bar reaches (the Flight Deck included).
 */

import { useMemo } from "react"
import { useRouter } from "next/navigation"
import { CalendarRange, ChevronRight, FileSpreadsheet, FileUp, Loader2, NotebookTabs, ScrollText } from "lucide-react"
import { PageContainer } from "@/components/page-container"
import { FormSection } from "@/components/ui/form-section"
import { Button } from "@/components/ui/button"
import { useImportPicker } from "@/components/import/unified-import-button"
import { useAllBriefings } from "@/hooks/data/use-briefings"
import { refreshAllData } from "@/hooks/data/use-db"
import { useMainPanelFullWidth } from "@/lib/layout/panel-mode"
import { formatDay } from "@/lib/utils/date"

const KINDS = [
  { icon: CalendarRange, label: "Crew Schedule Report", detail: "PDF or CSV · flights, duties, crew" },
  { icon: NotebookTabs, label: "Crew Logbook Report", detail: "PDF or CSV · the times flown" },
  { icon: ScrollText, label: "Briefing Package", detail: "PDF · OFP, NOTAMs, INTAMs" },
  { icon: FileSpreadsheet, label: "LogTen Pro Export", detail: "Flights, Aircraft, Address Book (TXT)" },
] as const

export default function ImportPage() {
  const router = useRouter()
  const briefings = useAllBriefings()
  useMainPanelFullWidth(true)
  const { open, working, element } = useImportPicker({ onComplete: () => void refreshAllData() })
  const recent = useMemo(
    () =>
      (briefings ?? [])
        .filter((r) => r.data)
        .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? "") || (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
        .slice(0, 12),
    [briefings],
  )
  return (
    <PageContainer title="Import & Export">
      <div className="mx-auto max-w-2xl space-y-4 px-panel pt-4">
        {element}
        <Button className="h-11 w-full" onClick={open} disabled={working}>
          {working ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileUp className="h-4 w-4" />}
          {working ? "Reading…" : "Choose Files"}
        </Button>
        <FormSection title="Reads">
          {KINDS.map(({ icon: Icon, label, detail }) => (
            <button
              key={label}
              type="button"
              onClick={open}
              disabled={working}
              className="row-divider flex w-full items-center px-4 py-3.5 text-left transition-colors hover:bg-secondary/50 active:bg-secondary/50"
            >
              <Icon className="mr-3 h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">{label}</span>
                <span className="block truncate text-xs text-muted-foreground">{detail}</span>
              </span>
              <ChevronRight className="ml-2 h-4 w-4 shrink-0 text-muted-foreground" />
            </button>
          ))}
        </FormSection>

        {recent.length > 0 && (
          <FormSection title="Briefings">
            {recent.map((r) => {
              const b = r.data!
              return (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => router.push(`/briefing?id=${encodeURIComponent(r.id)}`)}
                  className="row-divider flex w-full items-center px-4 py-3 text-left transition-colors hover:bg-secondary/50 active:bg-secondary/50"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium tabular-nums">
                      {b.flight.number} {b.flight.dep}–{b.flight.arr}
                    </span>
                    <span className="block truncate text-xs tabular-nums text-muted-foreground">
                      {formatDay(b.flight.date)} • {b.route.schedDep}Z • OFP {b.flight.ofpVersion}
                    </span>
                  </span>
                  <ChevronRight className="ml-2 h-4 w-4 shrink-0 text-muted-foreground" />
                </button>
              )
            })}
          </FormSection>
        )}

        <FormSection title="Export">
          <p className="px-4 py-3.5 text-sm text-muted-foreground">Exporting the logbook comes in a later build.</p>
        </FormSection>
      </div>
    </PageContainer>
  )
}
