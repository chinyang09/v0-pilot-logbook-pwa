"use client"

import { useState, useEffect, useMemo, memo } from "react"
import { PickerSheet } from "./picker-sheet"
import { useAircraft } from "@/hooks/data"
import { getRecentlyUsedAircraft, addRecentlyUsedAircraft } from "@/lib/db"
import type { Aircraft } from "@/lib/db"

interface AircraftPickerProps {
  open: boolean
  onClose: () => void
  onSelect: (registration: string, type: string) => void
}

export function AircraftPicker({ open, onClose, onSelect }: AircraftPickerProps) {
  const [search, setSearch] = useState("")
  const { aircraft, isLoading } = useAircraft()
  const [recentRegs, setRecentRegs] = useState<string[]>([])

  useEffect(() => {
    if (open) {
      setSearch("")
      getRecentlyUsedAircraft().then(setRecentRegs)
    }
  }, [open])

  const recentAircraft = useMemo(() => {
    if (!recentRegs.length || !aircraft.length) return []
    return recentRegs
      .map(reg => aircraft.find(a => a.registration === reg))
      .filter((a): a is Aircraft => !!a)
  }, [recentRegs, aircraft])

  const filteredAircraft = useMemo(() => {
    const list = search.trim()
      ? aircraft.filter(a => {
          const q = search.toLowerCase()
          return (
            a.registration?.toLowerCase().includes(q) ||
            a.type?.toLowerCase().includes(q) ||
            a.typeDesignator?.toLowerCase().includes(q) ||
            a.model?.toLowerCase().includes(q)
          )
        })
      : aircraft
    return list
  }, [search, aircraft])

  const handleSelect = async (reg: string, type: string) => {
    await addRecentlyUsedAircraft(reg)
    onSelect(reg, type)
    onClose()
  }

  // Show recently used when no search, otherwise show filtered results
  const showRecent = !search && recentAircraft.length > 0

  return (
    <PickerSheet
      open={open}
      onClose={onClose}
      title="Select Aircraft"
      searchPlaceholder="Search registration or type..."
      searchValue={search}
      onSearchChange={setSearch}
    >
      <div className="px-4 pb-6">
        {/* Loading */}
        {isLoading && (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin h-6 w-6 border-2 border-primary border-t-transparent rounded-full" />
          </div>
        )}

        {/* Recently Used */}
        {showRecent && !isLoading && (
          <div className="mb-4">
            <p className="text-[11px] font-medium text-muted-foreground/50 uppercase tracking-wider mb-1.5 px-1">
              Recently Used
            </p>
            <div className="rounded-xl bg-card/50 border border-border/50 overflow-hidden divide-y divide-border/30">
              {recentAircraft.map(ac => (
                <AircraftRow key={ac.registration} aircraft={ac} onSelect={handleSelect} />
              ))}
            </div>
          </div>
        )}

        {/* All / Filtered */}
        {!isLoading && (
          <div>
            {(search || !showRecent) && (
              <p className="text-[11px] font-medium text-muted-foreground/50 uppercase tracking-wider mb-1.5 px-1">
                {search ? "Results" : "All Aircraft"}
              </p>
            )}
            {showRecent && !search && (
              <p className="text-[11px] font-medium text-muted-foreground/50 uppercase tracking-wider mb-1.5 px-1">
                All Aircraft
              </p>
            )}
            {filteredAircraft.length > 0 ? (
              <div className="rounded-xl bg-card/50 border border-border/50 overflow-hidden divide-y divide-border/30">
                {filteredAircraft.map(ac => (
                  <AircraftRow
                    key={ac.id}
                    aircraft={ac}
                    onSelect={handleSelect}
                  />
                ))}
              </div>
            ) : (
              <p className="text-center text-muted-foreground/60 text-sm py-12">
                {search ? "No aircraft found" : "No aircraft registered"}
              </p>
            )}
          </div>
        )}
      </div>
    </PickerSheet>
  )
}

const AircraftRow = memo(function AircraftRow({
  aircraft,
  onSelect,
}: {
  aircraft: Aircraft
  onSelect: (reg: string, type: string) => void
}) {
  return (
    <button
      onClick={() => onSelect(aircraft.registration, aircraft.typeDesignator || aircraft.type || "")}
      className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-muted/30 active:bg-muted/50 transition-colors text-left"
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold text-primary">{aircraft.registration}</span>
          {aircraft.typeDesignator && (
            <span className="text-[11px] px-1.5 py-0.5 rounded bg-primary/10 text-primary font-medium">
              {aircraft.typeDesignator}
            </span>
          )}
        </div>
        {(aircraft.type || aircraft.model) && (
          <p className="text-xs text-muted-foreground/50 truncate">
            {aircraft.model || aircraft.type}
          </p>
        )}
      </div>
    </button>
  )
})
