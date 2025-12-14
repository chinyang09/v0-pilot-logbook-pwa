"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Home, Book, Database, Plus, Plane } from "lucide-react"
import { cn } from "@/lib/utils"
import Link from "next/link"
import { usePathname } from "next/navigation"

export function BottomNavbar() {
  const pathname = usePathname()
  const [isVisible, setIsVisible] = useState(true)
  const [lastScrollY, setLastScrollY] = useState(0)

  useEffect(() => {
    const handleScroll = () => {
      const currentScrollY = window.scrollY

      if (currentScrollY < lastScrollY || currentScrollY < 50) {
        setIsVisible(true)
      } else if (currentScrollY > lastScrollY && currentScrollY > 100) {
        setIsVisible(false)
      }

      setLastScrollY(currentScrollY)
    }

    window.addEventListener("scroll", handleScroll, { passive: true })
    return () => window.removeEventListener("scroll", handleScroll)
  }, [lastScrollY])

  const activeTab =
    pathname === "/"
      ? "dashboard"
      : pathname === "/logbook"
        ? "logbook"
        : pathname === "/data"
          ? "data"
          : pathname === "/airports" || pathname?.startsWith("/airports/")
            ? "airports"
            : null

  return (
    <nav
      className={cn(
        "fixed bottom-0 left-0 right-0 z-50 bg-background/95 backdrop-blur-lg border-t border-border transition-transform duration-300",
        !isVisible && "translate-y-full",
      )}
    >
      <div className="container mx-auto px-2">
        <div className="flex items-center justify-around h-16">
          <Link href="/">
            <Button
              variant="ghost"
              className={cn(
                "flex flex-col items-center gap-0.5 h-14 px-3",
                activeTab === "dashboard" && "text-primary",
              )}
            >
              <Home className="h-5 w-5" />
              <span className="text-xs">Home</span>
            </Button>
          </Link>

          <Link href="/logbook">
            <Button
              variant="ghost"
              className={cn("flex flex-col items-center gap-0.5 h-14 px-3", activeTab === "logbook" && "text-primary")}
            >
              <Book className="h-5 w-5" />
              <span className="text-xs">Logbook</span>
            </Button>
          </Link>

          <Link href="/new-flight">
            <Button size="lg" className="h-12 w-12 rounded-full shadow-lg">
              <Plus className="h-6 w-6" />
            </Button>
          </Link>

          <Link href="/airports">
            <Button
              variant="ghost"
              className={cn("flex flex-col items-center gap-0.5 h-14 px-3", activeTab === "airports" && "text-primary")}
            >
              <Plane className="h-5 w-5" />
              <span className="text-xs">Airports</span>
            </Button>
          </Link>

          <Link href="/data">
            <Button
              variant="ghost"
              className={cn("flex flex-col items-center gap-0.5 h-14 px-3", activeTab === "data" && "text-primary")}
            >
              <Database className="h-5 w-5" />
              <span className="text-xs">Data</span>
            </Button>
          </Link>
        </div>
      </div>
    </nav>
  )
}
