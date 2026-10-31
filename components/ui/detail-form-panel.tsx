"use client"

/**
 * A form that lives in the DETAIL panel — the right-hand pane beside a list on
 * a tablet, the full-screen overlay (with its back button and history entry)
 * on a phone. It is what the crew, aircraft and logbook forms already are; the
 * currency and duty forms used to be full-screen sheets of their own instead,
 * so selecting a currency covered the very list it was chosen from.
 *
 * The panel owns the scroller (chrome spacers, the inset scroll indicator) and
 * puts its Cancel / Save in the DETAIL header, where every other detail form
 * keeps them. Why Save is unavailable is said at the top of the form, the same
 * line the sheets carried beside their buttons.
 */

import { useLayoutEffect, useMemo, useRef, type ReactNode } from "react"
import { Loader2 } from "lucide-react"
import { ScrollIndicator } from "@/components/ui/scroll-indicator"
import { GlassTextButton } from "@/components/ui/glass-icon-button"
import { useRegisterDetailActions } from "@/hooks/use-page-actions"
import { useCollapsingTitle } from "@/hooks/use-collapsing-title"
import { DETAIL_TITLE_KEY } from "@/lib/layout/header-title"

export function DetailFormPanel({
  title,
  dirty,
  canSave,
  saving,
  status,
  error,
  onSave,
  onCancel,
  saveLabel = "Save",
  children,
}: {
  /** What the pane is — "New Currency", "Medical". */
  title: string
  /** Something to save or throw away. A clean form shows no buttons at all. */
  dirty: boolean
  canSave: boolean
  saving: boolean
  /** Why Save is unavailable, in words. */
  status?: string | null
  error?: string | null
  onSave: () => void
  onCancel: () => void
  /** The commit's verb, where "Save" is not it ("Resolve"). */
  saveLabel?: string
  children: ReactNode
}) {
  // The header's buttons are memoised; they call the latest handlers by ref,
  // kept current after each commit (not during render).
  const saveRef = useRef(onSave)
  const cancelRef = useRef(onCancel)
  useLayoutEffect(() => {
    saveRef.current = onSave
    cancelRef.current = onCancel
  })

  const actions = useMemo(
    () =>
      dirty ? (
        <>
          <GlassTextButton onClick={() => cancelRef.current()}>Cancel</GlassTextButton>
          <GlassTextButton primary disabled={!canSave || saving} onClick={() => saveRef.current()}>
            {saving ? <Loader2 className="h-5 w-5 animate-spin" /> : saveLabel}
          </GlassTextButton>
        </>
      ) : null,
    [dirty, canSave, saving, saveLabel]
  )
  useRegisterDetailActions(actions, true)

  // Scrolled under the header, the title rides on it (small, between Back
  // and the commits) — see lib/layout/header-title.ts.
  const { titleRef, spacerRef, onScroll } = useCollapsingTitle(DETAIL_TITLE_KEY, title)

  return (
    <div className="relative flex h-full flex-col">
      <div className="flex-1 overflow-y-auto overflow-x-hidden overscroll-contain scrollbar-hide" onScroll={onScroll}>
        <ScrollIndicator />
        <div ref={spacerRef} className="h-chrome-top" />
        <div className="space-y-4 px-panel pt-4">
          <h2 ref={titleRef} className="px-1 text-xl font-semibold">
            {title}
          </h2>
          {error ? (
            <p className="px-1 text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : (
            dirty &&
            status && (
              <p className="px-1 text-sm text-muted-foreground" role="status">
                {status}
              </p>
            )
          )}
          {children}
        </div>
        <div className="h-chrome-bottom" />
      </div>
    </div>
  )
}
