"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { ChevronLeft, Plane, Loader2, Hash, Tag, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  getAircraftByRegistration,
  type NormalizedAircraft,
} from "@/lib/aircraft-database";

export default function AircraftDetailPage() {
  const params = useParams();
  const router = useRouter();
  // Decode the registration from the URL
  const registration = decodeURIComponent(params.registration as string);

  const [aircraft, setAircraft] = useState<NormalizedAircraft | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    async function loadAircraft() {
      setIsLoading(true);
      try {
        // OPTIMIZED: Fetch only this specific aircraft from IDB index
        // This replaces loading the entire 600k array into memory
        const found = await getAircraftByRegistration(registration);

        if (mounted) {
          setAircraft(found || null);
        }
      } catch (error) {
        console.error("[Aircraft Detail] Failed to load:", error);
      } finally {
        if (mounted) setIsLoading(false);
      }
    }

    loadAircraft();
    return () => {
      mounted = false;
    };
  }, [registration]);

  if (isLoading) {
    return (
      <div className="flex flex-col h-[100dvh] bg-background">
        <div className="flex items-center justify-center flex-1">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </div>
    );
  }

  if (!aircraft) {
    return (
      <div className="flex flex-col h-[100dvh] bg-background">
        <div className="flex-shrink-0 bg-card border-b border-border px-3 py-2">
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9"
              onClick={() => router.back()}
            >
              <ChevronLeft className="h-5 w-5" />
            </Button>
            <h1 className="text-lg font-semibold">Not Found</h1>
          </div>
        </div>
        <div className="flex-1 flex flex-col items-center justify-center p-4 text-center">
          <Info className="h-12 w-12 text-muted-foreground/50 mb-4" />
          <p className="text-muted-foreground">
            Could not find aircraft{" "}
            <span className="font-mono font-bold text-foreground">
              {registration}
            </span>{" "}
            in the local database.
          </p>
          <Button
            variant="outline"
            className="mt-4"
            onClick={() => router.back()}
          >
            Go Back
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[100dvh] bg-background">
      {/* Header */}
      <div className="flex-shrink-0 bg-card border-b border-border px-3 py-2">
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9"
            onClick={() => router.back()}
          >
            <ChevronLeft className="h-5 w-5" />
          </Button>
          <div className="min-w-0">
            <h1 className="text-lg font-bold truncate">
              {aircraft.registration || aircraft.icao24}
            </h1>
            {aircraft.typecode && (
              <p className="text-xs text-muted-foreground truncate uppercase">
                {aircraft.typecode} Designator
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Main Info Card */}
        <div className="bg-card border border-border rounded-xl p-5 shadow-sm">
          <div className="flex items-center gap-4 mb-6">
            <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
              <Plane className="h-7 w-7 text-primary" />
            </div>
            <div className="min-w-0">
              <h2 className="text-2xl font-black tracking-tight truncate">
                {aircraft.registration || "No Registration"}
              </h2>
              {aircraft.typecode && (
                <div className="inline-flex items-center mt-1">
                  <span className="text-xs font-bold text-primary bg-primary/10 px-2 py-0.5 rounded uppercase">
                    {aircraft.typecode}
                  </span>
                </div>
              )}
            </div>
          </div>

          <div className="grid gap-5">
            {aircraft.icao24 && (
              <div className="flex items-start gap-3">
                <div className="p-2 bg-muted rounded-md">
                  <Hash className="h-4 w-4 text-muted-foreground" />
                </div>
                <div>
                  <p className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">
                    ICAO24 (Mode S Address)
                  </p>
                  <p className="font-mono text-base font-semibold">
                    {aircraft.icao24.toUpperCase()}
                  </p>
                </div>
              </div>
            )}

            {aircraft.typecode && (
              <div className="flex items-start gap-3">
                <div className="p-2 bg-muted rounded-md">
                  <Tag className="h-4 w-4 text-muted-foreground" />
                </div>
                <div>
                  <p className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">
                    ICAO Type Designator
                  </p>
                  <p className="text-base font-semibold">{aircraft.typecode}</p>
                </div>
              </div>
            )}

            {aircraft.shortType && (
              <div className="flex items-start gap-3">
                <div className="p-2 bg-muted rounded-md">
                  <Info className="h-4 w-4 text-muted-foreground" />
                </div>
                <div>
                  <p className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">
                    Type Category
                  </p>
                  <p className="text-base font-semibold">
                    {aircraft.shortType}
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Action Button */}
        <Button
          className="w-full h-12 text-base font-bold"
          onClick={() => {
            const params = new URLSearchParams();
            params.set("aircraftReg", aircraft.registration);
            params.set("aircraftType", aircraft.typecode);
            router.push(`/new-flight?${params.toString()}`);
          }}
        >
          Use in New Flight
        </Button>
      </div>
    </div>
  );
}
