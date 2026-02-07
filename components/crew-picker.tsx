"use client"

import { useState, useMemo, memo, useEffect } from "react"
import { PickerSheet } from "./picker-sheet"
import { usePersonnel } from "@/hooks/data"
import type { Personnel } from "@/lib/db"

interface CrewPickerProps {
  open: boolean
  onClose: () => void
  onSelect: (crewId: string, crewName: string) => void
}

export function CrewPicker({ open, onClose, onSelect }: CrewPickerProps) {
  const [search, setSearch] = useState("")
  const { personnel, isLoading } = usePersonnel()

  useEffect(() => {
    if (open) setSearch("")
  }, [open])

  const sorted = useMemo(() => {
    return [...personnel].sort((a, b) => {
      if (a.isMe && !b.isMe) return -1
      if (!a.isMe && b.isMe) return 1
      if (a.favorite && !b.favorite) return -1
      if (!a.favorite && b.favorite) return 1
      return (a.name || "").localeCompare(b.name || "")
    })
  }, [personnel])

  const filtered = useMemo(() => {
    if (!search.trim()) return sorted
    const q = search.toLowerCase()
    return sorted.filter(p =>
      p.name?.toLowerCase().includes(q) ||
      p.organization?.toLowerCase().includes(q) ||
      p.crewId?.toLowerCase().includes(q)
    )
  }, [search, sorted])

  const handleSelect = (crew: Personnel) => {
    onSelect(crew.id, crew.isMe ? "Self" : crew.name)
    onClose()
  }

  return (
    <PickerSheet
      open={open}
      onClose={onClose}
      title="Select Crew"
      searchPlaceholder="Search by name..."
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

        {/* Crew List */}
        {!isLoading && (
          <>
            {filtered.length > 0 ? (
              <div className="rounded-xl bg-card/50 border border-border/50 overflow-hidden divide-y divide-border/30">
                {filtered.map(crew => (
                  <CrewRow key={crew.id} crew={crew} onSelect={handleSelect} />
                ))}
              </div>
            ) : (
              <p className="text-center text-muted-foreground/60 text-sm py-12">
                {search ? "No crew found" : "No crew members added"}
              </p>
            )}
          </>
        )}
      </div>
    </PickerSheet>
  )
}

const CrewRow = memo(function CrewRow({
  crew,
  onSelect,
}: {
  crew: Personnel
  onSelect: (crew: Personnel) => void
}) {
  return (
    <button
      onClick={() => onSelect(crew)}
      className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-muted/30 active:bg-muted/50 transition-colors text-left"
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold">
            {crew.isMe ? "Self" : crew.name}
          </span>
          {crew.isMe && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/15 text-primary font-medium">
              Me
            </span>
          )}
        </div>
        {(crew.organization || crew.crewId || (crew.roles && crew.roles.length > 0)) && (
          <p className="text-xs text-muted-foreground/50 truncate">
            {[crew.organization, crew.crewId, crew.roles?.join(", ")].filter(Boolean).join(" · ")}
          </p>
        )}
      </div>
    </button>
  )
})
