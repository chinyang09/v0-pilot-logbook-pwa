"use client"

import React, { createContext, useContext, useState, useCallback, useEffect, useRef, type ReactNode } from "react"

interface PageActionsContextType {
  /** Action buttons for the main (left) panel — rendered flush-left on desktop */
  mainActions: ReactNode
  /** Action buttons for the detail (right) panel — rendered flush-right on desktop */
  detailActions: ReactNode
  /** Register main panel actions (call from active page) */
  setMainActions: (actions: ReactNode) => void
  /** Register detail panel actions (call from active page) */
  setDetailActions: (actions: ReactNode) => void
}

const PageActionsContext = createContext<PageActionsContextType | null>(null)

export function PageActionsProvider({ children }: { children: ReactNode }) {
  const [mainActions, setMainActions] = useState<ReactNode>(null)
  const [detailActions, setDetailActions] = useState<ReactNode>(null)

  return (
    <PageActionsContext.Provider
      value={{ mainActions, detailActions, setMainActions, setDetailActions }}
    >
      {children}
    </PageActionsContext.Provider>
  )
}

const defaultCtx: PageActionsContextType = {
  mainActions: null,
  detailActions: null,
  setMainActions: () => {},
  setDetailActions: () => {},
}

export function usePageActions() {
  return useContext(PageActionsContext) ?? defaultCtx
}

/**
 * Helper hook for keep-alive pages to register their action buttons.
 *
 * Automatically sets/clears actions based on `isActive` from `usePageActive`.
 * The `actions` callback is called to produce the ReactNode — wrap in useCallback
 * to avoid infinite re-renders.
 */
export function useRegisterMainActions(actions: ReactNode, isActive: boolean) {
  const { setMainActions } = usePageActions()
  const actionsRef = useRef(actions)
  actionsRef.current = actions

  useEffect(() => {
    if (isActive) {
      setMainActions(actionsRef.current)
    }
    // Clears on unmount (non-keepalive) AND on inactive→active transition cleanup (keepalive).
    // This prevents stale actions persisting when lazy-loaded pages race during navigation.
    return () => setMainActions(null)
    // Deliberately excluding `actions` — the ref tracks the latest value without
    // triggering cleanup→re-register cycles that flash buttons off momentarily.
  }, [isActive, setMainActions])

  // Sync ref-held actions to context when the ReactNode identity changes
  // (separate from the mount/unmount effect to avoid cleanup flicker).
  useEffect(() => {
    if (isActive) {
      setMainActions(actionsRef.current)
    }
  }, [isActive, setMainActions, actions])
}

export function useRegisterDetailActions(actions: ReactNode, isActive: boolean) {
  const { setDetailActions } = usePageActions()
  const actionsRef = useRef(actions)
  actionsRef.current = actions

  useEffect(() => {
    if (isActive) {
      setDetailActions(actionsRef.current)
    }
    return () => setDetailActions(null)
  }, [isActive, setDetailActions])

  useEffect(() => {
    if (isActive) {
      setDetailActions(actionsRef.current)
    }
  }, [isActive, setDetailActions, actions])
}
