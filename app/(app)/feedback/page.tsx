"use client"

/**
 * Feedback — a bug, a new feature or a tweak, written on the go.
 *
 * Main / detail like every other page: the list of what has been sent (and
 * what is still waiting to send) on the left, a report in the detail panel.
 * The + opens a new one there. A report remembers the page the pilot was on
 * before they came here, the build and the device, so it can be reproduced
 * without asking; written offline it waits in an outbox (`lib/feedback/client`)
 * and goes once the app is online. Reports land in MongoDB (`feedback`), where
 * they are read and worked through.
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react"
import { Bug, Lightbulb, MessageSquarePlus, Plus, SlidersHorizontal, CloudOff } from "lucide-react"
import { PageContainer } from "@/components/page-container"
import { GlassIconButton } from "@/components/ui/glass-icon-button"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { Skeleton } from "@/components/ui/skeleton"
import { FormSection } from "@/components/ui/form-section"
import { DetailFormPanel, ReadingPanel } from "@/components/ui/detail-form-panel"
import { ReadOnlyRow, SelectRow, SettingsRow } from "@/components/ui/settings-row"
import { PanelLoading } from "@/components/ui/page-loading"
import { useAuth } from "@/components/providers/auth-provider"
import { useRegisterMainActions } from "@/hooks/use-page-actions"
import { useDetailPanel } from "@/hooks/use-detail-panel"
import { useIsDesktop } from "@/hooks/use-is-desktop"
import { showToast } from "@/lib/utils/undo-toast"
import { formatStamp } from "@/lib/utils/date"
import { cn } from "@/lib/utils"
import {
  captureContext,
  fetchFeedback,
  flushOutbox,
  newFeedbackId,
  readOutbox,
  submitFeedback,
  subscribeOutbox,
} from "@/lib/feedback/client"
import {
  FEEDBACK_AREAS,
  FEEDBACK_KIND_LABEL,
  FEEDBACK_KINDS,
  FEEDBACK_LIMITS,
  FEEDBACK_STATUS_LABEL,
  feedbackProblem,
  type FeedbackArea,
  type FeedbackDraft,
  type FeedbackItem,
  type FeedbackKind,
} from "@/lib/feedback/types"

const NEW_SENTINEL = "__new__"

const KIND_ICON: Record<FeedbackKind, typeof Bug> = {
  bug: Bug,
  feature: Lightbulb,
  tweak: SlidersHorizontal,
}

/** The area a route is most likely about. */
function areaOf(route: string): FeedbackArea {
  const first = route.split("/")[1] ?? ""
  const byPath: Record<string, FeedbackArea> = {
    "": "Dashboard",
    logbook: "Logbook",
    flights: "Flight Form",
    aircraft: "Aircraft",
    airports: "Airports",
    crew: "Crew",
    currencies: "Currencies",
    fdp: "FDP",
    discrepancies: "Discrepancies",
    settings: "Settings",
    account: "Account",
  }
  return byPath[first] ?? "Other"
}

// The outbox, read as a store so the list follows a send from anywhere.
const NO_DRAFTS: FeedbackDraft[] = []
let outboxCache: { userId: string; raw: string; items: FeedbackDraft[] } | null = null
function outboxSnapshot(userId: string | null): FeedbackDraft[] {
  if (!userId) return NO_DRAFTS
  const items = readOutbox(userId)
  const raw = JSON.stringify(items.map((d) => d.id))
  if (outboxCache?.userId === userId && outboxCache.raw === raw) return outboxCache.items
  outboxCache = { userId, raw, items: items.length ? items : NO_DRAFTS }
  return outboxCache.items
}

