"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { PageContainer } from "@/components/page-container";
import {
  getPersonnelById,
  updatePersonnel,
  addPersonnel,
  getAllPersonnel,
  type Personnel,
} from "@/lib/indexed-db";
import { ArrowLeft, Loader2, ChevronRight } from "lucide-react";
import { useRouter, useParams, useSearchParams } from "next/navigation";
import { mutate } from "swr";
import { CACHE_KEYS } from "@/hooks/use-indexed-db";

const ROLE_OPTIONS = ["PIC", "SIC", "Instructor", "Examiner"] as const;

// --- Reusable Rows (Internal to this file) ---
function SettingsRow({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  readOnly = false,
}: {
  label: string;
  value: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  type?: string;
  readOnly?: boolean;
}) {
  return (
    <div className="flex items-center justify-between py-3 border-b border-border last:border-b-0">
      <span className="text-foreground">{label}</span>
      {readOnly ? (
        <span className="text-muted-foreground">{value || "-"}</span>
      ) : (
        <Input
          type={type}
          value={value}
          onChange={(e) => onChange?.(e.target.value)}
          placeholder={placeholder}
          className="text-right border-0 bg-transparent h-auto p-0 w-auto max-w-[200px] text-muted-foreground placeholder:text-muted-foreground/50 focus-visible:ring-0"
        />
      )}
    </div>
  );
}

function ToggleRow({
  label,
  checked,
  onCheckedChange,
  readOnly = false,
  disabled = false,
}: {
  label: string;
  checked: boolean;
  onCheckedChange?: (checked: boolean) => void;
  readOnly?: boolean;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center justify-between py-3 border-b border-border last:border-b-0">
      <span className={disabled ? "text-muted-foreground" : "text-foreground"}>
        {label}
      </span>
      <Switch
        checked={checked}
        onCheckedChange={readOnly ? undefined : onCheckedChange}
        disabled={readOnly || disabled}
      />
    </div>
  );
}

