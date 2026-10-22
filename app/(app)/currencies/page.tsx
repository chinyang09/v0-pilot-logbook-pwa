"use client"

import { useCallback, useMemo, useState } from "react"
import { PageContainer } from "@/components/page-container"
import { useRegisterMainActions } from "@/hooks/use-page-actions"
import { GlassIconButton } from "@/components/ui/glass-icon-button"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { Skeleton } from "@/components/ui/skeleton"
import { FormSection } from "@/components/ui/form-section"
import { Shield, RefreshCw, Plus } from "lucide-react"
import { useCurrencies } from "@/hooks/data"
import { CurrencyCard, CurrencyFormDialog } from "@/components/roster"
import type { CurrencyWithStatus } from "@/types/entities/roster.types"
import { cn } from "@/lib/utils"
import { deleteCurrency, restoreCurrency } from "@/lib/db"
import { showUndoToast } from "@/lib/utils/undo-toast"

export default function CurrenciesPage() {
  const { currencies, isLoading, refresh } = useCurrencies()
  const [currencyToEdit, setCurrencyToEdit] = useState<CurrencyWithStatus | null>(null)
  const [showAddDialog, setShowAddDialog] = useState(false)

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

  const handleEdit = useCallback((currency: CurrencyWithStatus) => setCurrencyToEdit(currency), [])
  const handleDelete = useCallback(
    async (currency: CurrencyWithStatus) => {
      try {
        await deleteCurrency(currency.id)
        await refresh()
        showUndoToast(`${currency.code || "Currency"} deleted`, async () => {
          await restoreCurrency(currency.id)
          await refresh()
        })
      } catch (error) {
        console.error("Failed to delete currency:", error)
      }
    },
    [refresh]
  )

  // Glass action buttons for the floating header bar
  const currencyActions = useMemo(() => (
    <>
      <GlassIconButton ariaLabel="Refresh currencies" onClick={() => refresh()} disabled={isLoading}>
        <RefreshCw className={cn("h-5 w-5", isLoading && "animate-spin")} />
      </GlassIconButton>
      <GlassIconButton ariaLabel="Add currency" onClick={() => setShowAddDialog(true)}>
        <Plus className="h-5 w-5" />
      </GlassIconButton>
    </>
  ), [refresh, isLoading])

  useRegisterMainActions(currencyActions, true)

  const section = (title: string, rows: CurrencyWithStatus[]) =>
    rows.length > 0 && (
      <FormSection title={`${title} · ${rows.length}`}>
        {rows.map((currency) => (
          <CurrencyCard key={currency.id} currency={currency} onEdit={handleEdit} onDelete={handleDelete} />
        ))}
      </FormSection>
    )

  return (
    <PageContainer>
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
              <Button variant="outline" size="sm" onClick={() => setShowAddDialog(true)}>
                <Plus className="h-4 w-4" />
                Add currency
              </Button>
            }
          />
        )}

        {section("Needs attention", attention)}
        {section("Current", current)}
      </div>

      {/* Add/Edit Dialog */}
      <CurrencyFormDialog
        open={showAddDialog || !!currencyToEdit}
        onOpenChange={(open) => {
          if (!open) {
            setShowAddDialog(false)
            setCurrencyToEdit(null)
          }
        }}
        currency={currencyToEdit}
        onSaved={refresh}
      />
    </PageContainer>
  )
}