export default function FeedbackPage() {
  const userId = useAuth().user?.userId ?? null
  const { selectedId, setSelectedId, setDetailContent } = useDetailPanel()
  const isDesktop = useIsDesktop()

  const [items, setItems] = useState<FeedbackItem[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const waiting = useSyncExternalStore(
    subscribeOutbox,
    () => outboxSnapshot(userId),
    () => NO_DRAFTS,
  )

  const load = useCallback(async () => {
    try {
      const next = await fetchFeedback()
      setItems(next)
      setLoadError(null)
    } catch {
      setLoadError(navigator.onLine ? "Couldn't load your reports. Try again later." : "Offline — your reports show once you are online.")
      setItems((prev) => prev ?? [])
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      if (userId && navigator.onLine) await flushOutbox(userId)
      if (!cancelled) await load()
    })()
    return () => {
      cancelled = true
    }
  }, [userId, load])

  const selected = useMemo(
    () => items?.find((i) => i.id === selectedId) ?? waiting.find((d) => d.id === selectedId) ?? null,
    [items, waiting, selectedId],
  )

  const creatingRef = useRef<false | { sel: string | null }>(false)

  const syncDetailPanel = useCallback(() => {
    if (creatingRef.current) {
      if (selectedId === NEW_SENTINEL || selectedId === creatingRef.current.sel) return
      creatingRef.current = false
    }
    if (items === null) {
      setDetailContent(<PanelLoading />)
      return
    }
    setDetailContent(selected ? <FeedbackDetail key={selected.id} report={selected} /> : null)
  }, [selectedId, selected, items, setDetailContent])

  useEffect(() => {
    syncDetailPanel()
  }, [syncDetailPanel])

  const openNew = useCallback(() => {
    if (!userId) return
    creatingRef.current = { sel: selectedId }
    const close = () => {
      creatingRef.current = false
      if (isDesktop) syncDetailPanel()
      else setSelectedId(null)
    }
    setDetailContent(
      <NewFeedbackPanel
        key={`new-${Date.now()}`}
        userId={userId}
        onCancel={close}
        onSent={async (id, outcome) => {
          creatingRef.current = false
          if (outcome === "sent") await load()
          // A phone goes back to the list, where the report now leads; a
          // tablet shows it beside the list. A dialog to acknowledge here put
          // its own history entry over the overlay's, and Back then landed on
          // an empty "Select …" pane before it reached the list.
          if (isDesktop) setSelectedId(id)
          else setSelectedId(null)
          showToast(outcome === "sent" ? "Report sent" : "Saved · sends once you're online")
        }}
      />,
    )
    if (!isDesktop) setSelectedId(NEW_SENTINEL)
  }, [userId, selectedId, isDesktop, setDetailContent, setSelectedId, syncDetailPanel, load])

  const actions = useMemo(
    () => (
      <GlassIconButton ariaLabel="New report" onClick={openNew}>
        <Plus className="h-5 w-5" />
      </GlassIconButton>
    ),
    [openNew],
  )
  useRegisterMainActions(actions, true)

  const open = useCallback((id: string) => setSelectedId(id), [setSelectedId])
  const sent = items ?? []

  return (
    <PageContainer title="Feedback">
      <div className="px-panel pt-4 space-y-4">
        {items === null && <Skeleton className="h-40 w-full rounded-xl" />}

        {loadError && <p className="px-1 text-sm text-muted-foreground">{loadError}</p>}

        {items !== null && sent.length === 0 && waiting.length === 0 && !loadError && (
          <EmptyState
            icon={MessageSquarePlus}
            title="Nothing Reported Yet"
            description="Found a bug, or want something changed? Write it down here, on the go."
            action={
              <Button variant="outline" size="sm" onClick={openNew}>
                <Plus className="h-4 w-4" />
                New Report
              </Button>
            }
          />
        )}

        {waiting.length > 0 && (
          <FormSection title={`Waiting to Send · ${waiting.length}`}>
            {waiting.map((d) => (
              <FeedbackRow key={d.id} report={d} waiting selected={isDesktop && d.id === selectedId} onOpen={open} />
            ))}
          </FormSection>
        )}

        {sent.length > 0 && (
          <FormSection title={`Sent · ${sent.length}`}>
            {sent.map((d) => (
              <FeedbackRow key={d.id} report={d} selected={isDesktop && d.id === selectedId} onOpen={open} />
            ))}
          </FormSection>
        )}
      </div>
    </PageContainer>
  )
}

const FeedbackRow = memo(function FeedbackRow({
  report,
  waiting = false,
  selected,
  onOpen,
}: {
  report: FeedbackDraft | FeedbackItem
  waiting?: boolean
  selected: boolean
  onOpen: (id: string) => void
}) {
  const Icon = KIND_ICON[report.kind] ?? Bug
  const status = "status" in report ? FEEDBACK_STATUS_LABEL[report.status] : "Not sent yet"
  return (
    <button
      type="button"
      onClick={() => onOpen(report.id)}
      className={cn(
        "row-divider relative flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors",
        selected && "bg-primary/10",
      )}
    >
      <Icon className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-medium leading-snug text-foreground">{report.title}</span>
        <span className="block truncate text-xs text-muted-foreground">
          {FEEDBACK_KIND_LABEL[report.kind]} · {report.area} · {formatStamp(report.writtenAt)}
        </span>
      </span>
      <span
        className={cn(
          "shrink-0 text-xs",
          waiting ? "inline-flex items-center gap-1 text-status-warning" : "text-muted-foreground",
        )}
      >
        {waiting && <CloudOff className="h-3.5 w-3.5" aria-hidden />}
        {status}
      </span>
    </button>
  )
})

