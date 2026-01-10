"use client"

import type React from "react"
import { BottomNavbar } from "@/components/bottom-navbar"
import { Header } from "@/components/header"

/**
 * App layout - includes header and bottom navbar
 */
export default function AppLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="pb-20">
        {children}
      </main>
      <BottomNavbar />
    </div>
  )
}
