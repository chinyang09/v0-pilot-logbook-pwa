"use client"

/**
 * A flight's briefing (`/briefing?id=brief:438:2026-11-22:WSSS`) — opened by
 * swiping the flight's card right in the logbook, or straight after its PDF
 * is imported.
 *
 * Main / detail, as Settings: the main panel lists the briefing's sections in
 * the order the aeroplane is prepared (DIFSRIP — `BRIEFING_SECTIONS`), each
 * with a line of what it holds; a section opens in the detail panel, beside
 * the list on a tablet and over it on a phone. It was one page scrolled
 * top to bottom (the owner, Nov 2026: "scrolling of the briefing should be
 * like the other pages").
 */

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { Building2, ChevronLeft, ChevronRight, CloudSun, FileText, FileUp, MapPinned, ScrollText } from "lucide-react"
import { PageContainer } from "@/components/page-container"
import { GlassIconButton } from "@/components/ui/glass-icon-button"
import { useRegisterMainActions } from "@/hooks/use-page-actions"
import { PageLoading } from "@/components/ui/page-loading"
import { EmptyState } from "@/components/ui/empty-state"
import { Button } from "@/components/ui/button"
import { FormSection } from "@/components/ui/form-section"
import {
  BRIEFING_SECTIONS,
  BriefingSectionPanel,
  concernTone,
  groundTempOf,
  sectionSummary,
  useAlternateConcerns,
  useBriefingWeather,
  type BriefingSectionKey,
} from "@/components/briefing/briefing-view"
import type { Briefing } from "@/lib/briefing/types"
import { refreshBriefingCaches, useBriefing, useNotamRegister } from "@/hooks/data/use-briefings"
import { importBriefingFile } from "@/lib/briefing/import"
import { groupNotams, notamCounts } from "@/lib/briefing/notams"
import { showToast } from "@/lib/utils/undo-toast"
import { appAlert } from "@/lib/utils/app-alert"
import { formatDay } from "@/lib/utils/date"
import { useDetailPanel } from "@/hooks/use-detail-panel"
import { useIsDesktop } from "@/hooks/use-is-desktop"
import { cn } from "@/lib/utils"

const ICONS: Partial<Record<BriefingSectionKey, React.ComponentType<{ className?: string }>>> = {
  notams: ScrollText,
  intams: FileText,
  airports: Building2,
  weather: CloudSun,
}

const isSection = (s: string | null): s is BriefingSectionKey => !!s && BRIEFING_SECTIONS.some((x) => x.key === s)

function BriefingPage() {
  const router = useRouter()
  const params = useSearchParams()
  const id = params.get("id")
  const { briefing, isLoading } = useBriefing(id)
  const register = useNotamRegister()
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const { selectedId, setSelectedId, setDetailContent } = useDetailPanel()
  const isDesktop = useIsDesktop()

  const onFile = async (file: File | undefined) => {
    if (!file) return
    setBusy(true)
    try {
      const { record, notams, newNotams } = await importBriefingFile(file)
      await refreshBriefingCaches()
      showToast(`${record.flightNumber} ${record.dep}–${record.arr} briefing saved · ${notams} NOTAMs, ${newNotams} new`)
      if (record.id !== id) router.replace(`/briefing?id=${encodeURIComponent(record.id)}`, { scroll: false })
    } catch (e) {
      void appAlert({ title: "Not a Briefing", message: e instanceof Error ? e.message : "This PDF could not be read as a briefing package." })
    } finally {
      setBusy(false)
    }
  }

  const pick = useCallback(() => input.current?.click(), [])
  const actions = useMemo(
    () => (
      <>
        <GlassIconButton ariaLabel="Back" onClick={() => router.back()}>
          <ChevronLeft />
        </GlassIconButton>
        <GlassIconButton ariaLabel="Import a briefing PDF" disabled={busy} onClick={pick}>
          <FileUp />
        </GlassIconButton>
      </>
    ),
    [router, busy, pick],
  )
  useRegisterMainActions(actions, true)

  const b = briefing?.data
  const counts = useMemo(() => (b && briefing ? notamCounts(groupNotams(b.notams.items, register, briefing.id)) : undefined), [b, briefing, register])

  // The detail panel follows the selection, as Settings' does.
  useEffect(() => {
    if (!briefing || !b) {
      setDetailContent(null)
      return
    }
    if (isSection(selectedId)) setDetailContent(<BriefingSectionPanel record={briefing} section={selectedId} />)
    // explicit:false — a programmatic default must not open the phone's overlay.
    else if (isDesktop) setSelectedId("init-a", { explicit: false })
    else setDetailContent(null)
  }, [briefing, b, selectedId, isDesktop, setDetailContent, setSelectedId])

  const title = b ? `${b.flight.number} ${b.flight.dep}–${b.flight.arr}` : "Briefing"
  return (
    <PageContainer title={title}>
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
      {isLoading || briefing === undefined ? (
        <PageLoading />
      ) : briefing && b ? (
        <div className="space-y-4 px-panel pt-1">
          <p className="text-[13px] tabular-nums text-muted-foreground">
            {formatDay(b.flight.date)} · {b.route.schedDep}–{b.route.schedArr}Z · {b.flight.registration} {b.flight.aircraftType} · OFP{" "}
            {b.flight.ofpVersion}
          </p>
          <BriefingSectionLists b={b} counts={counts} selected={isDesktop ? selectedId : null} onSelect={(k) => setSelectedId(k)} />
        </div>
      ) : (
        <EmptyState
          icon={MapPinned}
          title="No Briefing Yet"
          description="Import the company's briefing PDF for this flight."
          action={
            <Button onClick={pick} disabled={busy}>
              <FileUp className="h-4 w-4" /> {busy ? "Reading the PDF…" : "Import PDF"}
            </Button>
          }
        />
      )}
    </PageContainer>
  )
}

