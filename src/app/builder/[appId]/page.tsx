"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { AppShell } from "@/components/forge/app-shell";
import { api, type AppSummary } from "@/lib/client/api";
import { BuilderHeader } from "@/components/forge/builder/builder-header";
import { ChatPanel } from "@/components/forge/builder/chat-panel";
import { WorkspacePanel } from "@/components/forge/builder/workspace-panel";
import { IntegrationsDialog } from "@/components/forge/builder/integrations-dialog";
import { PanelGroup, Panel, PanelResizeHandle } from "react-resizable-panels";
import { useToast } from "@/hooks/use-toast";
import type { ModelSummary } from "@/lib/client/api";

export interface AppIntegrations {
  skills: { skillId: string; slug: string; name: string; description: string | null; enabled: boolean; globallyEnabled: boolean }[];
  mcpServers: { id: string; name: string; status: string; enabled: boolean; globallyEnabled: boolean; toolCount: number }[];
}

export default function BuilderPage() {
  const { appId } = useParams<{ appId: string }>();
  const { toast } = useToast();
  const [app, setApp] = useState<(AppSummary & { sandboxId: string | null; previewPort: number }) | null>(null);
  const [chats, setChats] = useState<{ id: string; title: string; updatedAt: string; messageCount: number }[]>([]);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [integrations, setIntegrations] = useState<AppIntegrations>({ skills: [], mcpServers: [] });
  const [sandboxState, setSandboxState] = useState<"starting" | "running" | "paused" | "error" | "none">("none");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [models, setModels] = useState<ModelSummary[]>([]);
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null);
  const [integrationsOpen, setIntegrationsOpen] = useState(false);
  const [previewKey, setPreviewKey] = useState(0);
  const pausedRef = useRef(false);

  const loadApp = useCallback(async () => {
    const data = await api.getApp(appId);
    setApp(data.app);
    setChats(data.chats);
    setIntegrations({ skills: data.skills, mcpServers: data.mcpServers });
    if (data.chats.length > 0) setActiveChatId(data.chats[0].id);
  }, [appId]);

  const loadModels = useCallback(async () => {
    try {
      const { models } = await api.models();
      setModels(models.filter((m) => m.isActive));
      const def = models.find((m) => m.isDefault && m.isActive) ?? models.find((m) => m.isActive);
      if (def) setSelectedModelId((prev) => prev ?? def.id);
    } catch {
      // no models configured yet
    }
  }, []);

  const startSandbox = useCallback(async () => {
    setSandboxState("starting");
    try {
      const res = await api.sandboxAction(appId, "start");
      setSandboxState("running");
      if (res.previewUrl) setPreviewUrl(res.previewUrl);
      setPreviewKey((k) => k + 1);
    } catch (err) {
      setSandboxState("error");
      toast({
        title: "Sandbox failed to start",
        description: err instanceof Error ? err.message : "",
        variant: "destructive",
      });
    }
  }, [appId, toast]);

  useEffect(() => {
    loadApp().catch(() => {});
    loadModels();
  }, [loadApp, loadModels]);

  // Boot the sandbox on mount; pause it on leave (saves compute).
  useEffect(() => {
    if (!app) return;
    startSandbox();
    const handleLeave = () => {
      if (pausedRef.current) return;
      pausedRef.current = true;
      try {
        fetch(`/api/apps/${appId}/sandbox`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "pause" }),
          keepalive: true,
        }).catch(() => {});
      } catch {}
    };
    window.addEventListener("beforeunload", handleLeave);
    return () => {
      window.removeEventListener("beforeunload", handleLeave);
      handleLeave();
    };
  }, [app?.id]);

  // Heartbeat keeps the sandbox from being auto-paused while the builder is open
  useEffect(() => {
    const interval = setInterval(() => {
      api.sandboxStatus(appId).then((r) => {
        setSandboxState((prev) => (prev === "error" ? prev : (r.status as typeof prev)));
        if (r.previewUrl) setPreviewUrl(r.previewUrl);
      }).catch(() => {});
    }, 60000);
    return () => clearInterval(interval);
  }, [appId]);

  async function handleSandboxAction(action: "restart" | "reinstall" | "pause" | "start") {
    try {
      if (action === "start") {
        await startSandbox();
        return;
      }
      const res = await api.sandboxAction(appId, action);
      toast({ title: `Sandbox ${res.status}` });
      if (action === "restart" || action === "reinstall") {
        setTimeout(() => setPreviewKey((k) => k + 1), 4000);
      }
    } catch (err) {
      toast({ title: "Sandbox action failed", description: err instanceof Error ? err.message : "", variant: "destructive" });
    }
  }

  function refreshPreview() {
    setPreviewKey((k) => k + 1);
  }

  async function reloadIntegrations() {
    await loadApp().catch(() => {});
  }

  if (!app) {
    return (
      <AppShell>
        <div className="flex h-full items-center justify-center text-sm text-zinc-600">Loading app…</div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="flex h-full min-h-0 flex-col">
        <BuilderHeader
          app={app}
          sandboxState={sandboxState}
          models={models}
          selectedModelId={selectedModelId}
          onSelectModel={setSelectedModelId}
          onSandboxAction={handleSandboxAction}
          onOpenIntegrations={() => setIntegrationsOpen(true)}
          onRename={async (name) => {
            await fetch(`/api/apps/${appId}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ name }),
            });
            setApp((a) => (a ? { ...a, name } : a));
          }}
          skillsCount={integrations.skills.filter((s) => s.enabled && s.globallyEnabled).length}
          mcpCount={integrations.mcpServers.filter((m) => m.enabled && m.globallyEnabled).length}
        />

        <PanelGroup direction="horizontal" className="min-h-0 flex-1">
          <Panel defaultSize={42} minSize={26} maxSize={65}>
            <ChatPanel
              appId={appId}
              chats={chats}
              activeChatId={activeChatId}
              onSelectChat={setActiveChatId}
              onNewChat={async () => {
                const { chatId } = await api.newChat(appId);
                await loadApp();
                setActiveChatId(chatId);
              }}
              selectedModelId={selectedModelId}
              onRefreshPreview={refreshPreview}
            />
          </Panel>
          <PanelResizeHandle className="w-px bg-zinc-800/70 transition-colors data-[resize-handle-active]:bg-zinc-600" />
          <Panel defaultSize={58} minSize={35}>
            <WorkspacePanel
              appId={appId}
              previewUrl={previewUrl}
              previewKey={previewKey}
              onRefreshPreview={refreshPreview}
            />
          </Panel>
        </PanelGroup>
      </div>

      <IntegrationsDialog
        appId={appId}
        open={integrationsOpen}
        onOpenChange={setIntegrationsOpen}
        integrations={integrations}
        onChange={reloadIntegrations}
      />
    </AppShell>
  );
}
