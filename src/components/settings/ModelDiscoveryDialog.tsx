import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, RefreshCw, SearchIcon } from "lucide-react";
import { ipc } from "@/ipc/types";
import { queryKeys } from "@/lib/queryKeys";
import { showError, showSuccess } from "@/lib/toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";

interface ModelDiscoveryDialogProps {
  isOpen: boolean;
  onClose: () => void;
  providerId: string;
  providerName?: string;
}

type DiscoveredModel = {
  apiName: string;
  displayName: string;
  alreadyImported: boolean;
};

/**
 * Fetches the provider's /models endpoint (OpenAI- and Anthropic-compatible
 * shapes both supported), lets the user search + select models, and bulk
 * imports them as enabled custom models.
 */
export function ModelDiscoveryDialog({
  isOpen,
  onClose,
  providerId,
  providerName,
}: ModelDiscoveryDialogProps) {
  const [discovered, setDiscovered] = useState<DiscoveredModel[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const queryClient = useQueryClient();

  const fetchMutation = useMutation({
    mutationFn: async () => {
      const result = await ipc.languageModel.fetchProviderModels({
        providerId,
      });
      return result;
    },
    onSuccess: (result) => {
      setDiscovered(result.models);
      // Pre-select every model that is not imported yet.
      setSelected(
        new Set(
          result.models
            .filter((model) => !model.alreadyImported)
            .map((model) => model.apiName),
        ),
      );
      showSuccess(
        `Fetched ${result.models.length} models from ${result.endpoint}.`,
      );
    },
    onError: (error: Error) => {
      showError(`Model discovery failed: ${error.message}`);
    },
  });

  const importMutation = useMutation({
    mutationFn: async (models: Array<{ apiName: string; displayName: string }>) => {
      return ipc.languageModel.importProviderModels({ providerId, models });
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.languageModels.forProvider({ providerId }),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.languageModels.byProviders,
      });
      showSuccess(
        result.imported > 0
          ? `Imported ${result.imported} models. They are now enabled and appear in the model picker.`
          : "No new models to import (all selected models already exist).",
      );
      onClose();
    },
    onError: (error: Error) => {
      showError(`Import failed: ${error.message}`);
    },
  });

  const filtered = useMemo(() => {
    if (!discovered) {
      return [];
    }
    const needle = search.trim().toLowerCase();
    if (!needle) {
      return discovered;
    }
    return discovered.filter((model) =>
      model.apiName.toLowerCase().includes(needle),
    );
  }, [discovered, search]);

  const selectedCount = selected.size;

  const toggleModel = (apiName: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(apiName)) {
        next.delete(apiName);
      } else {
        next.add(apiName);
      }
      return next;
    });
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Import models — {providerName ?? providerId}</DialogTitle>
          <DialogDescription>
            Fetches the provider's <code>/models</code> endpoint using your
            saved API key. Select the models to import; imported models start
            enabled and appear in the builder's model picker.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <SearchIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search models..."
              className="pl-8 font-mono text-[13px]"
              disabled={!discovered}
            />
          </div>
          <Button
            variant="outline"
            onClick={() => fetchMutation.mutate()}
            disabled={fetchMutation.isPending}
          >
            {fetchMutation.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <RefreshCw className="size-4" />
            )}
            {discovered ? "Refresh" : "Fetch models"}
          </Button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-border/60 bg-muted/30">
          {!discovered && !fetchMutation.isPending && (
            <div className="flex flex-col items-center justify-center gap-2 py-10 text-muted-foreground text-sm">
              <span>Click “Fetch models” to query the provider endpoint.</span>
            </div>
          )}
          {fetchMutation.isPending && !discovered && (
            <div className="flex items-center justify-center gap-2 py-10 text-muted-foreground text-sm">
              <Loader2 className="size-4 animate-spin" /> Fetching model list...
            </div>
          )}
          {filtered.map((model) => (
            <label
              key={model.apiName}
              className="flex items-center gap-3 px-3 py-2 border-b border-border/40 last:border-b-0 cursor-pointer hover:bg-muted/60"
            >
              <Switch
                checked={selected.has(model.apiName)}
                onCheckedChange={() => toggleModel(model.apiName)}
                disabled={model.alreadyImported}
              />
              <span className="flex-1 min-w-0 truncate font-mono text-[13px]">
                {model.apiName}
              </span>
              {model.alreadyImported && (
                <span className="text-[11px] uppercase tracking-wide text-muted-foreground border border-border/60 rounded px-1.5 py-0.5">
                  imported
                </span>
              )}
            </label>
          ))}
          {discovered && filtered.length === 0 && (
            <div className="py-10 text-center text-muted-foreground text-sm">
              No models match “{search}”.
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <span className="mr-auto text-[13px] text-muted-foreground">
            {selectedCount} selected
          </span>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() =>
              importMutation.mutate(
                (discovered ?? [])
                  .filter((model) => selected.has(model.apiName))
                  .map((model) => ({
                    apiName: model.apiName,
                    displayName: model.displayName,
                  })),
              )
            }
            disabled={
              !discovered ||
              selectedCount === 0 ||
              importMutation.isPending ||
              fetchMutation.isPending
            }
          >
            {importMutation.isPending && (
              <Loader2 className="size-4 animate-spin" />
            )}
            Import {selectedCount > 0 ? selectedCount : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
