"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import { PageContainer } from "@/components/page-container";
import { PageLoading } from "@/components/ui/page-loading";
import { GlassIconButton, GlassTextButton } from "@/components/ui/glass-icon-button";
import { useRegisterMainActions } from "@/hooks/use-page-actions";
import { useCrewForm } from "@/hooks/use-crew-form";
import { CrewFormBody } from "@/components/crew-form-body";
import { ChevronLeft, Loader2 } from "lucide-react";
import { useRouter, useParams, useSearchParams } from "next/navigation";
import { assignCrewToFlight } from "@/lib/db";
import { syncService } from "@/lib/sync";

/**
 * `/crew/<id>` is an old deep link: every crew card opens in the crew page's
 * DETAIL panel — beside the list on a tablet, the overlay on a phone — so it
 * only hands the id over as `?selected=` (and `/crew/new` as `?new=1`), as
 * `/aircraft/<reg>` and `/airports/<icao>` do. On a phone it used to draw a
 * second copy of the card with its own header buttons.
 *
 * The one flow that keeps a page is creating a crew member FROM A FLIGHT's
 * crew picker (`?field=`): it returns to the flight with the new card seated.
 */
export default function CrewDetailPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const id = params.id as string;
  const fieldType = searchParams.get("field");
  const router = useRouter();
  const pickerCreate = id === "new" && !!fieldType;

  useEffect(() => {
    if (pickerCreate || !id) return;
    router.replace(id === "new" ? "/crew?new=1" : `/crew?selected=${encodeURIComponent(id)}`);
  }, [pickerCreate, id, router]);

  if (!pickerCreate) return <PageLoading />;
  return <PickerCreateCrew fieldType={fieldType} />;
}

function PickerCreateCrew({ fieldType }: { fieldType: string }) {
  const searchParams = useSearchParams();
  const returnUrl = searchParams.get("return") || "/logbook";
  const flightId = searchParams.get("flightId");
  const router = useRouter();

  const form = useCrewForm({
    id: "new",
    isNew: true,
    onSaved: (saved) => {
      if (!saved) return;
      if (flightId) {
        // Put them on the flight, then step back past the picker to the form
        // (form → picker → new).
        void assignCrewToFlight(flightId, fieldType, saved)
          .then(() => syncService.notifyDataChange())
          .catch((error) => console.error("Failed to update flight with crew:", error))
          .finally(() => window.history.go(-2));
      } else {
        const next = new URLSearchParams();
        next.set("field", fieldType);
        next.set("crewId", saved.id);
        next.set("crewName", saved.isMe ? "Self" : saved.name);
        router.push(`${returnUrl}?${next.toString()}`);
      }
    },
  });
  const { isLoading, isSaving, isDirty, formData } = form;

  // The latest save behind a ref, so the memoised glass actions stay stable
  // across keystrokes.
  const saveRef = useRef(form.handleSave);
  useEffect(() => {
    saveRef.current = form.handleSave;
  });

  const back = useCallback(() => router.back(), [router]);
  const canSave = !!formData.name.trim();

  // Back while untouched; Cancel + Save once something is typed — the same
  // header a detail form carries.
  const actions = useMemo(
    () =>
      isDirty ? (
        <>
          <GlassTextButton onClick={back}>Cancel</GlassTextButton>
          <GlassTextButton primary disabled={!canSave || isSaving} onClick={() => saveRef.current()}>
            {isSaving ? <Loader2 className="h-5 w-5 animate-spin" /> : "Save"}
          </GlassTextButton>
        </>
      ) : (
        <GlassIconButton ariaLabel="Back" onClick={back}>
          <ChevronLeft className="h-5 w-5" />
        </GlassIconButton>
      ),
    [isDirty, canSave, isSaving, back]
  );
  useRegisterMainActions(actions, true);

  if (isLoading) {
    return (
      <PageContainer>
        <PageLoading />
      </PageContainer>
    );
  }

  return (
    <PageContainer title="New Crew Member">
      <div className="space-y-4 px-panel pt-4">
        <CrewFormBody
          formData={formData}
          existingSelfId={form.existingSelfId}
          updateField={form.updateField}
          handleIsMeChange={form.handleIsMeChange}
          toggleRole={form.toggleRole}
        />
      </div>
    </PageContainer>
  );
}
