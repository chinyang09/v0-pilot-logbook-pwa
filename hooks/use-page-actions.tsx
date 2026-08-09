"use client"

import React, { createContext, useContext, useState, useEffect, useMemo, useRef, type ReactNode } from "react"

/**
 * The action buttons the shell's header row renders for the active page.
 *
 * TWO contexts, not one, and the split is load-bearing. The VALUES change every
 * time a page registers its buttons — but the only thing that reads them is the
 * shell's header. The register hooks below need the SETTERS, which never
 * change. Held together in one context, every keep-alive page (all six are
 * mounted at once) re-rendered whenever any one of them registered its actions,
 * which is on every tab switch. Split, that re-render reaches the header alone.
 */
interface PageActionsState {
  /** Action buttons for the main (left) panel — rendered flush-left on desktop */
  mainActions: ReactNode
  /** Action buttons for the detail (right) panel — rendered flush-right on desktop */
  detailActions: ReactNode
}

interface PageActionsSetters {
  /** Register main panel actions (call from active page) */
  setMainActions: (actions: ReactNode) => void
  /** Register detail panel actions (call from active page) */
  setDetailActions: (actions: ReactNode) => void
}

const PageActionsStateContext = createContext<PageActionsState | null>(null)
const PageActionsSettersContext = createContext<PageActionsSetters | null>(null)

export function PageActionsProvider({ children }: { children: ReactNode }) {
  const [mainActions, setMainActions] = useState<ReactNode>(null)
  const [detailActions, setDetailActions] = useState<ReactNode>(null)

  const state = useMemo(() => ({ mainActions, detailActions }), [mainActions, detailActions])
  // `useState` setters are stable for the provider's lifetime, so this value is
  // created once and no setter consumer ever re-renders because of this context.
  const setters = useMemo(() => ({ setMainActions, setDetailActions }), [])

  return (
    <PageActionsSettersContext.Provider value={setters}>
      <PageActionsStateContext.Provider value={state}>
        {children}
      </PageActionsStateContext.Provider>
    </PageActionsSettersContext.Provider>
  )
}

const defaultState: PageActionsState = { mainActions: null, detailActions: null }
const defaultSetters: PageActionsSetters = {
  setMainActions: () => {},
  setDetailActions: () => {},
}

/** Read the registered actions. Only the shell's header should need this. */
export function usePageActions(): PageActionsState {
  return useContext(PageActionsStateContext) ?? defaultState
}

/**
 * Shared body of the two register hooks. Keeps the actions in a ref so the
 * mount/unmount effect never has to depend on them — a cleanup→re-register
 * cycle flashes the buttons off for a frame.
 */
function useRegisterActions(
  actions: ReactNode,
  isActive: boolean,
  set: (actions: ReactNode) => void,
) {
  const actionsRef = useRef(actions)
  actionsRef.current = actions

  useEffect(() => {
    if (isActive) set(actionsRef.current)
    // Clears on unmount (non-keepalive) AND on inactive→active transition cleanup (keepalive).
    // This prevents stale actions persisting when lazy-loaded pages race during navigation.
    return () => set(null)
    // Deliberately excluding `actions` — the ref tracks the latest value without
    // triggering cleanup→re-register cycles that flash buttons off momentarily.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActive, set])

  // Sync ref-held actions to context when the ReactNode identity changes
  // (separate from the mount/unmount effect to avoid cleanup flicker).
  useEffect(() => {
    if (isActive) set(actionsRef.current)
  }, [isActive, set, actions])
}

/**
 * Helper hook for keep-alive pages to register their action buttons.
 *
 * Automatically sets/clears actions based on `isActive` from `usePageActive`.
 * Memoize `actions` (useMemo) so it doesn't re-register every render.
 */
export function useRegisterMainActions(actions: ReactNode, isActive: boolean) {
  const { setMainActions } = useContext(PageActionsSettersContext) ?? defaultSetters
  useRegisterActions(actions, isActive, setMainActions)
}

export function useRegisterDetailActions(actions: ReactNode, isActive: boolean) {
  const { setDetailActions } = useContext(PageActionsSettersContext) ?? defaultSetters
  useRegisterActions(actions, isActive, setDetailActions)
}
