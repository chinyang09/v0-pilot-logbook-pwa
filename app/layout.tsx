import type React from "react";
import type { Metadata, Viewport } from "next";
import { Inter, Geist_Mono } from "next/font/google";
import { ServiceWorkerRegister } from "@/components/service-worker-register";
import { SyncProvider } from "@/components/sync-provider";
import { OfflineIndicator } from "@/components/offline-indicator";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });
const geistMono = Geist_Mono({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "OOOI",
  description:
    "Professional pilot logbook with offline capability and cloud sync",
  manifest: "/manifest.json",
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
};

export const viewport: Viewport = {
  themeColor: "#1a1d2e",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="bg-background">
      <head>
        <link rel="manifest" href="/manifest.json" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
      </head>
      <body className={`font-sans antialiased`}>
        <ServiceWorkerRegister />
        {/*<OfflineIndicator />*/}
        <SyncProvider>{children}</SyncProvider>
      </body>
    </html>
  );
}
