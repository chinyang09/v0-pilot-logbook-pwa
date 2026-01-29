"use client"

import React, { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react"

const SIDEBAR_STORAGE_KEY = "sidebar-open"

interface SidebarContextType {
  isOpen: boolean
  toggle: () => void
  open: () => void
  close: () => void
}

const SidebarContext = createContext<SidebarContextType | null>(null)

interface SidebarProviderProps {
  children: ReactNode
  defaultOpen?: boolean
}

export function SidebarProvider({
  children,
  defaultOpen = true
}: SidebarProviderProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen)
  const [isHydrated, setIsHydrated] = useState(false)

  // Load from localStorage after hydration
  useEffect(() => {
    const stored = localStorage.getItem(SIDEBAR_STORAGE_KEY)
    if (stored !== null) {
      setIsOpen(stored === "true")
    }
    setIsHydrated(true)
  }, [])

  // Persist to localStorage
  useEffect(() => {
    if (isHydrated) {
      localStorage.setItem(SIDEBAR_STORAGE_KEY, String(isOpen))
    }
  }, [isOpen, isHydrated])

  const toggle = useCallback(() => {
    setIsOpen(prev => !prev)
  }, [])

  const open = useCallback(() => {
    setIsOpen(true)
  }, [])

  const close = useCallback(() => {
    setIsOpen(false)
  }, [])

  return (
    <SidebarContext.Provider value={{ isOpen, toggle, open, close }}>
      {children}
    </SidebarContext.Provider>
  )
}

// Default value for when used outside provider
const defaultValue: SidebarContextType = {
  isOpen: true,
  toggle: () => {},
  open: () => {},
  close: () => {}
}

export function useSidebar() {
  const context = useContext(SidebarContext)
  return context ?? defaultValue
}
