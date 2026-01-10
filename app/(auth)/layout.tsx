import type React from "react"
import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Login - OOOI",
  description: "Sign in to your OOOI pilot logbook",
}

/**
 * Auth layout - no navbar, minimal UI
 */
export default function AuthLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="min-h-screen bg-background">
      {children}
    </div>
  )
}
