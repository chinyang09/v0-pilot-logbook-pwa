import type React from "react"
import type { Metadata } from "next"
import Image from "next/image"

export const metadata: Metadata = {
  title: "Login - OOOI",
  description: "Sign in to your OOOI pilot logbook",
}

/**
 * Auth layout - immersive cockpit background, always dark
 */
export default function AuthLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="dark h-full w-full overflow-auto overscroll-contain pt-safe relative">
      {/* Cockpit background — FIXED to the viewport, so a short screen that
          scrolls the form (a phone in landscape) scrolls it over the picture
          rather than off the end of it. And still: it used to zoom on a 25s
          Ken Burns loop, which on a screen whose only job is to be steady
          read as the page itself moving. */}
      <div className="fixed inset-0 z-0">
        <Image
          src="/images/cockpit-bg.jpg"
          alt=""
          fill
          priority
          className="object-cover object-center"
          sizes="100vw"
        />
        {/* Dark gradient overlay */}
        <div className="absolute inset-0 bg-gradient-to-b from-black/30 via-black/45 to-black/65" />
      </div>

      {/* Content */}
      <div className="relative z-10 h-full">
        {children}
      </div>
    </div>
  )
}
