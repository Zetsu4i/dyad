/** Shared client-side types. */

export interface AppSummary {
  id: number;
  name: string;
  slug: string;
  description: string | null;
  status: string;
  lastError: string | null;
  runner: string;
  previewUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ChatSummary {
  id: number;
  appId: number;
  title: string | null;
  chatMode: string;
  createdAt: string;
}

export interface MessageRow {
  id: number;
  chatId: number;
  role: "user" | "assistant";
  content: string;
  annotations: string | null;
  modelKey?: string | null;
  createdAt: string;
}

export interface ProviderRow {
  id: number;
  type: "openai-compatible" | "anthropic-compatible" | "demo";
  name: string;
  baseUrl: string;
  apiKeyMasked: string | null;
  hasApiKey: boolean;
  isDefault: boolean;
  models: ProviderModelRow[];
}

export interface ProviderModelRow {
  id: number;
  modelId: string;
  displayName: string | null;
  active: boolean;
}

export interface ActiveModel {
  id: number;
  providerId: number;
  providerName: string;
  providerType: string;
  modelId: string;
  displayName: string | null;
}

export interface McpServerRow {
  id: number;
  name: string;
  description: string | null;
  transport: "http" | "sse" | "stdio";
  url: string | null;
  command: string | null;
  args: string | null;
  env: string | null;
  headers: string[];
  scope: "global" | "app";
  enabled: boolean;
  fromCatalog: boolean;
  lastStatus: string;
  lastError: string | null;
  tools: { name: string; description?: string }[];
}

export interface McpCatalogEntry {
  name: string;
  description: string;
  transport: "http" | "sse" | "stdio";
  url?: string;
  command?: string;
  args?: string[];
  docsUrl?: string;
}

export interface SkillRow {
  id: number;
  slug: string;
  name: string;
  description: string;
  instructions: string;
  enabled: boolean;
  source: "gallery" | "custom";
}

export interface AppStatus {
  status: string;
  lastError: string | null;
  previewUrl: string | null;
  sandboxId: string | null;
  runner: string;
  logs: string[];
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error || `${res.status} ${res.statusText}`);
  }
  return (await res.json()) as T;
}