// --- Main Component ---
export default function CrewDetailPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const id = params.id as string;
  const isNew = id === "new";
  const fieldType = searchParams.get("field");
  const returnUrl = searchParams.get("return") || "/new-flight";
  const router = useRouter();

  const [crew, setCrew] = useState<Personnel | null>(null);
  const [isLoading, setIsLoading] = useState(!isNew);
  const [isSaving, setIsSaving] = useState(false);
  const [isEditing, setIsEditing] = useState(isNew);
  const [existingSelfId, setExistingSelfId] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    name: "",
    crewId: "",
    organization: "",
    roles: [] as ("PIC" | "SIC" | "Instructor" | "Examiner")[],
    licenceNumber: "",
    email: "",
    phone: "",
    comment: "",
    isMe: false,
    favorite: false,
    defaultPIC: false,
    defaultSIC: false,
  });

  useEffect(() => {
    const loadData = async () => {
      const allPersonnel = await getAllPersonnel();
      const selfCrew = allPersonnel.find((p) => p.isMe && p.id !== id);
      setExistingSelfId(selfCrew?.id || null);

      if (isNew) {
        setIsLoading(false);
        return;
      }

      try {
        const data = await getPersonnelById(id);
        if (data) {
          setCrew(data);
          setFormData({
            name: data.name || "",
            crewId: data.crewId || "",
            organization: data.organization || "",
            roles: data.roles || [],
            licenceNumber: data.licenceNumber || "",
            email: data.contact?.email || "",
            phone: data.contact?.phone || "",
            comment: data.comment || "",
            isMe: data.isMe || false,
            favorite: data.favorite || false,
            defaultPIC: data.defaultPIC || false,
            defaultSIC: data.defaultSIC || false,
          });
        }
      } catch (error) {
        console.error("Failed to load crew:", error);
      } finally {
        setIsLoading(false);
      }
    };
    loadData();
  }, [id, isNew]);

  const updateField = useCallback(
    (field: string, value: string | boolean | string[]) => {
      setFormData((prev) => ({ ...prev, [field]: value }));
    },
    []
  );

  const handleIsMeChange = useCallback(
    async (checked: boolean) => {
      if (checked && existingSelfId) {
        await updatePersonnel(existingSelfId, { isMe: false });
        setExistingSelfId(null);
      }
      setFormData((prev) => ({ ...prev, isMe: checked }));
    },
    [existingSelfId]
  );

  const handleSave = async () => {
    if (!formData.name.trim()) return;

    setIsSaving(true);
    try {
      if (formData.isMe && existingSelfId) {
        await updatePersonnel(existingSelfId, { isMe: false });
      }

      const personnelData = {
        name: formData.name.trim(),
        crewId: formData.crewId.trim() || undefined,
        organization: formData.organization.trim() || undefined,
        roles: formData.roles.length > 0 ? formData.roles : undefined,
        licenceNumber: formData.licenceNumber.trim() || undefined,
        contact:
          formData.email.trim() || formData.phone.trim()
            ? {
                email: formData.email.trim() || undefined,
                phone: formData.phone.trim() || undefined,
              }
            : undefined,
        comment: formData.comment.trim() || undefined,
        isMe: formData.isMe,
        favorite: formData.favorite,
        defaultPIC: formData.defaultPIC,
        defaultSIC: formData.defaultSIC,
      };

      let savedCrew: Personnel | null = null;

      if (isNew) {
        savedCrew = await addPersonnel(personnelData);
      } else if (crew) {
        savedCrew = await updatePersonnel(crew.id, personnelData);
        setCrew(savedCrew);
      }

      await mutate(CACHE_KEYS.personnel);

      if (fieldType && savedCrew) {
        const params = new URLSearchParams();
        params.set("field", fieldType);
        params.set("crewId", savedCrew.id);
        params.set("crewName", savedCrew.isMe ? "Self" : savedCrew.name);
        router.push(`${returnUrl}?${params.toString()}`);
      } else if (isNew) {
        router.push("/crew");
      } else {
        setIsEditing(false);
      }
    } catch (error) {
      console.error("Failed to save crew:", error);
    } finally {
      setIsSaving(false);
    }
  };

  const handleCancel = () => {
    if (isNew) {
      router.back();
    } else if (isEditing && crew) {
      setFormData({
        name: crew.name || "",
        crewId: crew.crewId || "",
        organization: crew.organization || "",
        roles: crew.roles || [],
        licenceNumber: crew.licenceNumber || "",
        email: crew.contact?.email || "",
        phone: crew.contact?.phone || "",
        comment: crew.comment || "",
        isMe: crew.isMe || false,
        favorite: crew.favorite || false,
        defaultPIC: crew.defaultPIC || false,
        defaultSIC: crew.defaultSIC || false,
      });
      setIsEditing(false);
    } else {
      router.back();
    }
  };

  const toggleRole = useCallback((role: (typeof ROLE_OPTIONS)[number]) => {
    setFormData((prev) => ({
      ...prev,
      roles: prev.roles.includes(role)
        ? prev.roles.filter((r) => r !== role)
        : [...prev.roles, role],
    }));
  }, []);

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
        <header className="flex-none bg-background/95 backdrop-blur-lg border-b border-border z-50">
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
                  onClick={handleSave}
                  disabled={!formData.name.trim() || isSaving}
                  className="text-primary h-8 px-2 font-semibold"
                >
                  {isSaving ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    "Save"
                  )}
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
      {/* 3. SCROLLABLE CONTENT: Main fills space and scrolls internally */}

      {
        <div className="container mx-auto px-3 pt-4 pb-safe">
          {" "}
          {!isNew && !crew ? (
            <p className="text-center text-muted-foreground py-12">
              Crew member not found
            </p>
          ) : (
            <>
              {/* Main Info Card */}
              <div className="bg-card rounded-xl overflow-hidden mb-6 border border-border">
                <div className="px-4">
                  <SettingsRow
                    label="Name"
                    value={formData.name}
                    onChange={(value) => updateField("name", value)}
                    placeholder="Required"
                    readOnly={!isEditing}
                  />
                  <SettingsRow
                    label="ID"
                    value={formData.crewId}
                    onChange={(value) => updateField("crewId", value)}
                    placeholder="Crew ID"
                    readOnly={!isEditing}
                  />
                  <SettingsRow
                    label="Organization"
                    value={formData.organization}
                    onChange={(value) => updateField("organization", value)}
                    placeholder="Company"
                    readOnly={!isEditing}
                  />
                  <SettingsRow
                    label="Licence Number"
                    value={formData.licenceNumber}
                    onChange={(value) => updateField("licenceNumber", value)}
                    placeholder="Licence #"
                    readOnly={!isEditing}
                  />

                  {/* Type/Roles */}
                  <div className="py-3 border-b border-border">
                    <span className="text-foreground block mb-2">Type</span>
                    {isEditing ? (
                      <div className="flex flex-wrap gap-2">
                        {ROLE_OPTIONS.map((role) => (
                          <Button
                            key={role}
                            type="button"
                            variant={
                              formData.roles.includes(role)
                                ? "default"
                                : "outline"
                            }
                            size="sm"
                            onClick={() => toggleRole(role)}
                            className="h-8"
                          >
                            {role}
                          </Button>
                        ))}
                      </div>
                    ) : (
                      <span className="text-muted-foreground">
                        {formData.roles.length > 0
                          ? formData.roles.join(", ")
                          : "-"}
                      </span>
                    )}
                  </div>

                  <ToggleRow
                    label="This is Me"
                    checked={formData.isMe}
                    onCheckedChange={handleIsMeChange}
                    readOnly={!isEditing}
                  />
                  {isEditing && existingSelfId && !formData.isMe && (
                    <p className="text-xs text-muted-foreground -mt-2 mb-2 px-1">
                      Another crew member is already marked as "Self". Enabling
                      this will remove that designation.
                    </p>
                  )}

                  <SettingsRow
                    label="Email"
                    value={formData.email}
                    onChange={(value) => updateField("email", value)}
                    placeholder="email@example.com"
                    type="email"
                    readOnly={!isEditing}
                  />
                  <SettingsRow
                    label="Phone"
                    value={formData.phone}
                    onChange={(value) => updateField("phone", value)}
                    placeholder="+1 234 567 8900"
                    type="tel"
                    readOnly={!isEditing}
                  />

                  {/* Comment */}
                  <div className="flex items-center justify-between py-3">
                    <span className="text-foreground">Comment</span>
                    <div className="flex items-center gap-2">
                      {isEditing ? (
                        <Input
                          value={formData.comment}
                          onChange={(e) =>
                            updateField("comment", e.target.value)
                          }
                          placeholder="Add comment"
                          className="text-right border-0 bg-transparent h-auto p-0 w-auto max-w-[150px] text-muted-foreground placeholder:text-muted-foreground/50 focus-visible:ring-0"
                        />
                      ) : (
                        <span className="text-muted-foreground">
                          {formData.comment || "-"}
                        </span>
                      )}
                      {isEditing && (
                        <ChevronRight className="h-5 w-5 text-muted-foreground/50" />
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* Options Section */}
              <div className="mb-2">
                <span className="text-xs text-muted-foreground uppercase tracking-wider px-4">
                  Options
                </span>
              </div>
              <div className="bg-card rounded-xl overflow-hidden border border-border">
                <div className="px-4">
                  <ToggleRow
                    label="Favorite"
                    checked={formData.favorite}
                    onCheckedChange={(checked) =>
                      updateField("favorite", checked)
                    }
                    readOnly={!isEditing}
                  />
                  <ToggleRow
                    label="Default SIC"
                    checked={formData.defaultSIC}
                    onCheckedChange={(checked) =>
                      updateField("defaultSIC", checked)
                    }
                    readOnly={!isEditing}
                  />
                  <ToggleRow
                    label="Default PIC"
                    checked={formData.defaultPIC}
                    onCheckedChange={(checked) =>
                      updateField("defaultPIC", checked)
                    }
                    readOnly={!isEditing}
                  />
                </div>
              </div>
            </>
          )}
        </div>
      }
    </PageContainer>
  );
}
