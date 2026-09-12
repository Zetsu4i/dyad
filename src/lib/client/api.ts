"use client";

// Typed client-side API helpers.

export interface AppSummary {
  id: string;
  name: string;
  description: string | null;
  templateId: string;
  sandboxStatus: string;
  updatedAt: string;
  createdAt: string;
  chatCount: number;
}

export interface ModelSummary {
  id: string;
  modelId: string;
  displayName: string;
  isActive: boolean;
  isDefault: boolean;
  providerId: string;
  providerName?: string;
  providerFormat?: string;
}

export interface SkillSummary {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  source: string;
  sourceUrl: string | null;
  enabled: boolean;
  fileCount: number;
  appCount: number;
  installedAt: string;
}

export interface CatalogSkill {
  slug: string;
  name: string;
  description: string;
  category: string;
  repo: string;
  subdir?: string;
  branch?: string;
}

export interface McpServerSummary {
  id: string;
  name: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  enabled: boolean;
  status: string;
  statusMessage: string | null;
  port: number;
  tools: { name: string; description?: string }[];
  appCount: number;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  thinking: string | null;
  toolTrace: string | null;
  modelId: string | null;
  createdAt: string;
}

export interface FileNode {
  name: string;
  path: string;
  type: "file" | "dir";
  size?: number;
  children?: FileNode[];
}

