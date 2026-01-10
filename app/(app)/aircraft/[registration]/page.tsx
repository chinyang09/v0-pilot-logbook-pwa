"use client";

import { useState, useEffect, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { ChevronLeft, Plane, Loader2, Hash, Tag } from "lucide-react";
import { PageContainer } from "@/components/page-container";
import { Button } from "@/components/ui/button";
import {
  getAircraftDatabase,
  getAircraftByRegistration,
  getAircraftByIcao24,
  type NormalizedAircraft,
} from "@/lib/reference/aircraft-database";

export default function AircraftDetailPage() {
  const params = useParams();
  const router = useRouter();
  const registration = decodeURIComponent(params.registration as string);

  const [aircraft, setAircraft] = useState<NormalizedAircraft | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function loadAircraft() {
      setIsLoading(true);
      try {
        const database = await getAircraftDatabase();
        let found = getAircraftByRegistration(database, registration);
        if (!found) {
          found = getAircraftByIcao24(database, registration);
        }
        setAircraft(found || null);
      } catch (error) {
        console.error("[Aircraft Detail] Failed to load:", error);
      } finally {
        setIsLoading(false);
      }
    }

    loadAircraft();
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

  return (
    <PageContainer
      header={
        <header className="flex-none bg-card border-b border-border px-3 py-2 z-50">
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9"
              onClick={() => router.back()}
            >
              <ChevronLeft className="h-5 w-5" />
            </Button>
            <div>
              <h1 className="text-lg font-bold">
                {aircraft
                  ? aircraft.registration || aircraft.icao24
                  : "Aircraft Not Found"}
              </h1>
              {aircraft?.typecode && (
                <p className="text-sm text-muted-foreground">
                  {aircraft.typecode}
                </p>
              )}
            </div>
          </div>
        </header>
      }
    >
      {
        <div className="p-4 pb-safe space-y-4">
          {" "}
          {!aircraft ? (
            <div className="flex items-center justify-center py-12">
              <p className="text-muted-foreground">
                Could not find aircraft: {registration}
              </p>
            </div>
          ) : (
            <div className="bg-card border border-border rounded-xl p-4">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
                  <Plane className="h-6 w-6 text-primary" />
                </div>
                <div>
                  <h2 className="text-xl font-bold">
                    {aircraft.registration || "No Registration"}
                  </h2>
                  {aircraft.typecode && (
                    <span className="text-sm font-medium text-primary bg-primary/10 px-2 py-0.5 rounded">
                      {aircraft.typecode}
                    </span>
                  )}
                </div>
              </div>

              <div className="space-y-3">
                {aircraft.icao24 && (
                  <div className="flex items-start gap-3">
                    <Hash className="h-5 w-5 text-muted-foreground flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="text-sm text-muted-foreground">
                        ICAO24 (Mode S)
                      </p>
                      <p className="font-mono font-medium">
                        {aircraft.icao24.toUpperCase()}
                      </p>
                    </div>
                  </div>
                )}
                {aircraft.typecode && (
                  <div className="flex items-start gap-3">
                    <Tag className="h-5 w-5 text-muted-foreground flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="text-sm text-muted-foreground">
                        ICAO Type Designator
                      </p>
                      <p className="font-medium">{aircraft.typecode}</p>
                    </div>
                  </div>
                )}
                {aircraft.shortType && (
                  <div className="flex items-start gap-3">
                    <Tag className="h-5 w-5 text-muted-foreground flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="text-sm text-muted-foreground">
                        Type Category (ICAO Doc 8643)
                      </p>
                      <p className="font-medium">{aircraft.shortType}</p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      }
    </PageContainer>
  );
}
