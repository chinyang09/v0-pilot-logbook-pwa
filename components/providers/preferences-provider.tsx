"use client"

import type React from "react"
import { createContext, useContext, useEffect, useState, useCallback, useRef, useMemo } from "react"
import { useTheme } from "next-themes"
import { getUserPreferences, saveUserPreferences } from "@/lib/db"
import type {
  DisplayPreferences,
  AutoFillPreferences,
  DutyTimeDefaults,
  NavigationPreferences,
  ImportDefaults,
} from "@/types/db/stores.types"
import {
  DEFAULT_DISPLAY_PREFERENCES,
  DEFAULT_AUTO_FILL_PREFERENCES,
  DEFAULT_DUTY_TIME_DEFAULTS,
  DEFAULT_NAVIGATION_PREFERENCES,
  DEFAULT_IMPORT_DEFAULTS,
} from "@/types/db/stores.types"

export interface ResolvedPreferences {
  display: DisplayPreferences
  autoFill: AutoFillPreferences
  dutyTimeDefaults: DutyTimeDefaults
  navigation: NavigationPreferences
  importDefaults: ImportDefaults
}

interface PreferencesContextType {
  preferences: ResolvedPreferences
  isLoading: boolean
  updateDisplay: (partial: Partial<DisplayPreferences>) => Promise<void>
  updateAutoFill: (partial: Partial<AutoFillPreferences>) => Promise<void>
  updateDutyTimeDefaults: (partial: Partial<DutyTimeDefaults>) => Promise<void>
  updateNavigation: (nav: NavigationPreferences) => Promise<void>
  updateImportDefaults: (partial: Partial<ImportDefaults>) => Promise<void>
}

const defaultResolved: ResolvedPreferences = {
  display: DEFAULT_DISPLAY_PREFERENCES,
  autoFill: DEFAULT_AUTO_FILL_PREFERENCES,
  dutyTimeDefaults: DEFAULT_DUTY_TIME_DEFAULTS,
  navigation: DEFAULT_NAVIGATION_PREFERENCES,
  importDefaults: DEFAULT_IMPORT_DEFAULTS,
}

const PreferencesContext = createContext<PreferencesContextType | undefined>(undefined)

export function PreferencesProvider({ children }: { children: React.ReactNode }) {
  const [preferences, setPreferences] = useState<ResolvedPreferences>(defaultResolved)
  const [isLoading, setIsLoading] = useState(true)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const { setTheme } = useTheme()

  useEffect(() => {
    getUserPreferences().then((prefs) => {
      if (prefs) {
        // The short-lived "night" theme was removed — map any stored value to
        // dark so next-themes never receives an unknown theme name.
        if (prefs.display && (prefs.display.theme as string) === "night") {
          prefs.display = { ...prefs.display, theme: "dark" }
        }
        const resolved = {
          display: { ...DEFAULT_DISPLAY_PREFERENCES, ...prefs.display },
          autoFill: { ...DEFAULT_AUTO_FILL_PREFERENCES, ...prefs.autoFill },
          dutyTimeDefaults: { ...DEFAULT_DUTY_TIME_DEFAULTS, ...prefs.dutyTimeDefaults },
          navigation: { ...DEFAULT_NAVIGATION_PREFERENCES, ...prefs.navigation },
          importDefaults: { ...DEFAULT_IMPORT_DEFAULTS, ...prefs.importDefaults },
        }
        setPreferences(resolved)

        // Sync persisted theme preference with next-themes on mount
        if (resolved.display.theme) {
          setTheme(resolved.display.theme)
        }
      }
      setIsLoading(false)
    }).catch(() => {
      setIsLoading(false)
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const persistPreferences = useCallback((updated: ResolvedPreferences) => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      saveUserPreferences({
        display: updated.display,
        autoFill: updated.autoFill,
        dutyTimeDefaults: updated.dutyTimeDefaults,
        navigation: updated.navigation,
        importDefaults: updated.importDefaults,
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

  const value = useMemo(
    () => ({
      preferences,
      isLoading,
      updateDisplay,
      updateAutoFill,
      updateDutyTimeDefaults,
      updateNavigation,
      updateImportDefaults,
    }),
    [
      preferences,
      isLoading,
      updateDisplay,
      updateAutoFill,
      updateDutyTimeDefaults,
      updateNavigation,
      updateImportDefaults,
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
