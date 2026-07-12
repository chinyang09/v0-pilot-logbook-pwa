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
import { useIsDesktop } from "@/hooks/use-is-desktop";

export default function CrewDetailPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const id = params.id as string;
  const isNew = id === "new";
  const fieldType = searchParams.get("field");
  const returnUrl = searchParams.get("return") || "/logbook";
  const router = useRouter();
  const isDesktop = useIsDesktop();

  // When switching to desktop view, redirect to crew page with selection.
  // Skip for "new" crew creation which stays as a full page.
  useEffect(() => {
    if (isDesktop && !isNew && id) {
      router.replace(`/crew?selected=${encodeURIComponent(id)}`);
    }
  }, [isDesktop, isNew, id, router]);

  const form = useCrewForm({
    id,
    isNew,
    onSaved: (saved) => {
      if (fieldType && saved) {
        const params = new URLSearchParams();
        params.set("field", fieldType);
        params.set("crewId", saved.id);
        params.set("crewName", saved.isMe ? "Self" : saved.name);
        router.push(`${returnUrl}?${params.toString()}`);
      } else if (isNew) {
        router.push("/crew");
      }
    },
  });
  const { crew, isLoading, isEditing, isSaving, setIsEditing, formData } = form;

  // Latest handlers/state behind a ref (synced in an effect, read only inside
  // event handlers) so the memoised glass actions stay stable across keystrokes.
  const latestRef = useRef({
    save: form.handleSave,
    reset: form.resetForm,
    isNew,
    isEditing,
    hasCrew: !!crew,
  });
  useEffect(() => {
    latestRef.current = {
      save: form.handleSave,
      reset: form.resetForm,
      isNew,
      isEditing,
      hasCrew: !!crew,
    };
  });

  const handleCancel = useCallback(() => {
    const l = latestRef.current;
    if (l.isNew) {
      router.back();
    } else if (l.isEditing && l.hasCrew) {
      l.reset();
    } else {
      router.back();
    }
  }, [router]);

  // Floating glass header actions — same system as every other page (no
  // embedded page header). Editing/new: Cancel + Save; viewing: Back + Edit.
  const actions = useMemo(() => {
    if (isEditing) {
      return (
        <>
          <GlassTextButton onClick={handleCancel}>
            Cancel
          </GlassTextButton>
          <GlassTextButton
            primary
            disabled={!formData.name.trim() || isSaving}
            onClick={() => latestRef.current.save()}
          >
            {isSaving ? <Loader2 className="h-5 w-5 animate-spin" /> : "Save"}
          </GlassTextButton>
        </>
      );
    }
    return (
      <>
        <GlassIconButton ariaLabel="Back" onClick={handleCancel}>
          <ChevronLeft className="h-5 w-5" />
        </GlassIconButton>
        <GlassTextButton primary onClick={() => setIsEditing(true)}>
          Edit
        </GlassTextButton>
      </>
    );
  }, [isEditing, isSaving, formData.name, setIsEditing, handleCancel]);

  useRegisterMainActions(actions, true);

  if (isLoading) {
    return (
      <PageContainer>
        <PageLoading />
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <div className="container mx-auto px-2 pt-4 pb-safe">
        {!isNew && !crew ? (
          <p className="text-center text-muted-foreground py-12">
            Crew member not found
          </p>
        ) : (
          <CrewFormBody
            formData={formData}
            isEditing={isEditing}
            existingSelfId={form.existingSelfId}
            updateField={form.updateField}
            handleIsMeChange={form.handleIsMeChange}
            toggleRole={form.toggleRole}
          />
        )}
      </div>
    </PageContainer>
  );
}
