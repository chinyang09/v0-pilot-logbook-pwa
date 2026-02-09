"use client";

import { useState, useEffect, Suspense, useRef } from "react";
import { FlightForm } from "@/components/flight-form";
import { PageContainer } from "@/components/page-container";
import type { FlightLog } from "@/lib/db";
import { getFlightById, addFlight } from "@/lib/db";
import { syncService } from "@/lib/sync";
import { refreshAllData, useDBReady } from "@/hooks/data";
import { useRouter, useSearchParams } from "next/navigation";
import { Skeleton } from "@/components/ui/skeleton";
import { createEmptyFlightLog } from "@/lib/utils/flight-calculations";

const FORM_STORAGE_KEY = "flight-form-draft";

function NewFlightContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const editId = searchParams.get("edit");

  const { isReady: dbReady } = useDBReady();
  const [flightId, setFlightId] = useState<string | null>(null);
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
            setFlightId(flight.id);
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

      if (flightLoadedRef.current && flightId) {
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
              setFlightId(existingDraft.id);
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
        setFlightId(newDraft.id);
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

  return (
    <PageContainer>
      <div className="pb-safe">
        {isLoadingFlight || !flightId ? (
          <div className="h-full">
            <div className="h-12 bg-background/30 backdrop-blur-xl border-b border-border/50 px-4 flex items-center justify-between">
              <Skeleton className="h-5 w-24" />
              <Skeleton className="h-8 w-20" />
            </div>
            <div className="space-y-4 px-2 py-4">
              <div className="rounded-xl bg-card border border-border p-4 space-y-3">
                <Skeleton className="h-4 w-20" />
                <div className="grid grid-cols-3 gap-3">
                  <Skeleton className="h-10" />
                  <Skeleton className="h-10" />
                  <Skeleton className="h-10" />
                </div>
              </div>
              <div className="rounded-xl bg-card border border-border p-4 space-y-3">
                <Skeleton className="h-4 w-16" />
                <div className="grid grid-cols-2 gap-3">
                  <Skeleton className="h-10" />
                  <Skeleton className="h-10" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <Skeleton className="h-10" />
                  <Skeleton className="h-10" />
                </div>
              </div>
            </div>
          </div>
        ) : (
          <FlightForm
            key={flightId}
            flightId={flightId}
            onFlightAdded={handleFlightAdded}
            onClose={handleClose}
          />
        )}
      </div>
    </PageContainer>
  );
}

export default function NewFlightPage() {
  return (
    <Suspense
      fallback={
        <PageContainer>
          <div className="h-12 bg-background/30 backdrop-blur-xl border-b border-border/50 px-4 flex items-center justify-between">
            <Skeleton className="h-5 w-24" />
            <Skeleton className="h-8 w-20" />
          </div>
          <div className="space-y-4 px-2 py-4">
            <div className="rounded-xl bg-card border border-border p-4 space-y-3">
              <Skeleton className="h-4 w-20" />
              <div className="grid grid-cols-3 gap-3">
                <Skeleton className="h-10" />
                <Skeleton className="h-10" />
                <Skeleton className="h-10" />
              </div>
            </div>
          </div>
        </PageContainer>
      }
    >
      <NewFlightContent />
    </Suspense>
  );
}
