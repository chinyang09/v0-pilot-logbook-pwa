"use client"

import { useCallback, useMemo, useState } from "react"
import { draftDirty, draftValues } from "@/lib/utils/draft"

/** `lib/utils/draft.ts` as state. `base` must be memoised by the caller. */
export function useDraft<T extends object>(base: T) {
  const [edits, setEdits] = useState<Partial<T>>({})
  const values = useMemo(() => draftValues(base, edits), [base, edits])
  const set = useCallback(<K extends keyof T>(key: K, value: T[K]) => {
    setEdits((prev) => ({ ...prev, [key]: value }))
  }, [])
  const reset = useCallback(() => setEdits({}), [])
  return { values, set, reset, dirty: draftDirty(base, edits) }
}
