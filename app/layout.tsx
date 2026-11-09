import type React from "react"
import type { Metadata, Viewport } from "next"
import { ServiceWorkerRegister } from "@/components/service-worker-register"
import { SyncProvider } from "@/components/providers/sync-provider"
import { AuthProvider } from "@/components/providers/auth-provider"
import { ThemeProvider } from "@/components/providers/theme-provider"

import { OCRModelsPreloader } from "@/components/ocr-models-preloader"
import { AppAlertHost } from "@/components/ui/app-alert-host"
import { PALETTE_BOOT_SCRIPT } from "@/lib/theme/apply"
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
  // No `themeColor` here on purpose. The status bar's colour is the ground of
  // the mode ON SCREEN, which only the page knows (the app's own light/dark,
  // not the OS's), and a tag Next renders is put back to these static values
  // on every client navigation. PALETTE_BOOT_SCRIPT creates and owns the tag.
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
        {/* The chosen palette, back on screen before the first paint — from
            localStorage, so it needs no network (see lib/theme/apply.ts). */}
        <script dangerouslySetInnerHTML={{ __html: PALETTE_BOOT_SCRIPT }} />
        {/* Windows tile color */}
        <meta name="msapplication-TileColor" content="#05080B" />
        {/* Inter is the single app typeface (sans + numbers). */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        {/* crossOrigin: fetched in CORS mode the response is readable, so the
            service worker can cache it (an opaque no-cors response is never
            stored) and the app keeps Inter offline. */}
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@100..900&display=swap"
          rel="stylesheet"
          crossOrigin="anonymous"
        />
      </head>
      <body className="bg-background font-sans antialiased">
        <ThemeProvider attribute="class" defaultTheme="dark" enableSystem disableTransitionOnChange>
          <ServiceWorkerRegister />
          <OCRModelsPreloader />
          <AuthProvider>
            <SyncProvider>{children}</SyncProvider>
          </AuthProvider>
          {/* The app's own confirm/alert — asked from anywhere, login included. */}
          <AppAlertHost />
        </ThemeProvider>
      </body>
    </html>
  )
}
