"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Book, Database, Plus } from "lucide-react"
import { cn } from "@/lib/utils"

type NavTab = "logbook" | "data"

interface BottomNavbarProps {
  activeTab: NavTab
  onTabChange: (tab: NavTab) => void
  onAddFlight: () => void
}

export function BottomNavbar({ activeTab, onTabChange, onAddFlight }: BottomNavbarProps) {
  const [isVisible, setIsVisible] = useState(true)
  const [lastScrollY, setLastScrollY] = useState(0)

  useEffect(() => {
    const handleScroll = () => {
      const currentScrollY = window.scrollY

      // Show navbar when scrolling up or at top
      if (currentScrollY < lastScrollY || currentScrollY < 50) {
        setIsVisible(true)
      } else if (currentScrollY > lastScrollY && currentScrollY > 100) {
        // Hide navbar when scrolling down past 100px
        setIsVisible(false)
      }

      setLastScrollY(currentScrollY)
    }

    window.addEventListener("scroll", handleScroll, { passive: true })
    return () => window.removeEventListener("scroll", handleScroll)
  }, [lastScrollY])

  return (
    <nav
      className={cn(
        "fixed bottom-0 left-0 right-0 z-50 bg-background/95 backdrop-blur-lg border-t border-border transition-transform duration-300",
        !isVisible && "translate-y-full",
      )}
    >
      <div className="container mx-auto px-4">
        <div className="flex items-center justify-around h-16">
          <Button
            variant="ghost"
            className={cn("flex flex-col items-center gap-1 h-14 px-6", activeTab === "logbook" && "text-primary")}
            onClick={() => onTabChange("logbook")}
          >
            <Book className="h-5 w-5" />
            <span className="text-xs">Logbook</span>
          </Button>

          <Button size="lg" className="h-12 w-12 rounded-full shadow-lg" onClick={onAddFlight}>
            <Plus className="h-6 w-6" />
          </Button>

          <Button
            variant="ghost"
            className={cn("flex flex-col items-center gap-1 h-14 px-6", activeTab === "data" && "text-primary")}
            onClick={() => onTabChange("data")}
          >
            <Database className="h-5 w-5" />
            <span className="text-xs">Data</span>
          </Button>
        </div>
      </div>
    </nav>
  )
}
