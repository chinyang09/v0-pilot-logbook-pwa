"use client"

import React, { createContext, useContext, useState, useRef, useCallback, type ReactNode } from "react"

interface ScrollNavbarContextType {
  hideNavbar: boolean
  handleScroll: (e: React.UIEvent<HTMLElement>) => void
}

const ScrollNavbarContext = createContext<ScrollNavbarContextType | null>(null)

interface ScrollNavbarProviderProps {
  children: ReactNode
  threshold?: number
  offset?: number
}

export function ScrollNavbarProvider({
  children,
  threshold = 10,
  offset = 50
}: ScrollNavbarProviderProps) {
  const [hideNavbar, setHideNavbar] = useState(false)
  const lastScrollY = useRef(0)

  const handleScroll = useCallback(
    (e: React.UIEvent<HTMLElement>) => {
      const currentScrollY = e.currentTarget.scrollTop

      // Ignore very small movements (jitter)
      if (Math.abs(currentScrollY - lastScrollY.current) < threshold) return

      // Hide if scrolling down and past offset; show if scrolling up
      if (currentScrollY > lastScrollY.current && currentScrollY > offset) {
        setHideNavbar(true)
      } else {
        setHideNavbar(false)
      }

      lastScrollY.current = currentScrollY
    },
    [threshold, offset]
  )

  return (
    <ScrollNavbarContext.Provider value={{ hideNavbar, handleScroll }}>
      {children}
    </ScrollNavbarContext.Provider>
  )
}

// Default no-op for when used outside provider
const defaultValue: ScrollNavbarContextType = {
  hideNavbar: false,
  handleScroll: () => {}
}

export function useScrollNavbarContext() {
  const context = useContext(ScrollNavbarContext)
  // Return default value when used outside provider (e.g., root page)
  return context ?? defaultValue
}
