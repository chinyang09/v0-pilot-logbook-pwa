"use client";

import { useMemo, useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { PageContainer } from "@/components/page-container";
import { SyncStatus } from "@/components/sync-status";
import { useAirportDatabase } from "@/hooks/use-indexed-db";
import { getAirportByICAO } from "@/lib/airport-database";
import {
  ArrowLeft,
  MapPin,
  Globe,
  Mountain,
  Clock,
  Loader2,
} from "lucide-react";
import { useRouter, useParams } from "next/navigation";

export default function AirportDetailPage() {
  const params = useParams();
  const icao = params.icao as string;
  const router = useRouter();
  const { airports, isLoading } = useAirportDatabase();

  const airport = useMemo(() => {
    if (!airports.length) return null;
    return getAirportByICAO(airports, icao);
  }, [airports, icao]);

  if (isLoading) {
    return (
      <div className="h-[100dvh] bg-background flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <PageContainer
      header={
        <header className="flex-none bg-background/95 backdrop-blur-lg border-b border-border z-50">
          <div className="container mx-auto px-3">
            <div className="flex items-center justify-between h-12">
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => router.back()}
                  className="h-8 w-8 p-0"
                >
                  <ArrowLeft className="h-4 w-4" />
                </Button>
                <h1 className="text-lg font-semibold">
                  {airport ? airport.icao : "Airport"}
                </h1>
              </div>
              <SyncStatus />
            </div>
          </div>
        </header>
      }
    >
      {/* 3. SCROLLABLE CONTENT: Main fills space and scrolls internally */}
      <div className="container mx-auto px-3 pt-3 pb-safe">
        {" "}
        {!airport ? (
          <p className="text-center text-muted-foreground py-12">
            Airport {icao.toUpperCase()} not found
          </p>
        ) : (
          <div className="space-y-4">
            {/* Airport header */}
            <div className="bg-card border border-border rounded-lg p-4">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-2xl font-bold text-foreground">
                  {airport.icao}
                </span>
                {airport.iata && (
                  <span className="text-lg text-muted-foreground">
                    ({airport.iata})
                  </span>
                )}
              </div>
              <h2 className="text-xl font-semibold text-foreground mb-1">
                {airport.name}
              </h2>
              <div className="flex items-center gap-1 text-sm text-muted-foreground">
                <MapPin className="h-4 w-4" />
                <span>
                  {airport.city} - {airport.country}
                </span>
              </div>
            </div>

            {/* Location details */}
            <div className="bg-card border border-border rounded-lg p-4 space-y-3">
              <h3 className="font-semibold text-foreground mb-2">
                Location Details
              </h3>

              <div className="flex items-start gap-2">
                <Globe className="h-4 w-4 text-muted-foreground mt-0.5" />
                <div className="flex-1">
                  <div className="text-sm font-medium text-foreground">
                    Coordinates
                  </div>
                  <div className="text-sm text-muted-foreground">
                    {airport.latitude.toFixed(6)}°,{" "}
                    {airport.longitude.toFixed(6)}°
                  </div>
                </div>
              </div>

              <div className="flex items-start gap-2">
                <Mountain className="h-4 w-4 text-muted-foreground mt-0.5" />
                <div className="flex-1">
                  <div className="text-sm font-medium text-foreground">
                    Elevation
                  </div>
                  <div className="text-sm text-muted-foreground">
                    {airport.altitude} ft
                  </div>
                </div>
              </div>

              <div className="flex items-start gap-2">
                <Clock className="h-4 w-4 text-muted-foreground mt-0.5" />
                <div className="flex-1">
                  <div className="text-sm font-medium text-foreground">
                    Timezone
                  </div>
                  <div className="text-sm text-muted-foreground">
                    {airport.tz}
                    {airport.timezone !== undefined &&
                      ` (UTC${airport.timezone >= 0 ? "+" : ""}${
                        airport.timezone
                      })`}
                  </div>
                </div>
              </div>

              {airport.dst && (
                <div className="flex items-start gap-2">
                  <Clock className="h-4 w-4 text-muted-foreground mt-0.5" />
                  <div className="flex-1">
                    <div className="text-sm font-medium text-foreground">
                      DST
                    </div>
                    <div className="text-sm text-muted-foreground">
                      {airport.dst}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </PageContainer>
  );
}
