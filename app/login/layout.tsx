import type React from "react"
import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Login - SkyLog",
  description: "Sign in to your SkyLog pilot logbook",
}

export default function LoginLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return children
}
