"use client"

/**
 * A flight's briefing (`/briefing?id=brief:438:2026-11-22:WSSS`) — opened from
 * the flight's own form, or straight after its PDF is imported. The page is
 * the briefing's, so it takes both panels' width on a tablet, as FDP does.
 */

import { Suspense, useMemo, useRef, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { ChevronLeft, FileText, FileUp } from "lucide-react"
import { PageContainer } from "@/components/page-container"
import { GlassIconButton } from "@/components/ui/glass-icon-button"
import { useRegisterMainActions } from "@/hooks/use-page-actions"
import { useMainPanelFullWidth } from "@/lib/layout/panel-mode"
import { PageLoading } from "@/components/ui/page-loading"
import { EmptyState } from "@/components/ui/empty-state"
import { BriefingView } from "@/components/briefing/briefing-view"
import { refreshBriefingCaches, useBriefing } from "@/hooks/data/use-briefings"
import { importBriefingFile } from "@/lib/briefing/import"
import { showToast } from "@/lib/utils/undo-toast"
import { appAlert } from "@/lib/utils/app-alert"

function BriefingPage() {
  const router = useRouter()
  const params = useSearchParams()
  const id = params.get("id")
  const { briefing, isLoading } = useBriefing(id)
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  useMainPanelFullWidth(true)

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

  const actions = useMemo(
    () => (
      <>
        <GlassIconButton ariaLabel="Back" onClick={() => router.back()}>
          <ChevronLeft />
        </GlassIconButton>
        <GlassIconButton ariaLabel="Import a newer briefing PDF" disabled={busy} onClick={() => input.current?.click()}>
          <FileUp />
        </GlassIconButton>
      </>
    ),
    [router, busy],
  )
  useRegisterMainActions(actions, true)

  const b = briefing?.data
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
        <BriefingView record={briefing} />
      ) : (
        <EmptyState icon={FileText} title="No Briefing" description="Import the company's briefing PDF for this flight — from the flight, or with the button above." />
      )}
    </PageContainer>
  )
}

export default function Page() {
  return (
    <Suspense fallback={<PageLoading />}>
      <BriefingPage />
    </Suspense>
  )
}
