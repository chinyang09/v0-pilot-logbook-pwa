"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageContainer } from "@/components/page-container";
import { ArrowLeft, Loader2, Search } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  addCustomAircraftToDatabase,
  updateFlight,
} from "@/lib/db";
import { syncService } from "@/lib/sync";
import { submitAircraftToServer } from "@/lib/submissions/submit";
import { searchAircraftTypes } from "@/lib/db/stores/reference/aircraft-types.store";
import type { AircraftType } from "@/types/entities/aircraft-type.types";
import type { AircraftRecord } from "@/types/entities/aircraft.types";
import { formatAircraftType } from "@/lib/utils/aircraft-type-utils";

// --- Reusable Row (matches crew page pattern) ---
function SettingsRow({
  label,
  value,
  onChange,
  placeholder,
  required = false,
}: {
  label: string;
  value: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  required?: boolean;
}) {
  return (
    <div className="flex items-center justify-between py-3 border-b border-border last:border-b-0">
      <span className="text-foreground">
        {label}
        {required && <span className="text-destructive ml-0.5">*</span>}
      </span>
      <Input
        value={value}
        onChange={(e) => onChange?.(e.target.value)}
        placeholder={placeholder}
        className="text-right border-0 bg-transparent h-auto p-0 w-auto max-w-[200px] text-muted-foreground placeholder:text-muted-foreground/50 focus-visible:ring-0 uppercase"
      />
    </div>
  );
}

function ReadOnlyRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-3 border-b border-border last:border-b-0">
      <span className="text-foreground">{label}</span>
      <span className="text-muted-foreground">{value || "-"}</span>
    </div>
  );
}

