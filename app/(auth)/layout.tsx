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
    <div className="dark h-[100dvh] w-full overflow-auto overscroll-contain pt-safe relative">
      {/* Cockpit background image */}
      <div className="absolute inset-0 z-0">
        <Image
          src="/images/cockpit-bg.jpg"
          alt=""
          fill
          priority
          className="object-cover object-center animate-ken-burns"
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
