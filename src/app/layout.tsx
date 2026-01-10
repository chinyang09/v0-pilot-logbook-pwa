import type React from "react"
import type { Metadata, Viewport } from "next"
import { ServiceWorkerRegister } from "@/components/service-worker-register"
import { SyncProvider } from "@/components/sync-provider"
import { AuthProvider } from "@/components/auth-provider"
import { AircraftPreloader } from "@/components/aircraft-preloader"
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
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#05080B" },
    { media: "(prefers-color-scheme: light)", color: "#05080B" },
  ],
  colorScheme: "dark",
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
    <html lang="en" className="dark" style={{ backgroundColor: "#05080B" }}>
      <head>
        {/* Android status bar color */}
        <meta name="theme-color" content="#05080B" />
        {/* Windows tile color */}
        <meta name="msapplication-TileColor" content="#05080B" />
        {/* Android navbar color */}
        <meta name="theme-color" media="(prefers-color-scheme: dark)" content="#05080B" />
      </head>
      <body className="bg-background font-sans antialiased" style={{ backgroundColor: "#05080B" }}>
        <ServiceWorkerRegister />
        <AircraftPreloader />
        <AuthProvider>
          <SyncProvider>{children}</SyncProvider>
        </AuthProvider>
      </body>
    </html>
  )
}