async function handle<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Request failed (${res.status})`);
  }
  return (await res.json()) as T;
}

export const api = {
  me: () => fetch("/api/auth/me").then((r) => handle<{ user: { id: string; email: string; name: string | null } | null }>(r)),
  logout: () => fetch("/api/auth/logout", { method: "POST" }).then((r) => handle<{ ok: boolean }>(r)),

  listApps: () => fetch("/api/apps").then((r) => handle<{ apps: AppSummary[] }>(r)),
  createApp: (name: string, templateId: string, description?: string) =>
    fetch("/api/apps", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, templateId, description }),
    }).then((r) => handle<{ app: AppSummary; chatId: string }>(r)),
  deleteApp: (id: string) => fetch(`/api/apps/${id}`, { method: "DELETE" }).then((r) => handle<{ success: boolean }>(r)),
  getApp: (id: string) => fetch(`/api/apps/${id}`).then((r) => handle<{
    app: AppSummary & { sandboxId: string | null; previewPort: number };
    chats: { id: string; title: string; updatedAt: string; messageCount: number }[];
    skills: { skillId: string; slug: string; name: string; description: string | null; enabled: boolean; globallyEnabled: boolean }[];
    mcpServers: { id: string; name: string; status: string; enabled: boolean; globallyEnabled: boolean; toolCount: number }[];
  }>(r)),

  sandboxStatus: (appId: string) => fetch(`/api/apps/${appId}/sandbox`).then((r) => handle<{ status: string; sandboxId: string | null; previewUrl: string | null }>(r)),
  sandboxAction: (appId: string, action: "start" | "pause" | "restart" | "reinstall") =>
    fetch(`/api/apps/${appId}/sandbox`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    }).then((r) => handle<{ status: string; previewUrl?: string }>(r)),

  models: () => fetch("/api/settings/models").then((r) => handle<{ models: ModelSummary[] }>(r)),
  pullModels: (providerId?: string, activateIds?: string[]) =>
    fetch("/api/settings/models/pull", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ providerId, activateIds }),
    }).then((r) => handle<{ provider: { name: string; baseUrl: string; format: string }; models: { id: string; name: string; description?: string }[] }>(r)),
  setModel: (id: string, patch: { isActive?: boolean; isDefault?: boolean }) =>
    fetch("/api/settings/models", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, ...patch }),
    }).then((r) => handle<{ success: boolean }>(r)),
  addModel: (modelId: string, displayName?: string, providerId?: string) =>
    fetch("/api/settings/models", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ modelId, displayName, providerId, activate: true }),
    }).then((r) => handle<{ id: string }>(r)),
  deleteModel: (id: string) => fetch(`/api/settings/models?id=${id}`, { method: "DELETE" }).then((r) => handle<{ success: boolean }>(r)),

  providers: () => fetch("/api/settings/providers").then((r) => handle<{
    providers: { id: string; name: string; format: string; baseUrl: string; apiKeyMasked: string | null; hasKey: boolean; isActive: boolean }[];
  }>(r)),
  saveProvider: (data: { providerId?: string; name?: string; format: string; baseUrl: string; apiKey?: string }) =>
    fetch("/api/settings/providers", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }).then((r) => handle<{ id?: string; success?: boolean }>(r)),
  testProvider: (data: { baseUrl: string; apiKey?: string; format?: string; testModel?: string }) =>
    fetch("/api/settings/providers/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }).then((r) => handle<{ ok: boolean; message: string; models?: number }>(r)),

  e2bStatus: () => fetch("/api/settings/e2b").then((r) => handle<{ hasKey: boolean; apiKeyMasked: string | null }>(r)),
  saveE2bKey: (apiKey: string) =>
    fetch("/api/settings/e2b", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apiKey }),
    }).then((r) => handle<{ success: boolean }>(r)),
  testE2bKey: (apiKey?: string) =>
    fetch("/api/settings/e2b/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(apiKey ? { apiKey } : {}),
    }).then((r) => handle<{ ok: boolean; message: string }>(r)),

  skills: () => fetch("/api/skills").then((r) => handle<{ skills: SkillSummary[] }>(r)),
  skillsCatalog: () => fetch("/api/skills/catalog").then((r) => handle<{ catalog: CatalogSkill[] }>(r)),
  installSkill: (data: { catalogSlug?: string; githubUrl?: string; subdir?: string; branch?: string }) =>
    fetch("/api/skills", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }).then((r) => handle<{ slug: string; name: string; fileCount: number }>(r)),
  setSkillEnabled: (id: string, enabled: boolean) =>
    fetch("/api/skills", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, enabled }),
    }).then((r) => handle<{ success: boolean }>(r)),
  deleteSkill: (id: string) => fetch(`/api/skills?id=${id}`, { method: "DELETE" }).then((r) => handle<{ success: boolean }>(r)),

  mcpServers: () => fetch("/api/mcp").then((r) => handle<{ servers: McpServerSummary[] }>(r)),
  addMcpServer: (data: { name: string; command: string; args?: string[]; env?: Record<string, string> }) =>
    fetch("/api/mcp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }).then((r) => handle<{ id: string }>(r)),
  setMcpEnabled: (id: string, enabled: boolean) =>
    fetch("/api/mcp", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, enabled }),
    }).then((r) => handle<{ success: boolean }>(r)),
  deleteMcpServer: (id: string) => fetch(`/api/mcp?id=${id}`, { method: "DELETE" }).then((r) => handle<{ success: boolean }>(r)),
  testMcpServer: (data: { id?: string; command?: string; args?: string[]; env?: Record<string, string> }) =>
    fetch("/api/mcp/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }).then((r) => handle<{ ok: boolean; tools: { name: string; description?: string }[]; error?: string }>(r)),

  setAppIntegration: (appId: string, data: { type: "skill" | "mcp"; id: string; enabled: boolean }) =>
    fetch(`/api/apps/${appId}/integrations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }).then((r) => handle<{ success: boolean; enabled: boolean }>(r)),
  linkIntegrations: (appId: string, data: { addSkills?: string[]; addMcps?: string[] }) =>
    fetch(`/api/apps/${appId}/integrations`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }).then((r) => handle<{ success: boolean }>(r)),

  files: (appId: string) => fetch(`/api/apps/${appId}/files`).then((r) => handle<{ tree: FileNode[] }>(r)),
  readFile: (appId: string, path: string) =>
    fetch(`/api/apps/${appId}/files?path=${encodeURIComponent(path)}`).then((r) => handle<{ path: string; content: string }>(r)),
  saveFile: (appId: string, path: string, content: string) =>
    fetch(`/api/apps/${appId}/files`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path, content }),
    }).then((r) => handle<{ success: boolean }>(r)),
  runCommand: (appId: string, command: string, timeoutMs?: number) =>
    fetch(`/api/apps/${appId}/command`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ command, timeoutMs }),
    }).then((r) => handle<{ exitCode: number; stdout: string; stderr: string }>(r)),
  logs: (appId: string) => fetch(`/api/apps/${appId}/logs`).then((r) => handle<{ logs: { ts: number; stream: string; line: string }[] }>(r)),
  messages: (appId: string, chatId: string) => fetch(`/api/apps/${appId}/chat?chatId=${chatId}`).then((r) => handle<{ chat: { id: string; title: string }; messages: ChatMessage[] }>(r)),
  newChat: (appId: string) => fetch(`/api/apps/${appId}/chat`, { method: "PUT" }).then((r) => handle<{ chatId: string }>(r)),
};

export function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}
