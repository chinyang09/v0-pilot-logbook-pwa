import type React from "react"
import type { Metadata, Viewport } from "next"
import { ServiceWorkerRegister } from "@/components/service-worker-register"
import { SyncProvider } from "@/components/providers/sync-provider"
import { AuthProvider } from "@/components/providers/auth-provider"
import { ThemeProvider } from "@/components/providers/theme-provider"

import { OCRModelsPreloader } from "@/components/ocr-models-preloader"
import { ViewportDebug } from "@/components/viewport-debug"
import { ViewportShellCompensator } from "@/components/viewport-shell-compensator"
import "./globals.css"

export const metadata: Metadata = {
  title: "OOOI",
  description: "Professional pilot logbook with offline capability and cloud sync",
  manifest: "/manifest.json",
  other: {
    "mobile-web-app-capable": "yes",
    "application-name": "OOOI",
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "OOOI",
  },
  icons: {
    icon: "/icon-192.png",
    apple: "/icon-192.png",
  },
  generator: "v0.app",
}

export const viewport: Viewport = {
  // Exactly the app's own background in each theme — the sRGB of
  // oklch(0.15 0.01 60) / oklch(0.975 0.005 75) in globals.css. Where a system
  // bar is painted with this rather than left transparent, it has to be the
  // SAME colour as the page or it reads as a band bolted to the top. The old
  // values were cold near-blacks against a warm app.
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#0e0a07" },
    { media: "(prefers-color-scheme: light)", color: "#f9f6f3" },
  ],
  colorScheme: "dark light",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Windows tile color */}
        <meta name="msapplication-TileColor" content="#05080B" />
        {/* Inter is the single app typeface (sans + numbers). */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@100..900&display=swap" rel="stylesheet" />
      </head>
      <body className="bg-background font-sans antialiased">
        <ThemeProvider attribute="class" defaultTheme="dark" enableSystem disableTransitionOnChange>
          {/* Measures the iOS standalone viewport shortfall into --shell-bottom-gap */}
          <ViewportShellCompensator />
          {/* TEMP DIAGNOSTIC — remove after the iOS standalone viewport investigation */}
          <ViewportDebug />
          <ServiceWorkerRegister />
          <OCRModelsPreloader />
          <AuthProvider>
            <SyncProvider>{children}</SyncProvider>
          </AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}
