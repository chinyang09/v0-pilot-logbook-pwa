"use client"

/**
 * Import & Export — the app's way in and out of the pilot's other records, a
 * nav destination of its own (the owner, Nov 2026). ONE drop zone: drop files
 * on it or tap it to choose them; it says what it reads, and the kind is told
 * from the file (`import-flow.tsx`). Export is a card of its own under it.
 * Briefings are reached from the flight they belong to (the logbook card's
 * right swipe, the Flight Deck's flights card), not listed here.
 */

import { useState } from "react"
import { FileUp, Loader2 } from "lucide-react"
import { PageContainer } from "@/components/page-container"
import { FormSection } from "@/components/ui/form-section"
import { useImportPicker } from "@/components/import/unified-import-button"
import { refreshAllData } from "@/hooks/data/use-db"
import { useMainPanelFullWidth } from "@/lib/layout/panel-mode"
import { cn } from "@/lib/utils"

const READS = [
  ["Crew Schedule Report", "PDF or CSV"],
  ["Crew Logbook Report", "PDF or CSV"],
  ["Briefing Package", "PDF"],
  ["LogTen Pro Export", "TXT"],
] as const

export default function ImportPage() {
  useMainPanelFullWidth(true)
  const { open, take, working, element } = useImportPicker({ onComplete: () => void refreshAllData() })
  const [over, setOver] = useState(false)

  return (
    <PageContainer title="Import & Export">
      <div className="mx-auto max-w-2xl space-y-4 px-panel pt-4">
        {element}
        <FormSection title="Import">
          <button
            type="button"
            onClick={open}
            disabled={working}
            onDragOver={(e) => {
              e.preventDefault()
              e.dataTransfer.dropEffect = "copy"
              if (!over) setOver(true)
            }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => {
              e.preventDefault()
              setOver(false)
              if (!working) take(Array.from(e.dataTransfer.files))
            }}
            aria-label="Choose files to import, or drop them here"
            className={cn(
              "m-3 flex w-[calc(100%-1.5rem)] flex-col items-center gap-3 rounded-xl border-2 border-dashed px-4 py-7 text-center transition-colors",
              over ? "border-primary bg-primary/10" : "border-border hover:bg-secondary/40 active:bg-secondary/40",
            )}
          >
            <span className="flex h-11 w-11 items-center justify-center rounded-full bg-secondary">
              {working ? <Loader2 className="h-5 w-5 animate-spin" /> : <FileUp className="h-5 w-5 text-muted-foreground" />}
            </span>
            <span className="text-sm font-semibold">{working ? "Reading…" : over ? "Drop to Import" : "Drop Files or Tap to Choose"}</span>
            <span className="grid w-full max-w-xs grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-left text-xs">
              {READS.map(([label, kind]) => (
                <span key={label} className="contents">
                  <span className="text-foreground">{label}</span>
                  <span className="text-right text-muted-foreground">{kind}</span>
                </span>
              ))}
            </span>
            <span className="text-xs text-muted-foreground">Several at once — a schedule and a logbook report are read together.</span>
          </button>
        </FormSection>

        <FormSection title="Export">
          <p className="px-4 py-3.5 text-sm text-muted-foreground">Exporting the logbook comes in a later build.</p>
        </FormSection>
      </div>
    </PageContainer>
  )
}
