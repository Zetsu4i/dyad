import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Check,
  ChevronDown,
  KeyRound,
  Loader2,
  RefreshCw,
  Search,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ipc } from "@/ipc/types";
import { useSettings } from "@/hooks/useSettings";
import { showError, showSuccess } from "@/lib/toast";
import { cn } from "@/lib/utils";

/**
 * Sandbox settings: the user's own E2B API key (BYOK — never hardcoded).
 */
export function E2bKeySettings() {
  const { settings, updateSettings } = useSettings();
  const [keyInput, setKeyInput] = useState("");
  const [isTesting, setIsTesting] = useState(false);

  const hasKey = Boolean(settings?.e2bApiKey?.value);

  const saveMutation = useMutation({
    mutationFn: async (value: string) => {
      await updateSettings({
        e2bApiKey: value.trim() ? { value: value.trim() } : undefined,
      });
    },
    onSuccess: () => {
      showSuccess("E2B API key saved");
      setKeyInput("");
    },
    onError: (error) => showError(error),
  });

  const handleTest = async () => {
    setIsTesting(true);
    try {
      // A real API call against the user's E2B account.
      const response = await fetch("https://api.e2b.app/sandboxes", {
        headers: { "X-E2B-API-Key": settings?.e2bApiKey?.value ?? "" },
      });
      if (response.ok || response.status === 404) {
        showSuccess("E2B key is valid");
      } else if (response.status === 401) {
        showError("E2B key is invalid or expired");
      } else {
        showError(`E2B check failed (${response.status})`);
      }
    } catch {
      showError("Could not reach E2B — check your network");
    } finally {
      setIsTesting(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <KeyRound className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="password"
            value={keyInput}
            onChange={(e) => setKeyInput(e.target.value)}
            placeholder={hasKey ? "•••••••••••••••• (saved)" : "e2b_..."}
            className="pl-9"
          />
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={handleTest}
            disabled={!hasKey || isTesting}
            className="gap-1.5"
          >
            {isTesting ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Check className="size-4" />
            )}
            Test
          </Button>
          <Button
            onClick={() => saveMutation.mutate(keyInput)}
            disabled={!keyInput.trim() || saveMutation.isPending}
            className="gap-1.5"
          >
            {saveMutation.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Check className="size-4" />
            )}
            Save
          </Button>
        </div>
      </div>
      <p className="text-[13px] leading-relaxed text-muted-foreground">
        {hasKey
          ? "Your E2B key is configured. Apps run in your own E2B sandboxes and pause automatically when you leave to save costs."
          : "Add your E2B API key from e2b.dev to run apps in your own cloud sandboxes. The key is stored encrypted and never leaves this server."}
      </p>
    </div>
  );
}

/**
 * Model curation: pull the live model list from a provider and pick which
 * models are "active". Active models are the only ones offered in the
 * builder chat (when any are selected).
 */
