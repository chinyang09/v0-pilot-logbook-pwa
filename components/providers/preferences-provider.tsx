"use client"

import type React from "react"
import { createContext, useContext, useEffect, useState, useCallback, useRef, useMemo } from "react"
import { useTheme } from "next-themes"
import { getUserPreferences, saveUserPreferences } from "@/lib/db"
import { syncService } from "@/lib/sync/sync-service"
import { resolveSeed } from "@/lib/theme/palette"
import { applyPalette } from "@/lib/theme/apply"
import type {
  DisplayPreferences,
  AutoFillPreferences,
  DutyTimeDefaults,
  NavigationPreferences,
  ImportDefaults,
  LoggingPreferences,
  ThemePreference,
  UserPreferences,
} from "@/types/db/stores.types"
import {
  DEFAULT_DISPLAY_PREFERENCES,
  DEFAULT_AUTO_FILL_PREFERENCES,
  DEFAULT_DUTY_TIME_DEFAULTS,
  DEFAULT_NAVIGATION_PREFERENCES,
  DEFAULT_IMPORT_DEFAULTS,
  DEFAULT_LOGGING_PREFERENCES,
} from "@/types/db/stores.types"

export interface ResolvedPreferences {
  display: DisplayPreferences
  autoFill: AutoFillPreferences
  dutyTimeDefaults: DutyTimeDefaults
  navigation: NavigationPreferences
  importDefaults: ImportDefaults
  logging: LoggingPreferences
}

interface PreferencesContextType {
  preferences: ResolvedPreferences
  isLoading: boolean
  updateDisplay: (partial: Partial<DisplayPreferences>) => Promise<void>
  updateAutoFill: (partial: Partial<AutoFillPreferences>) => Promise<void>
  updateDutyTimeDefaults: (partial: Partial<DutyTimeDefaults>) => Promise<void>
  updateNavigation: (nav: NavigationPreferences) => Promise<void>
  updateImportDefaults: (partial: Partial<ImportDefaults>) => Promise<void>
  updateLogging: (partial: Partial<LoggingPreferences>) => Promise<void>
}

const defaultResolved: ResolvedPreferences = {
  display: DEFAULT_DISPLAY_PREFERENCES,
  autoFill: DEFAULT_AUTO_FILL_PREFERENCES,
  dutyTimeDefaults: DEFAULT_DUTY_TIME_DEFAULTS,
  navigation: DEFAULT_NAVIGATION_PREFERENCES,
  importDefaults: DEFAULT_IMPORT_DEFAULTS,
  logging: DEFAULT_LOGGING_PREFERENCES,
}

/**
 * The stored preferences as the provider holds them. Only `display.theme`
 * needs care: it is this DEVICE's mode and may never have been chosen, in
 * which case `shownTheme` (what next-themes is actually showing) is the truth.
 */
function resolve(prefs: UserPreferences, shownTheme: () => ThemePreference): ResolvedPreferences {
  // The short-lived "night" theme was removed — map any stored value to dark
  // so next-themes never receives an unknown theme name.
  const stored = prefs.display?.theme as string | undefined
  const theme = stored === "night" ? "dark" : (stored as ThemePreference | undefined)
  return {
    display: { ...DEFAULT_DISPLAY_PREFERENCES, ...prefs.display, theme: theme ?? shownTheme() },
    autoFill: { ...DEFAULT_AUTO_FILL_PREFERENCES, ...prefs.autoFill },
    dutyTimeDefaults: { ...DEFAULT_DUTY_TIME_DEFAULTS, ...prefs.dutyTimeDefaults },
    navigation: { ...DEFAULT_NAVIGATION_PREFERENCES, ...prefs.navigation },
    importDefaults: { ...DEFAULT_IMPORT_DEFAULTS, ...prefs.importDefaults },
    logging: { ...DEFAULT_LOGGING_PREFERENCES, ...prefs.logging },
  }
}

const PreferencesContext = createContext<PreferencesContextType | undefined>(undefined)

