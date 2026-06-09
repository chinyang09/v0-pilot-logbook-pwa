"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { PageContainer } from "@/components/page-container";
import { useCrewForm } from "@/hooks/use-crew-form";
import { CrewFormBody } from "@/components/crew-form-body";
import { ArrowLeft, Loader2 } from "lucide-react";
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

  const handleCancel = () => {
    if (isNew) {
      router.back();
    } else if (isEditing && crew) {
      form.resetForm();
    } else {
      router.back();
    }
  };

  if (isLoading) {
    return (
      <div className="h-[100dvh] flex items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

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
                {isEditing ? "Cancel" : <ArrowLeft className="h-4 w-4" />}
              </Button>
              <h1 className="text-lg font-semibold truncate px-2">
                {!crew && !isNew
                  ? "Crew Not Found"
                  : isNew
                  ? "New Crew"
                  : formData.isMe
                  ? "Self"
                  : formData.name || "Crew Info"}
              </h1>
              {isEditing ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => form.handleSave()}
                  disabled={!formData.name.trim() || isSaving}
                  className="text-primary h-8 px-2 font-semibold"
                >
                  {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}
                </Button>
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setIsEditing(true)}
                  className="text-primary h-8 px-2 font-semibold"
                >
                  Edit
                </Button>
              )}
            </div>
          </div>
        </header>
      }
    >
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
