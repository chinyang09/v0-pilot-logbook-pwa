"use client"

import React, {
  createContext,
  useContext,
  useState,
  useLayoutEffect,
  useMemo,
  useRef,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react"

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
  setMainActions: Dispatch<SetStateAction<ReactNode>>
  /** Register detail panel actions (call from active page) */
  setDetailActions: Dispatch<SetStateAction<ReactNode>>
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
  set: Dispatch<SetStateAction<ReactNode>>,
) {
  const actionsRef = useRef(actions)
  actionsRef.current = actions
  // What THIS page last put in the header. The cleanup clears only that.
  const ownRef = useRef<ReactNode>(null)

  // LAYOUT effects, both of them: a page becoming active and its buttons
  // arriving in the header must be the same painted frame. As passive effects
  // the header lagged the page by a frame or two on every tab switch — the
  // dashboard showed under the logbook's search/calendar/import buttons.
  useLayoutEffect(() => {
    if (isActive) {
      ownRef.current = actionsRef.current
      set(actionsRef.current)
    }
    // Clears on unmount (non-keepalive) AND on the active→inactive transition
    // (keep-alive) — but ONLY if the header still holds this page's buttons.
    // A keep-alive page learns it is inactive from the route STORE, which is
    // published in a passive effect AFTER the commit that mounted the next
    // page; that page's layout effect has already registered its own buttons,
    // and an unconditional `set(null)` here wiped them. That is why the
    // currencies, discrepancies and FDP headers came up empty when arriving
    // from the logbook, and full when arriving from another ordinary page.
    return () => {
      const own = ownRef.current
      ownRef.current = null
      set((current) => (current === own ? null : current))
    }
    // `actions` is deliberately absent: this effect reads it only through the
    // ref, so re-running on a new node would cleanup→re-register and flash the
    // buttons off. Nothing to silence here — the effect body references no
    // reactive value that isn't listed.
  }, [isActive, set])

  // Sync ref-held actions to context when the ReactNode identity changes
  // (separate from the mount/unmount effect to avoid cleanup flicker).
  useLayoutEffect(() => {
    if (isActive) {
      ownRef.current = actionsRef.current
      set(actionsRef.current)
    }
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