export function PreferencesProvider({ children }: { children: React.ReactNode }) {
  const [preferences, setPreferences] = useState<ResolvedPreferences>(defaultResolved)
  const [isLoading, setIsLoading] = useState(true)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const { setTheme } = useTheme()

  useEffect(() => {
    getUserPreferences().then((prefs) => {
      // The mode next-themes is ACTUALLY showing (its own localStorage key).
      // When the stored row carries no mode — a fresh install, or a row
      // written before one was ever chosen — that is the truth, and the
      // in-memory "dark" default is not: holding the default meant the first
      // unrelated setting saved (a palette, say) wrote "dark" into the row and
      // the next launch flipped a light-mode pilot to dark.
      const shownTheme = (): ThemePreference => {
        try {
          const t = localStorage.getItem("theme")
          if (t === "light" || t === "dark" || t === "system") return t
        } catch {
          // storage unavailable
        }
        return DEFAULT_DISPLAY_PREFERENCES.theme
      }
      if (prefs) {
        setPreferences(resolve(prefs, shownTheme))
        // Sync a persisted mode with next-themes on mount
        const storedTheme = prefs.display?.theme as string | undefined
        if (storedTheme) setTheme(storedTheme === "night" ? "dark" : storedTheme)
      } else {
        setPreferences((prev) => ({ ...prev, display: { ...prev.display, theme: shownTheme() } }))
      }
      setIsLoading(false)
    }).catch(() => {
      setIsLoading(false)
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Settings are the USER's now, synced: another device's change arrives in
  // a pull and has to reach this one's screen. Only the synced half is taken
  // — the theme and palette are this device's own and do not move under it —
  // and not while an edit of ours is still waiting to be written, or the
  // reload would put the old value back on screen until it lands.
  useEffect(() => {
    return syncService.onDataChanged(() => {
      if (debounceRef.current) return
      getUserPreferences()
        .then((prefs) => {
          if (!prefs || debounceRef.current) return
          setPreferences((prev) => {
            const next = resolve(prefs, () => prev.display.theme)
            return {
              ...next,
              display: {
                ...next.display,
                theme: prev.display.theme,
                palette: prev.display.palette,
                customPalette: prev.display.customPalette,
              },
            }
          })
        })
        .catch(() => {})
    })
  }, [])

  // The palette is applied only once the stored preference has LOADED. Until
  // then the boot script has already put the last palette on screen, and
  // applying the in-memory default over it would flash Graphite on every
  // launch for whoever chose something else.
  const { palette, customPalette } = preferences.display
  useEffect(() => {
    if (isLoading) return
    applyPalette(resolveSeed(palette, customPalette))
  }, [isLoading, palette, customPalette])

  const persistPreferences = useCallback((updated: ResolvedPreferences) => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    // Whole groups are handed over; the store writes only the keys that
    // actually moved (`settingsPatch`), so an untouched default is never sent.
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null
      void saveUserPreferences({
        display: updated.display,
        autoFill: updated.autoFill,
        dutyTimeDefaults: updated.dutyTimeDefaults,
        navigation: updated.navigation,
        logging: updated.logging,
      })
    }, 500)
  }, [])

  const updateDisplay = useCallback(async (partial: Partial<DisplayPreferences>) => {
    setPreferences((prev) => {
      const updated = {
        ...prev,
        display: { ...prev.display, ...partial },
      }
      persistPreferences(updated)
      return updated
    })
  }, [persistPreferences])

  const updateAutoFill = useCallback(async (partial: Partial<AutoFillPreferences>) => {
    setPreferences((prev) => {
      const updated = {
        ...prev,
        autoFill: { ...prev.autoFill, ...partial },
      }
      persistPreferences(updated)
      return updated
    })
  }, [persistPreferences])

  const updateDutyTimeDefaults = useCallback(async (partial: Partial<DutyTimeDefaults>) => {
    setPreferences((prev) => {
      const updated = {
        ...prev,
        dutyTimeDefaults: { ...prev.dutyTimeDefaults, ...partial },
      }
      persistPreferences(updated)
      return updated
    })
  }, [persistPreferences])

  const updateNavigation = useCallback(async (nav: NavigationPreferences) => {
    setPreferences((prev) => {
      const updated = {
        ...prev,
        navigation: nav,
      }
      persistPreferences(updated)
      return updated
    })
  }, [persistPreferences])

  const updateImportDefaults = useCallback(async (partial: Partial<ImportDefaults>) => {
    setPreferences((prev) => {
      const updated = {
        ...prev,
        importDefaults: { ...prev.importDefaults, ...partial },
      }
      persistPreferences(updated)
      return updated
    })
  }, [persistPreferences])

  const updateLogging = useCallback(async (partial: Partial<LoggingPreferences>) => {
    setPreferences((prev) => {
      const updated = {
        ...prev,
        logging: { ...prev.logging, ...partial },
      }
      persistPreferences(updated)
      return updated
    })
  }, [persistPreferences])

  const value = useMemo(
    () => ({
      preferences,
      isLoading,
      updateDisplay,
      updateAutoFill,
      updateDutyTimeDefaults,
      updateNavigation,
      updateImportDefaults,
      updateLogging,
    }),
    [
      preferences,
      isLoading,
      updateDisplay,
      updateAutoFill,
      updateDutyTimeDefaults,
      updateNavigation,
      updateImportDefaults,
      updateLogging,
    ]
  )

  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>
}

export function usePreferences() {
  const context = useContext(PreferencesContext)
  if (context === undefined) {
    throw new Error("usePreferences must be used within a PreferencesProvider")
  }
  return context
}