export function ModelActivationSettings() {
  const { settings, updateSettings } = useSettings();
  const queryClient = useQueryClient();

  const providersQuery = useQuery({
    queryKey: ["settings", "language-model-providers"],
    queryFn: () => ipc.languageModel.getProviders(),
  });

  const cloudProviders = useMemo(
    () =>
      (providersQuery.data ?? []).filter(
        (p) => p.type === "cloud" || p.type === "custom",
      ),
    [providersQuery.data],
  );

  const [providerId, setProviderId] = useState<string>("");
  const [fetchedModels, setFetchedModels] = useState<string[]>([]);
  const [filter, setFilter] = useState("");
  const [isFetching, setIsFetching] = useState(false);

  const selectedProvider =
    cloudProviders.find((p) => p.id === providerId) ?? null;
  const activeKeys = useMemo(
    () => new Set(settings?.activeModelKeys ?? []),
    [settings?.activeModelKeys],
  );

  const providerModelsQuery = useQuery({
    queryKey: ["settings", "provider-models", providerId],
    queryFn: () => ipc.languageModel.getModels({ providerId }),
    enabled: !!providerId,
  });

  const allModels = useMemo(() => {
    const fetched = fetchedModels.map((name) => ({
      apiName: name,
      displayName: name,
      activated: activeKeys.has(`${providerId}:${name}`),
    }));
    if (fetchedModels.length > 0) return fetched;
    return (providerModelsQuery.data ?? []).map((m) => ({
      apiName: m.apiName,
      displayName: m.displayName,
      activated: activeKeys.has(`${providerId}:${m.apiName}`),
    }));
  }, [fetchedModels, providerModelsQuery.data, providerId, activeKeys]);

  const visibleModels = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return allModels;
    return allModels.filter(
      (m) =>
        m.apiName.toLowerCase().includes(q) ||
        m.displayName.toLowerCase().includes(q),
    );
  }, [allModels, filter]);

  const writeActiveKeys = async (keys: string[]) => {
    await updateSettings({ activeModelKeys: keys });
    // The chat model picker reads the filtered list from this query.
    void queryClient.invalidateQueries({
      queryKey: ["language-models-by-providers"],
    });
  };

  const handleFetch = async () => {
    if (!selectedProvider) return;
    setIsFetching(true);
    try {
      const result = await ipc.languageModel.fetchProviderModels({
        providerId: selectedProvider.id,
      });
      setFetchedModels(result.models);
      showSuccess(`Fetched ${result.models.length} models`);
    } catch (error) {
      showError(error);
    } finally {
      setIsFetching(false);
    }
  };

  const toggleModel = (apiName: string, next: boolean) => {
    const key = `${providerId}:${apiName}`;
    const keys = new Set(settings?.activeModelKeys ?? []);
    if (next) keys.add(key);
    else keys.delete(key);
    void writeActiveKeys([...keys]);
  };

  const activeCount = useMemo(
    () => allModels.filter((m) => m.activated).length,
    [allModels],
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row">
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant="outline"
                className="w-full justify-between gap-2 sm:w-64"
                disabled={cloudProviders.length === 0}
              />
            }
          >
            <span className="truncate">
              {selectedProvider ? selectedProvider.name : "Select provider"}
            </span>
            <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
          </DropdownMenuTrigger>
          <DropdownMenuContent className="max-h-72 w-64 overflow-y-auto">
            {cloudProviders.map((provider) => (
              <DropdownMenuItem
                key={provider.id}
                onClick={() => {
                  setProviderId(provider.id);
                  setFetchedModels([]);
                }}
                className={cn(providerId === provider.id && "bg-accent")}
              >
                <span className="truncate">{provider.name}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <Button
          variant="outline"
          onClick={handleFetch}
          disabled={!selectedProvider || isFetching}
          className="gap-1.5"
        >
          {isFetching ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <RefreshCw className="size-4" />
          )}
          Sync models from provider
        </Button>
      </div>

      {!selectedProvider ? (
        <p className="text-[13px] leading-relaxed text-muted-foreground">
          Select a provider, then pull its live model list. Toggle which models
          are active — active models are the ones offered in the builder chat.
          With no active models, every configured model is offered.
        </p>
      ) : (
        <>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder={`Search ${allModels.length} models...`}
                className="pl-9"
              />
            </div>
            <Badge variant="outline" className="w-fit gap-1 text-[11px]">
              {activeCount} active
            </Badge>
            {activeCount > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="gap-1 text-muted-foreground"
                onClick={() => writeActiveKeys([])}
              >
                <X className="size-3.5" />
                Clear
              </Button>
            )}
          </div>

          <div className="max-h-72 overflow-y-auto rounded-lg border border-border/70">
            {providerModelsQuery.isLoading && fetchedModels.length === 0 ? (
              <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
                Loading model list...
              </div>
            ) : visibleModels.length === 0 ? (
              <div className="p-4 text-sm text-muted-foreground">
                No models match. Sync from the provider to fetch its live list.
              </div>
            ) : (
              visibleModels.map((model) => (
                <label
                  key={model.apiName}
                  className="flex cursor-pointer items-center gap-3 border-b border-border/40 px-3 py-2.5 last:border-b-0 hover:bg-accent/40"
                >
                  <Checkbox
                    checked={model.activated}
                    onCheckedChange={(checked) =>
                      toggleModel(model.apiName, checked === true)
                    }
                  />
                  <div className="min-w-0">
                    <p className="truncate text-sm">{model.displayName}</p>
                    <p className="truncate font-mono text-[11px] text-muted-foreground">
                      {model.apiName}
                    </p>
                  </div>
                </label>
              ))
            )}
          </div>
          <p className="text-[13px] leading-relaxed text-muted-foreground">
            Models are offered in the builder chat only when they are active.
            Syncing pulls the list directly from the provider API using the key
            you configured — the key is never stored anywhere else.
          </p>
        </>
      )}
    </div>
  );
}
