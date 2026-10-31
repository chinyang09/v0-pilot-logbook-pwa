"use client"

import type { AircraftType } from "@/types/entities/aircraft-type.types"
import { formatAircraftType } from "@/lib/utils/aircraft-type-utils"
import { SuggestionList } from "@/components/ui/suggestion-list"

/** The ICAO type matches under a Type Code field, in the app's one suggestion list. */
export function AircraftTypeSuggestions({
  results,
  onSelect,
}: {
  results: AircraftType[]
  onSelect: (type: AircraftType) => void
}) {
  return (
    <SuggestionList
      label="Matching Aircraft Types"
      items={results.map((type) => ({
        key: type.designator,
        title: type.designator,
        badge: type.description,
        meta: [type.wtc && `WTC ${type.wtc}`, type.wtg && `WTG ${type.wtg}`].filter((m): m is string => !!m),
        subtitle: formatAircraftType(type),
      }))}
      onSelect={(designator) => {
        const type = results.find((t) => t.designator === designator)
        if (type) onSelect(type)
      }}
    />
  )
}
