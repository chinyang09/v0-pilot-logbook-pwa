"use client"

import { useCallback, useEffect, useMemo, useRef } from "react"
import { PageContainer } from "@/components/page-container"
import { useRegisterMainActions } from "@/hooks/use-page-actions"
import { GlassIconButton } from "@/components/ui/glass-icon-button"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { Skeleton } from "@/components/ui/skeleton"
import { FormSection } from "@/components/ui/form-section"
import { Shield, Plus } from "lucide-react"
import { useCurrencies } from "@/hooks/data"
import { CurrencyCard, CurrencyDetailPanel } from "@/components/roster"
import { PanelLoading } from "@/components/ui/page-loading"
import { useDetailPanel } from "@/hooks/use-detail-panel"
import { useIsDesktop } from "@/hooks/use-is-desktop"
import type { Currency, CurrencyWithStatus } from "@/types/entities/roster.types"
import { deleteCurrency, restoreCurrency } from "@/lib/db"
import { showUndoToast } from "@/lib/utils/undo-toast"

/** The phone's "a new one is open" selection — never stored (see use-detail-panel). */
const NEW_SENTINEL = "__new__"

export default function CurrenciesPage() {
  const { currencies, isLoading, refresh } = useCurrencies()
  // A currency opens in the DETAIL panel — beside the list on a tablet, the
  // full-screen overlay on a phone — the way a flight or a crew member does.
  const { selectedId, setSelectedId, setDetailContent } = useDetailPanel()
  const isDesktop = useIsDesktop()

  // ONE page, two groups: what needs attention, then what is current — each
  // soonest first. It used to be a card per currency behind All / Valid /
  // Warning / Critical / Expired chips; with a pilot's handful of documents
  // as rows the whole set fits a screen, so there is nothing left to filter
  // and the order itself answers "what runs out next".
  const { attention, current } = useMemo(() => {
    const byExpiry = [...currencies].sort((a, b) => a.expiryDate.localeCompare(b.expiryDate))
    return {
      attention: byExpiry.filter((c) => c.status !== "valid"),
      current: byExpiry.filter((c) => c.status === "valid"),
    }
  }, [currencies])

  const selected = useMemo(
    () => currencies.find((c) => c.id === selectedId) ?? null,
    [currencies, selectedId]
  )

  const handleEdit = useCallback((currency: CurrencyWithStatus) => setSelectedId(currency.id), [setSelectedId])

  const showSaved = useCallback(
    async (saved: Currency) => {
      await refresh()
      setSelectedId(saved.id)
    },
    [refresh, setSelectedId]
  )

  // While a NEW currency's form is open, data-driven re-syncs must not replace
  // it — but the user choosing another row ends it (the crew page's rule).
  const creatingRef = useRef<false | { sel: string | null }>(false)

  const syncDetailPanel = useCallback(() => {
    if (creatingRef.current) {
      if (selectedId === NEW_SENTINEL || selectedId === creatingRef.current.sel) return
      creatingRef.current = false
    }
    if (isLoading && currencies.length === 0) {
      setDetailContent(<PanelLoading />)
      return
    }
    setDetailContent(
      selected ? (
        <CurrencyDetailPanel key={selected.id} currency={selected} onSaved={showSaved} />
      ) : null
    )
  }, [selectedId, selected, isLoading, currencies.length, showSaved, setDetailContent])

  useEffect(() => {
    syncDetailPanel()
  }, [syncDetailPanel])

  const openNew = useCallback(() => {
    creatingRef.current = { sel: selectedId }
    setDetailContent(
      <CurrencyDetailPanel
        key="new"
        currency={null}
        onSaved={async (saved) => {
          creatingRef.current = false
          await showSaved(saved)
        }}
        onCancelNew={() => {
          creatingRef.current = false
          if (isDesktop) syncDetailPanel()
          else setSelectedId(null)
        }}
      />
    )
    // A phone has no panel beside the list: the sentinel opens the overlay.
    if (!isDesktop) setSelectedId(NEW_SENTINEL)
  }, [selectedId, isDesktop, setDetailContent, setSelectedId, showSaved, syncDetailPanel])

  const handleDelete = useCallback(
    async (currency: CurrencyWithStatus) => {
      try {
        await deleteCurrency(currency.id)
        if (currency.id === selectedId) setSelectedId(null)
        await refresh()
        showUndoToast(`${currency.code || "Currency"} deleted`, async () => {
          await restoreCurrency(currency.id)
          await refresh()
        })
      } catch (error) {
        console.error("Failed to delete currency:", error)
      }
    },
    [refresh, selectedId, setSelectedId]
  )

  // CREATE, alone — the only thing this page's header does (see the header
  // rule in glass-icon-button.tsx). There is no Refresh: the list follows
  // every write and every sync on its own.
  const currencyActions = useMemo(
    () => (
      <GlassIconButton ariaLabel="Add currency" onClick={openNew}>
        <Plus className="h-5 w-5" />
      </GlassIconButton>
    ),
    [openNew]
  )

  useRegisterMainActions(currencyActions, true)

  const section = (title: string, rows: CurrencyWithStatus[]) =>
    rows.length > 0 && (
      <FormSection title={`${title} · ${rows.length}`}>
        {rows.map((currency) => (
          <CurrencyCard
            key={currency.id}
            currency={currency}
            // Lit only where the panel beside the list shows it: a phone has no
            // such panel, so a lit row there would point at nothing.
            selected={isDesktop && currency.id === selectedId}
            onEdit={handleEdit}
            onDelete={handleDelete}
          />
        ))}
      </FormSection>
    )

  return (
    <PageContainer title="Currencies">
      <div className="px-panel pt-4 space-y-4">
        {/* First-load skeleton */}
        {isLoading && currencies.length === 0 && (
          <Skeleton className="h-64 w-full rounded-xl" />
        )}

        {/* Empty State */}
        {currencies.length === 0 && !isLoading && (
          <EmptyState
            icon={Shield}
            title="No currencies yet"
            description="Add currencies and expiry dates to track your training, medical, and license renewals."
            action={
              // Outline, like every other empty state's add button.
              <Button variant="outline" size="sm" onClick={openNew}>
                <Plus className="h-4 w-4" />
                Add currency
              </Button>
            }
          />
        )}

        {section("Needs attention", attention)}
        {section("Current", current)}
      </div>

    </PageContainer>
  )
}
