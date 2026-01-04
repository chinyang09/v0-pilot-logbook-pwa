import type React from "react"
import type { Metadata, Viewport } from "next"
import { Inter, Geist_Mono } from "next/font/google"
import { ServiceWorkerRegister } from "@/components/service-worker-register"
import { SyncProvider } from "@/components/sync-provider"
import { AuthProvider } from "@/components/auth-provider"
import "./globals.css"

const inter = Inter({ subsets: ["latin"] })
const geistMono = Geist_Mono({ subsets: ["latin"] })

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
    generator: 'v0.app'
}

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#14151a" },
    { media: "(prefers-color-scheme: light)", color: "#14151a" },
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
    <html lang="en" className="dark bg-[#14151a]" style={{ backgroundColor: "#14151a" }}>
      <head>
        <meta name="theme-color" content="#14151a" />
        <meta name="theme-color" media="(prefers-color-scheme: dark)" content="#14151a" />
        <meta name="theme-color" media="(prefers-color-scheme: light)" content="#14151a" />
        {/* Windows tile color */}
        <meta name="msapplication-TileColor" content="#14151a" />
        {/* Android specific */}
        <meta name="mobile-web-app-capable" content="yes" />
      </head>
      <body className="bg-[#14151a] font-sans antialiased" style={{ backgroundColor: "#14151a", minHeight: "100dvh" }}>
        <ServiceWorkerRegister />
        <AuthProvider>
          <SyncProvider>{children}</SyncProvider>
        </AuthProvider>
      </body>
    </html>
  )
}