/**
 * The two lists — what is keyed (DIFSRIP) and what is read — each row a
 * Settings row: a muted glyph, the section, one line of what it holds. The
 * line takes a tone only where something asks for attention: a flagged
 * NOTAM, a new one, an alternate whose TAF brings weather over the flight's
 * time there.
 */
function BriefingSectionLists({
  b,
  counts,
  selected,
  onSelect,
}: {
  b: Briefing
  counts: { flagged: number; new: number } | undefined
  selected: string | null
  onSelect: (key: BriefingSectionKey) => void
}) {
  const wx = useBriefingWeather(b)
  const concerns = useAlternateConcerns(b, wx)
  const ctx = { notams: counts, groundTempC: groundTempOf(b, wx.briefs) }
  const altTone = concernTone(concerns)
  const tone = (key: BriefingSectionKey) => {
    if (key === "notams" && counts) return counts.flagged ? "text-status-warning" : counts.new ? "text-primary" : undefined
    if (key === "sec" && altTone) return altTone === "unsuitable" ? "text-destructive" : "text-status-warning"
    return undefined
  }
  return (
    <>
      <SectionList
        title="Prepare · DIFSRIP"
        keys={BRIEFING_SECTIONS.filter((s) => s.letter).map((s) => s.key)}
        render={(key) => sectionSummary(key, b, ctx)}
        selected={selected}
        onSelect={onSelect}
        tone={tone}
      />
      <SectionList
        title="Brief"
        keys={BRIEFING_SECTIONS.filter((s) => !s.letter).map((s) => s.key)}
        render={(key) => sectionSummary(key, b, ctx)}
        selected={selected}
        onSelect={onSelect}
        tone={tone}
      />
    </>
  )
}

function SectionList({
  title,
  keys,
  render,
  selected,
  onSelect,
  tone,
}: {
  title: string
  keys: BriefingSectionKey[]
  render: (key: BriefingSectionKey) => string
  selected: string | null
  onSelect: (key: BriefingSectionKey) => void
  tone?: (key: BriefingSectionKey) => string | undefined
}) {
  return (
    <FormSection title={title}>
      {keys.map((key) => {
        const def = BRIEFING_SECTIONS.find((s) => s.key === key)!
        const Icon = ICONS[key]
        const active = selected === key
        return (
          <button
            key={key}
            type="button"
            onClick={() => onSelect(key)}
            className={cn(
              "row-divider flex w-full items-center px-4 py-3.5 text-left transition-colors",
              active ? "bg-primary/10 text-primary" : "hover:bg-secondary/50 active:bg-secondary/50",
            )}
          >
            {def.letter ? (
              <span aria-hidden className={cn("mr-3 w-4 shrink-0 text-center text-[13px] font-semibold", active ? "text-primary" : "text-muted-foreground")}>
                {def.letter}
              </span>
            ) : Icon ? (
              <Icon className={cn("mr-3 h-4 w-4 shrink-0", active ? "text-primary" : "text-muted-foreground")} />
            ) : null}
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium">{def.label}</span>
              <span className={cn("block truncate text-xs tabular-nums text-muted-foreground", tone?.(key))}>{render(key)}</span>
            </span>
            <ChevronRight className="ml-2 h-4 w-4 shrink-0 text-muted-foreground" />
          </button>
        )
      })}
    </FormSection>
  )
}

export default function Page() {
  return (
    <Suspense fallback={<PageLoading />}>
      <BriefingPage />
    </Suspense>
  )
}
