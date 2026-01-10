"use client";

import { useState, useEffect, Suspense, useRef } from "react";
import { FlightForm } from "@/components/flight-form";
import { PageContainer } from "@/components/page-container";
import type { FlightLog } from "@/lib/indexed-db";
import { getFlightById, addFlight } from "@/lib/indexed-db";
import { syncService } from "@/lib/sync";
import { refreshAllData, useDBReady } from "@/hooks/use-indexed-db";
import { useRouter, useSearchParams } from "next/navigation";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent } from "@/components/ui/card";
import { createEmptyFlightLog } from "@/lib/utils/flight-calculations";

const FORM_STORAGE_KEY = "flight-form-draft";

function NewFlightContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const editId = searchParams.get("edit");

  const selectedField = searchParams.get("field");
  const selectedAirport = searchParams.get("airport");
  const selectedAircraftReg = searchParams.get("aircraftReg");
  const selectedAircraftType = searchParams.get("aircraftType");
  const selectedCrewId = searchParams.get("crewId");
  const selectedCrewName = searchParams.get("crewName");

  const { isReady: dbReady } = useDBReady();
  const [editingFlight, setEditingFlight] = useState<FlightLog | null>(null);
  const [isLoadingFlight, setIsLoadingFlight] = useState(true);

  const flightLoadedRef = useRef(false);
  const currentFlightIdRef = useRef<string | null>(null);

  useEffect(() => {
    const unsubscribe = syncService.onDataChanged(() => {
      refreshAllData();
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!dbReady) return;

    const createOrLoadFlight = async () => {
      if (editId) {
        if (currentFlightIdRef.current === editId && flightLoadedRef.current) {
          setIsLoadingFlight(false);
          return;
        }

        setIsLoadingFlight(true);
        try {
          const flight = await getFlightById(editId);
          if (flight) {
            setEditingFlight(flight);
            currentFlightIdRef.current = editId;
            flightLoadedRef.current = true;
          }
        } catch (error) {
          console.error("Failed to load flight:", error);
        } finally {
          setIsLoadingFlight(false);
        }
        return;
      }

      if (flightLoadedRef.current && editingFlight) {
        setIsLoadingFlight(false);
        return;
      }

      const savedDraft = sessionStorage.getItem(FORM_STORAGE_KEY);
      if (savedDraft) {
        try {
          const draftData = JSON.parse(savedDraft);
          if (draftData.id) {
            const existingDraft = await getFlightById(draftData.id);
            if (existingDraft) {
              setEditingFlight(existingDraft);
              currentFlightIdRef.current = draftData.id;
              flightLoadedRef.current = true;
              setIsLoadingFlight(false);
              return;
            }
          }
        } catch {
          /* ignore */
        }
      }

      try {
        const emptyFlight = createEmptyFlightLog();
        const newDraft = await addFlight(emptyFlight);
        setEditingFlight(newDraft);
        currentFlightIdRef.current = newDraft.id;
        flightLoadedRef.current = true;
        sessionStorage.setItem(
          FORM_STORAGE_KEY,
          JSON.stringify({ ...emptyFlight, id: newDraft.id })
        );
      } catch (error) {
        console.error("Failed to create draft flight:", error);
      }
      setIsLoadingFlight(false);
    };

    createOrLoadFlight();
  }, [dbReady, editId]);

  const handleFlightAdded = async (flight: FlightLog) => {
    sessionStorage.removeItem(FORM_STORAGE_KEY);
    flightLoadedRef.current = false;
    currentFlightIdRef.current = null;
    if (navigator.onLine) {
      syncService.fullSync();
    }
    router.push("/logbook");
  };

  const handleClose = () => {
    router.back();
  };

  const isAirportField =
    selectedField === "departureIcao" || selectedField === "arrivalIcao";
  const isAircraftField = selectedField === "aircraftReg";
  const isCrewField =
    selectedField === "pic" ||
    selectedField === "sic" ||
    selectedField === "picId" ||
    selectedField === "sicId";

  const crewFieldMapped =
    selectedField === "pic"
      ? "picId"
      : selectedField === "sic"
      ? "sicId"
      : selectedField;

  return (
    /* 1. Viewport Lock: flex-col + h-[100dvh] */
    <PageContainer>
      {/* 2. Scrollable Content Area */}
      {
        <div className="pb-safe">
          {" "}
          {isLoadingFlight ? (
            <div className="container mx-auto px-3 py-3">
              <Card className="bg-card border-border">
                <CardContent className="p-6 space-y-4">
                  <Skeleton className="h-8 w-48" />
                  <div className="grid grid-cols-3 gap-4">
                    <Skeleton className="h-10" />
                    <Skeleton className="h-10" />
                    <Skeleton className="h-10" />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <Skeleton className="h-10" />
                    <Skeleton className="h-10" />
                  </div>
                </CardContent>
              </Card>
            </div>
          ) : (
            <FlightForm
              onFlightAdded={handleFlightAdded}
              onClose={handleClose}
              editingFlight={editingFlight}
              selectedAirportField={isAirportField ? selectedField : null}
              selectedAirportCode={isAirportField ? selectedAirport : null}
              selectedAircraftReg={isAircraftField ? selectedAircraftReg : null}
              selectedAircraftType={
                isAircraftField ? selectedAircraftType : null
              }
              selectedCrewField={isCrewField ? crewFieldMapped : null}
              selectedCrewId={isCrewField ? selectedCrewId : null}
              selectedCrewName={isCrewField ? selectedCrewName : null}
            />
          )}
        </div>
      }
    </PageContainer>
  );
}

export default function NewFlightPage() {
  return (
    <Suspense
      fallback={
        <PageContainer>
          {
            <Card className="bg-card border-border">
              <CardContent className="p-6">
                <Skeleton className="h-8 w-48 mb-4" />
                <Skeleton className="h-64" />
              </CardContent>
            </Card>
          }
        </PageContainer>
      }
    >
      <NewFlightContent />
    </Suspense>
  );
}
