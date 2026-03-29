"use client"

import { useState, useEffect, useCallback } from "react"
import { searchAircraftTypes } from "@/lib/db/stores/reference/aircraft-types.store"
import type { AircraftType } from "@/types/entities/aircraft-type.types"

/**
 * Hook for searching ICAO DOC 8643 aircraft type designators.
 * Used by aircraft detail panels and new-aircraft forms for type code lookup.
 *
 * Returns state + handlers for a searchable type code dropdown.
 */
export function useAircraftTypeSearch() {
  const [typeSearchQuery, setTypeSearchQuery] = useState("")
  const [typeSearchResults, setTypeSearchResults] = useState<AircraftType[]>([])
  const [selectedType, setSelectedType] = useState<AircraftType | null>(null)
  const [showTypeSearch, setShowTypeSearch] = useState(false)

  // Debounced search when query changes
  useEffect(() => {
    if (!typeSearchQuery || typeSearchQuery.length < 1) {
      setTypeSearchResults([])
      return
    }
    const timer = setTimeout(async () => {
      const results = await searchAircraftTypes(typeSearchQuery, 20)
      setTypeSearchResults(results)
    }, 200)
    return () => clearTimeout(timer)
  }, [typeSearchQuery])

  const handleSelectType = useCallback((type: AircraftType) => {
    setSelectedType(type)
    setShowTypeSearch(false)
    setTypeSearchQuery("")
    setTypeSearchResults([])
  }, [])

  const resetTypeSearch = useCallback(() => {
    setSelectedType(null)
    setShowTypeSearch(false)
    setTypeSearchQuery("")
    setTypeSearchResults([])
  }, [])

  return {
    typeSearchQuery,
    setTypeSearchQuery,
    typeSearchResults,
    selectedType,
    setSelectedType,
    showTypeSearch,
    setShowTypeSearch,
    handleSelectType,
    resetTypeSearch,
  }
}
