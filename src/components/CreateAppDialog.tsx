import { useTranslation } from "react-i18next";
import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useCreateApp } from "@/hooks/useCreateApp";
import { useCheckName } from "@/hooks/useCheckName";
import { useAppFolderPreview } from "@/hooks/useAppFolderPreview";
import { useDebounce } from "@/hooks/useDebounce";
import {
  NEON_TEMPLATE_IDS,
  Template,
  templatesForMode,
} from "@/shared/templates";
import { useTemplates } from "@/hooks/useTemplates";
import type { AppMode } from "@/lib/schemas";
import { useSelectChat } from "@/hooks/useSelectChat";

import { Loader2 } from "lucide-react";
import { neonTemplateHook } from "@/client_logic/template_hook";
import { showError } from "@/lib/toast";

interface CreateAppDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  template: Template | undefined;
}

export function CreateAppDialog({
  open,
  onOpenChange,
  template,
}: CreateAppDialogProps) {
  const { t } = useTranslation(["home", "common"]);
  const [appName, setAppName] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [mode, setMode] = useState<AppMode>("web");
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(
    null,
  );
  const { createApp } = useCreateApp();
  const { templates: allTemplates } = useTemplates();
  const trimmedAppName = appName.trim();
  const debouncedAppName = useDebounce(trimmedAppName, 150);
  const { data: nameCheckResult, isLoading: isCheckingName } =
    useCheckName(debouncedAppName);
  const { data: folderPreview } = useAppFolderPreview(debouncedAppName);
  const { selectChat } = useSelectChat();
  const modeTemplates = templatesForMode(allTemplates ?? [], mode);
  const effectiveTemplate =
    modeTemplates.find(
      (candidate) => candidate.id === selectedTemplateId,
    ) ??
    template ??
    modeTemplates[0];
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!appName.trim()) {
      return;
    }

    if (nameCheckResult?.exists) {
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await createApp({
        name: appName.trim(),
        mode,
        templateId: effectiveTemplate?.id,
      });
      if (template && NEON_TEMPLATE_IDS.has(template.id)) {
        await neonTemplateHook({
          appId: result.app.id,
          appName: result.app.name,
        });
      }
      // Selecting the new chat seeds recent tab order immediately.
      selectChat({ chatId: result.chatId, appId: result.app.id });
      setAppName("");
      setSelectedTemplateId(null);
      onOpenChange(false);
    } catch (error) {
      showError(error as any);
      // Error is already handled by createApp hook or shown above
      console.error("Error creating app:", error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const isNameValid = trimmedAppName.length > 0;
  const queryMatchesInput = debouncedAppName === trimmedAppName;
  const nameExists = queryMatchesInput && nameCheckResult?.exists;
  const canSubmit =
    isNameValid &&
    queryMatchesInput &&
    !isCheckingName &&
    !nameExists &&
    !isSubmitting;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>{t("home:createNewApp")}</DialogTitle>
          <DialogDescription>
            {t("home:createAppUsingTemplate", { template: template?.title })}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit}>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label>Project mode</Label>
              <div className="grid grid-cols-3 gap-2">
                {(
                  [
                    { id: "web", label: "Web", hint: "Browser apps" },
                    { id: "mobile", label: "Mobile", hint: "Expo / React Native" },
                    { id: "general", label: "General", hint: "Sandbox workspace" },
                  ] as const
                ).map((option) => (
                  <button
                    type="button"
                    key={option.id}
                    onClick={() => {
                      setMode(option.id);
                      setSelectedTemplateId(null);
                    }}
                    className={`rounded-lg border p-2.5 text-left transition-colors ${
                      mode === option.id
                        ? "border-primary/60 bg-primary/10"
                        : "border-border/60 hover:bg-muted/60"
                    }`}
                  >
                    <div className="text-sm font-medium">{option.label}</div>
                    <div className="text-[11px] text-muted-foreground">
                      {option.hint}
                    </div>
                  </button>
                ))}
              </div>
            </div>

            <div className="grid gap-2">
              <Label>Template</Label>
              <div className="grid gap-2 max-h-52 overflow-y-auto pr-1">
                {modeTemplates.map((candidate) => (
                  <button
                    type="button"
                    key={candidate.id}
                    onClick={() => setSelectedTemplateId(candidate.id)}
                    className={`rounded-lg border p-3 text-left transition-colors ${
                      (effectiveTemplate?.id ?? "") === candidate.id
                        ? "border-primary/60 bg-primary/10"
                        : "border-border/60 hover:bg-muted/60"
                    }`}
                  >
                    <div className="text-sm font-medium">{candidate.title}</div>
                    <div className="text-[12px] text-muted-foreground">
                      {candidate.description}
                    </div>
                  </button>
                ))}
              </div>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="appName">{t("home:appName")}</Label>
              <Input
                id="appName"
                value={appName}
                onChange={(e) => setAppName(e.target.value)}
                placeholder={t("home:enterAppName")}
                className={nameExists ? "border-red-500" : ""}
                disabled={isSubmitting}
              />
              {nameExists && (
                <p className="text-sm text-red-500">
                  {t("home:appNameAlreadyExists")}
                </p>
              )}
              {!nameExists &&
                queryMatchesInput &&
                folderPreview &&
                folderPreview !== debouncedAppName && (
                  <p className="text-sm text-muted-foreground">
                    {t("home:appFolderPreview", {
                      folderName: folderPreview,
                    })}
                  </p>
                )}
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isSubmitting}
            >
              {t("common:cancel")}
            </Button>
            <Button
              type="submit"
              disabled={!canSubmit}
              className="bg-indigo-600 hover:bg-indigo-700"
            >
              {isSubmitting && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              {isSubmitting ? t("common:creating") : t("home:createApp")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