export default function NewAircraftPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const prefilledReg = searchParams.get("reg") || "";
  const selectMode = searchParams.get("select") === "true";
  const flightId = searchParams.get("flightId");

  const [isSaving, setIsSaving] = useState(false);
  const [registration, setRegistration] = useState(prefilledReg.toUpperCase());
  const [typecode, setTypecode] = useState("");
  const [typeSearchQuery, setTypeSearchQuery] = useState("");
  const [typeSearchResults, setTypeSearchResults] = useState<AircraftType[]>([]);
  const [selectedType, setSelectedType] = useState<AircraftType | null>(null);
  const [showTypeSearch, setShowTypeSearch] = useState(false);

  // FR24 inline search state
  const [fr24Result, setFr24Result] = useState<{
    registration: string;
    typecode: string;
    icao24: string;
    operator: string;
  } | null>(null);
  const [isFr24Loading, setIsFr24Loading] = useState(false);
  const [fr24Searched, setFr24Searched] = useState(false);

  // Auto-search FR24 when registration changes (debounced)
  useEffect(() => {
    const reg = registration.trim();
    if (reg.length < 3) {
      setFr24Result(null);
      setFr24Searched(false);
      return;
    }

    setFr24Searched(false);
    const timer = setTimeout(async () => {
      setIsFr24Loading(true);
      try {
        const res = await fetch(
          `/api/search/aircraft?q=${encodeURIComponent(reg)}`,
          { signal: AbortSignal.timeout(5000) }
        );
        if (res.ok) {
          const data = await res.json();
          const match = data.results?.[0] || null;
          setFr24Result(match);
        } else {
          setFr24Result(null);
        }
      } catch {
        setFr24Result(null);
      } finally {
        setIsFr24Loading(false);
        setFr24Searched(true);
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [registration]);

  // Search aircraft types when typecode changes
  useEffect(() => {
    if (!typeSearchQuery || typeSearchQuery.length < 1) {
      setTypeSearchResults([]);
      return;
    }

    const search = async () => {
      const results = await searchAircraftTypes(typeSearchQuery, 20);
      setTypeSearchResults(results);
    };
    const timer = setTimeout(search, 200);
    return () => clearTimeout(timer);
  }, [typeSearchQuery]);

  const handleUseFr24 = useCallback(() => {
    if (!fr24Result) return;
    setRegistration(fr24Result.registration);
    if (fr24Result.typecode) {
      setTypecode(fr24Result.typecode);
      setTypeSearchQuery(fr24Result.typecode);
    }
    setFr24Result(null);
    setFr24Searched(false);
  }, [fr24Result]);

  const handleSelectType = useCallback((type: AircraftType) => {
    setSelectedType(type);
    setTypecode(type.designator);
    setShowTypeSearch(false);
    setTypeSearchQuery("");
    setTypeSearchResults([]);
  }, []);

  const handleSave = async () => {
    const reg = registration.trim().toUpperCase();
    if (!reg) return;

    setIsSaving(true);
    try {
      const record: AircraftRecord = {
        registration: reg,
        icao24: fr24Result?.icao24 || "",
        typecode: typecode.trim().toUpperCase(),
        operator: fr24Result?.operator || "",
        source: fr24Result ? "fr24" : "custom",
      };

      const submissionId = await addCustomAircraftToDatabase(record);

      // Fire-and-forget server submission for enrichment
      submitAircraftToServer({
        submissionId,
        registration: reg,
        typecode: record.typecode,
      });

      if (selectMode && flightId) {
        await updateFlight(flightId, {
          aircraftReg: reg,
          aircraftType: record.typecode || "",
        });
        syncService.notifyDataChange();
        router.back();
      } else {
        router.back();
      }
    } catch (error) {
      console.error("Failed to save aircraft:", error);
    } finally {
      setIsSaving(false);
    }
  };

  const handleCancel = () => {
    router.back();
  };

  return (
    <PageContainer
      header={
        <header className="bg-background/30 backdrop-blur-xl border-b border-border/50 z-50">
          <div className="container mx-auto px-3">
            <div className="flex items-center justify-between h-12">
              <Button
                variant="ghost"
                size="sm"
                onClick={handleCancel}
                className="text-primary h-8 px-2"
              >
                Cancel
              </Button>
              <h1 className="text-lg font-semibold truncate px-2">
                New Aircraft
              </h1>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleSave}
                disabled={!registration.trim() || isSaving}
                className="text-primary h-8 px-2 font-semibold"
              >
                {isSaving ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  "Save"
                )}
              </Button>
            </div>
          </div>
        </header>
      }
    >
      <div className="container mx-auto px-3 pt-4 pb-safe">
        {/* Main Info Card */}
        <div className="bg-card rounded-xl overflow-hidden mb-6 border border-border">
          <div className="px-4">
            <SettingsRow
              label="Registration"
              value={registration}
              onChange={setRegistration}
              placeholder="e.g. 9V-TNK"
              required
            />

            {/* FR24 auto-search result banner */}
            {isFr24Loading && registration.trim().length >= 3 && (
              <div className="flex items-center gap-2 px-0 py-2.5 border-b border-border text-xs text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" />
                Searching FlightRadar24...
              </div>
            )}
            {!isFr24Loading && fr24Result && (
              <div className="py-2.5 border-b border-border">
                <div className="flex items-center justify-between">
                  <div className="text-xs">
                    <span className="text-primary font-medium">Found: </span>
                    <span className="text-foreground font-semibold">{fr24Result.registration}</span>
                    {fr24Result.typecode && (
                      <span className="text-muted-foreground"> ({fr24Result.typecode})</span>
                    )}
                    {fr24Result.operator && (
                      <span className="text-muted-foreground"> — {fr24Result.operator}</span>
                    )}
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleUseFr24}
                    className="text-primary h-6 px-2 text-xs font-semibold"
                  >
                    Use
                  </Button>
                </div>
              </div>
            )}
            {!isFr24Loading && !fr24Result && fr24Searched && registration.trim().length >= 3 && (
              <div className="py-2.5 border-b border-border text-xs text-muted-foreground">
                Not found on FlightRadar24 — enter details manually below.
              </div>
            )}

            <div className="py-3 border-b border-border">
              <div className="flex items-center justify-between">
                <span className="text-foreground">Type Code</span>
                <div className="flex items-center gap-2">
                  <Input
                    value={typecode}
                    onChange={(e) => {
                      const val = e.target.value.toUpperCase();
                      setTypecode(val);
                      setTypeSearchQuery(val);
                      setShowTypeSearch(true);
                      if (!val) setSelectedType(null);
                    }}
                    onFocus={() => {
                      if (typecode) {
                        setTypeSearchQuery(typecode);
                        setShowTypeSearch(true);
                      }
                    }}
                    placeholder="e.g. A359"
                    className="text-right border-0 bg-transparent h-auto p-0 w-auto max-w-[150px] text-muted-foreground placeholder:text-muted-foreground/50 focus-visible:ring-0 uppercase"
                  />
                </div>
              </div>

              {/* Type search results dropdown */}
              {showTypeSearch && typeSearchResults.length > 0 && (
                <div className="mt-2 max-h-48 overflow-y-auto rounded-lg border border-border bg-background">
                  {typeSearchResults.map((type) => (
                    <button
                      key={type.designator}
                      type="button"
                      onClick={() => handleSelectType(type)}
                      className="w-full text-left px-3 py-2 hover:bg-accent border-b border-border last:border-b-0 transition-colors"
                    >
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-sm text-foreground">
                          {type.designator}
                        </span>
                        <span className="text-xs text-primary bg-primary/10 px-1.5 py-0.5 rounded">
                          {type.description}
                        </span>
                        {type.wtc && (
                          <span className="text-xs text-muted-foreground">
                            WTC: {type.wtc}
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {formatAircraftType(type)}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Auto-populated type info */}
            {selectedType && (
              <>
                <ReadOnlyRow
                  label="Manufacturer"
                  value={selectedType.manufacturer}
                />
                <ReadOnlyRow label="Model" value={selectedType.model} />
                <ReadOnlyRow
                  label="Category"
                  value={`${selectedType.category} · ${selectedType.engineCount} × ${selectedType.engineType}`}
                />
                <ReadOnlyRow label="WTC" value={selectedType.wtc} />
              </>
            )}
          </div>
        </div>

        <p className="text-xs text-muted-foreground px-4">
          Enter the aircraft registration. Optionally, search for the ICAO type
          code to auto-populate aircraft details.
        </p>
      </div>
    </PageContainer>
  );
}