function FeedbackDetail({ report }: { report: FeedbackDraft | FeedbackItem }) {
  const status = "status" in report ? FEEDBACK_STATUS_LABEL[report.status] : "Waiting to send"
  return (
    <ReadingPanel title={report.title} description={`${FEEDBACK_KIND_LABEL[report.kind]} · ${report.area}`}>
      <FormSection title="Report">
        <ReadOnlyRow label="Status" value={status} />
        <ReadOnlyRow label="Written" value={formatStamp(report.writtenAt)} />
      </FormSection>
      {report.details && (
        <FormSection title="Details">
          <p className="whitespace-pre-wrap break-words px-4 py-3.5 text-[15px] text-foreground">{report.details}</p>
        </FormSection>
      )}
      {"response" in report && report.response && (
        <FormSection title="Reply">
          <p className="whitespace-pre-wrap break-words px-4 py-3.5 text-[15px] text-foreground">{report.response}</p>
        </FormSection>
      )}
      <FormSection title="Captured">
        <ReadOnlyRow label="Page" value={report.context.route} />
        <ReadOnlyRow label="Build" value={report.context.build} />
        <ReadOnlyRow label="Screen" value={report.context.viewport} />
        <ReadOnlyRow label="Installed App" value={report.context.standalone ? "Yes" : "No"} />
      </FormSection>
    </ReadingPanel>
  )
}

function NewFeedbackPanel({
  userId,
  onCancel,
  onSent,
}: {
  userId: string
  onCancel: () => void
  onSent: (id: string, outcome: "sent" | "queued") => void | Promise<void>
}) {
  // Taken once, when the form opens: the page the pilot came from.
  const [context] = useState(captureContext)
  const [kind, setKind] = useState<FeedbackKind>("bug")
  const [area, setArea] = useState<FeedbackArea>(() => areaOf(context.route))
  const [title, setTitle] = useState("")
  const [details, setDetails] = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const problem = feedbackProblem({ kind, area, title, details })

  const send = async () => {
    if (problem || saving) return
    setSaving(true)
    setError(null)
    const draft: FeedbackDraft = {
      id: newFeedbackId(),
      kind,
      area,
      title: title.trim(),
      details: details.trim(),
      context,
      writtenAt: Date.now(),
    }
    const outcome = await submitFeedback(userId, draft)
    setSaving(false)
    if (outcome === "rejected") {
      setError("The report could not be accepted. Check the title and details.")
      return
    }
    await onSent(draft.id, outcome)
  }

  return (
    <DetailFormPanel
      title="New Report"
      description="A bug, a new feature or a tweak."
      dirty
      canSave={!problem}
      saving={saving}
      status={problem}
      error={error}
      onSave={() => void send()}
      onCancel={onCancel}
      saveLabel="Send"
    >
      <FormSection title="Report">
        <SelectRow
          label="Type"
          value={kind}
          onValueChange={setKind}
          options={FEEDBACK_KINDS.map((k) => ({ value: k, label: FEEDBACK_KIND_LABEL[k] }))}
        />
        <SelectRow
          label="Area"
          value={area}
          onValueChange={setArea}
          options={FEEDBACK_AREAS.map((a) => ({ value: a, label: a }))}
        />
        <SettingsRow
          label="Title"
          value={title}
          onChange={setTitle}
          placeholder="In a few words"
          required
          maxLength={FEEDBACK_LIMITS.title}
        />
      </FormSection>

      <FormSection title="Details">
        <DetailsField value={details} onChange={setDetails} />
      </FormSection>

      <FormSection title="Captured With It">
        <ReadOnlyRow label="Page" value={context.route} />
        <ReadOnlyRow label="Screen" value={context.viewport} />
        <ReadOnlyRow label="Build" value={context.build} />
      </FormSection>
    </DetailFormPanel>
  )
}

/**
 * What happened, what was expected — multi-line, growing with what is
 * written, sized by a hidden copy in the same grid cell (the flight form's
 * remarks rule: no `scrollHeight` read per key).
 */
function DetailsField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const text = "block w-full text-base leading-snug [grid-area:1/1] whitespace-pre-wrap break-words"
  return (
    <div className="grid px-4 py-3.5">
      <div aria-hidden className={cn(text, "invisible min-h-[5lh]")}>
        {value + " "}
      </div>
      <textarea
        aria-label="Details"
        placeholder="What happened, and what you expected — or what you'd like instead."
        rows={5}
        maxLength={FEEDBACK_LIMITS.details}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={cn(
          text,
          "h-full resize-none overflow-hidden bg-transparent text-foreground outline-none placeholder:text-muted-foreground",
        )}
      />
    </div>
  )
}
