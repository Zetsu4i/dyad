import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { SettingField } from "@/components/settings/SettingField";
import { useSettings } from "@/hooks/useSettings";
import { showError, showSuccess } from "@/lib/toast";
import { ipc } from "@/ipc/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Eye, EyeOff, Loader2, ShieldCheck, ExternalLink } from "lucide-react";

/**
 * E2B remote sandbox configuration: API key (BYO), sandbox template, and
 * session timeout. The key is stored through the settings secret store
 * (encrypted with Electron safeStorage) — never in project code or logs.
 */
export function E2bSettingsSection() {
  const { settings, updateSettings } = useSettings();
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [isValidating, setIsValidating] = useState(false);

  const hasStoredKey = !!settings?.e2b?.apiKey?.value;
  const isE2bMode = settings?.runtimeMode2 === "e2b";
  const timeoutMinutes = settings?.e2b?.timeoutMinutes ?? 60;
  const sandboxTemplate = settings?.e2b?.sandboxTemplate ?? "base";

  const validateMutation = useMutation({
    mutationFn: async (apiKey: string) => {
      return ipc.e2b.validateApiKey({ apiKey });
    },
  });

  const handleSaveKey = async () => {
    const trimmed = apiKeyInput.trim();
    if (!trimmed) {
      showError("Enter an E2B API key first.");
      return;
    }
    setIsValidating(true);
    try {
      const result = await validateMutation.mutateAsync(trimmed);
      if (!result.valid) {
        showError(
          `E2B API key validation failed: ${result.error ?? "unknown error"}`,
        );
        return;
      }
      await updateSettings({
        e2b: {
          ...(settings?.e2b ?? {}),
          apiKey: {
            value: trimmed,
            encryptionType: "plaintext",
          },
        },
      });
      setApiKeyInput("");
      setShowKey(false);
      showSuccess(
        result.sandboxCount !== undefined
          ? `E2B API key saved. ${result.sandboxCount} sandbox(es) currently on the account.`
          : "E2B API key saved.",
      );
    } catch (error: any) {
      showError(`Failed to save E2B API key: ${error.message}`);
    } finally {
      setIsValidating(false);
    }
  };

  const handleRemoveKey = async () => {
    try {
      await updateSettings({
        e2b: {
          ...(settings?.e2b ?? {}),
          apiKey: undefined,
        },
      });
      showSuccess("E2B API key removed.");
    } catch (error: any) {
      showError(`Failed to remove key: ${error.message}`);
    }
  };

  const handleTimeoutChange = async (value: string) => {
    const minutes = Number.parseInt(value, 10);
    if (Number.isNaN(minutes) || minutes < 5 || minutes > 1440) {
      return;
    }
    try {
      await updateSettings({
        e2b: { ...(settings?.e2b ?? {}), timeoutMinutes: minutes },
      });
    } catch (error: any) {
      showError(`Failed to update sandbox timeout: ${error.message}`);
    }
  };

  const handleTemplateChange = async (value: string) => {
    const trimmed = value.trim() || "base";
    try {
      await updateSettings({
        e2b: { ...(settings?.e2b ?? {}), sandboxTemplate: trimmed },
      });
    } catch (error: any) {
      showError(`Failed to update sandbox template: ${error.message}`);
    }
  };

  return (
    <div className="space-y-5">
      <SettingField
        htmlFor="e2b-api-key"
        label="E2B API Key"
        description={
          <>
            Your own E2B API key — sandboxes run and bill against your E2B
            account. Create one at{" "}
            <button
              type="button"
              className="underline font-medium cursor-pointer text-primary inline-flex items-center gap-1"
              onClick={() =>
                ipc.system.openExternalUrl("https://e2b.dev/dashboard?api-key")
              }
            >
              e2b.dev <ExternalLink className="size-3" />
            </button>
            . The key is encrypted at rest and never appears in agent chats,
            generated project code, or logs.
          </>
        }
      >
        <div className="space-y-2.5">
          <div className="flex gap-2 max-w-xl">
            <div className="relative flex-1">
              <Input
                id="e2b-api-key"
                type={showKey ? "text" : "password"}
                placeholder={
                  hasStoredKey
                    ? "•••••••••••••••••• (saved — enter a new key to replace)"
                    : "e2b_..."
                }
                value={apiKeyInput}
                onChange={(event) => setApiKeyInput(event.target.value)}
                autoComplete="off"
                spellCheck={false}
                className="pr-10 font-mono text-[13px]"
              />
              <button
                type="button"
                aria-label={showKey ? "Hide API key" : "Show API key"}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                onClick={() => setShowKey((visible) => !visible)}
              >
                {showKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
            <Button
              onClick={handleSaveKey}
              disabled={isValidating || !apiKeyInput.trim()}
            >
              {isValidating ? (
                <>
                  <Loader2 className="size-4 animate-spin" /> Validating
                </>
              ) : (
                <>
                  <ShieldCheck className="size-4" /> Save & Validate
                </>
              )}
            </Button>
          </div>
          {hasStoredKey && (
            <div className="flex items-center gap-3 text-[13px] text-muted-foreground">
              <span className="inline-flex items-center gap-1.5 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-emerald-600 dark:text-emerald-400">
                <ShieldCheck className="size-3" /> Key saved
              </span>
              <button
                type="button"
                className="underline font-medium cursor-pointer text-destructive/90 hover:text-destructive"
                onClick={handleRemoveKey}
              >
                Remove key
              </button>
            </div>
          )}
        </div>
      </SettingField>

      <SettingField
        htmlFor="e2b-sandbox-template"
        label="Sandbox Template"
        description="E2B template used for new sandboxes. “base” ships Node 22 + common runtimes; custom template IDs from your E2B account also work."
      >
        <Input
          id="e2b-sandbox-template"
          type="text"
          defaultValue={sandboxTemplate}
          placeholder="base"
          className="w-full sm:w-[240px] font-mono text-[13px]"
          onBlur={(event) => {
            const value = event.target.value.trim();
            if (value && value !== sandboxTemplate) {
              void handleTemplateChange(value);
            }
          }}
        />
      </SettingField>

      <SettingField
        htmlFor="e2b-timeout"
        label="Session Timeout (minutes)"
        description="Wall-clock safety net: after this long without activity, a sandbox auto-pauses (filesystem persists, compute billing stops). Leaving a project or closing Dyad pauses sandboxes immediately."
      >
        <select
          id="e2b-timeout"
          value={timeoutMinutes}
          onChange={(event) => void handleTimeoutChange(event.target.value)}
          className="w-full sm:w-[240px] rounded-md border border-input bg-background px-3 py-2 text-sm shadow-xs"
        >
          {[15, 30, 60, 120, 240, 480, 1440].map((minutes) => (
            <option key={minutes} value={minutes}>
              {minutes >= 60
                ? `${Math.floor(minutes / 60)} hour${minutes >= 120 ? "s" : ""}`
                : `${minutes} minutes`}
            </option>
          ))}
        </select>
      </SettingField>

      {isE2bMode && (
        <div className="text-[13px] text-muted-foreground bg-muted/40 border border-border/50 rounded-lg p-3 max-w-2xl">
          <b className="text-foreground">E2B runtime mode is active.</b> Apps
          run in remote sandboxes: dependency installs, dev servers, builds and
          agent shell commands execute inside the project's sandbox. Previews
          are served from the sandbox's public URL. Projects pause when you
          leave them and restore on reopen.
        </div>
      )}
    </div>
  );
}
