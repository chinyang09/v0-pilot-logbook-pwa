"use client"

import type React from "react"
import { createContext, useContext, useEffect, useState, useCallback, useRef } from "react"
import { getUserPreferences, saveUserPreferences } from "@/lib/db"
import type { DisplayPreferences, AutoFillPreferences, DutyTimeDefaults } from "@/types/db/stores.types"
import {
  DEFAULT_DISPLAY_PREFERENCES,
  DEFAULT_AUTO_FILL_PREFERENCES,
  DEFAULT_DUTY_TIME_DEFAULTS,
} from "@/types/db/stores.types"

export interface ResolvedPreferences {
  display: DisplayPreferences
  autoFill: AutoFillPreferences
  dutyTimeDefaults: DutyTimeDefaults
}

interface PreferencesContextType {
  preferences: ResolvedPreferences
  isLoading: boolean
  updateDisplay: (partial: Partial<DisplayPreferences>) => Promise<void>
  updateAutoFill: (partial: Partial<AutoFillPreferences>) => Promise<void>
  updateDutyTimeDefaults: (partial: Partial<DutyTimeDefaults>) => Promise<void>
}

const defaultResolved: ResolvedPreferences = {
  display: DEFAULT_DISPLAY_PREFERENCES,
  autoFill: DEFAULT_AUTO_FILL_PREFERENCES,
  dutyTimeDefaults: DEFAULT_DUTY_TIME_DEFAULTS,
}

const PreferencesContext = createContext<PreferencesContextType | undefined>(undefined)

export function PreferencesProvider({ children }: { children: React.ReactNode }) {
  const [preferences, setPreferences] = useState<ResolvedPreferences>(defaultResolved)
  const [isLoading, setIsLoading] = useState(true)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    getUserPreferences().then((prefs) => {
      if (prefs) {
        setPreferences({
          display: { ...DEFAULT_DISPLAY_PREFERENCES, ...prefs.display },
          autoFill: { ...DEFAULT_AUTO_FILL_PREFERENCES, ...prefs.autoFill },
          dutyTimeDefaults: { ...DEFAULT_DUTY_TIME_DEFAULTS, ...prefs.dutyTimeDefaults },
        })
      }
      setIsLoading(false)
    }).catch(() => {
      setIsLoading(false)
    })
  }, [])

  const persistPreferences = useCallback((updated: ResolvedPreferences) => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      saveUserPreferences({
        display: updated.display,
        autoFill: updated.autoFill,
        dutyTimeDefaults: updated.dutyTimeDefaults,
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

  return (
    <PreferencesContext.Provider
      value={{
        preferences,
        isLoading,
        updateDisplay,
        updateAutoFill,
        updateDutyTimeDefaults,
      }}
    >
      {children}
    </PreferencesContext.Provider>
  )
}

export function usePreferences() {
  const context = useContext(PreferencesContext)
  if (context === undefined) {
    throw new Error("usePreferences must be used within a PreferencesProvider")
  }
  return context
}
