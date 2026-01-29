"use client"

import React, { createContext, useContext, useState, useRef, useCallback, useEffect, type ReactNode } from "react"

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

  // Reset navbar state on orientation/resize changes
  useEffect(() => {
    const handleResize = () => {
      // Reset to visible state on orientation change
      setHideNavbar(false)
      lastScrollY.current = 0
    }

    window.addEventListener("resize", handleResize)
    window.addEventListener("orientationchange", handleResize)

    return () => {
      window.removeEventListener("resize", handleResize)
      window.removeEventListener("orientationchange", handleResize)
    }
  }, [])

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
