"use client"

import { useCallback, useState, type Dispatch, type SetStateAction } from "react"

/**
 * A drop-in replacement for useState that persists its value to sessionStorage,
 * so navigational UI state (list filters, active tab, view mode, selected date)
 * survives navigating away and back to a page — without keeping the page mounted.
 *
 * Because it uses sessionStorage, the value resets when the PWA/tab is closed,
 * matching the app-wide "remember where I left off, but not across sessions" rule.
 *
 * Only persist ephemeral *UI* state with this — never data. Data stays fresh via
 * the SWR + Dexie + sync layer; persisting it here would risk showing stale data.
 *
 * @param key A stable, app-unique key (e.g. "currencies:filter").
 * @param initial The default value when nothing is stored yet.
 */
export function useSessionState<T>(
  key: string,
  initial: T
): [T, Dispatch<SetStateAction<T>>] {
  const [state, setState] = useState<T>(() => {
    if (typeof window === "undefined") return initial
    try {
      const raw = sessionStorage.getItem(key)
      return raw !== null ? (JSON.parse(raw) as T) : initial
    } catch {
      return initial
    }
  })

  const set = useCallback<Dispatch<SetStateAction<T>>>(
    (value) => {
      setState((prev) => {
        const next =
          typeof value === "function"
            ? (value as (p: T) => T)(prev)
            : value
        try {
          sessionStorage.setItem(key, JSON.stringify(next))
        } catch {
          // Ignore storage errors (quota, private mode, etc.)
        }
        return next
      })
    },
    [key]
  )

  return [state, set]
}
