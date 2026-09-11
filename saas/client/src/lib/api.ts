async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.ok === false) {
    throw new Error(json.error || `Request failed (${res.status})`);
  }
  return json.data as T;
}

export const api = {
  get: <T,>(p: string) => req<T>(p),
  post: <T,>(p: string, body?: unknown) =>
    req<T>(p, { method: "POST", body: JSON.stringify(body ?? {}) }),
  put: <T,>(p: string, body?: unknown) =>
    req<T>(p, { method: "PUT", body: JSON.stringify(body ?? {}) }),
  del: <T,>(p: string) => req<T>(p, { method: "DELETE" }),
};

export interface Provider {
  id: string;
  name: string;
  type: "openai-compatible" | "anthropic-compatible" | "mock";
  apiBase: string;
  apiKey: string;
  apiKeySet?: boolean;
}

export interface Settings {
  e2bKey: string;
  e2bKeySet: boolean;
  e2bValidated: boolean;
  e2bTemplate: string;
  sandboxTimeoutMs: number;
  allowLocalFallback: boolean;
  providers: Provider[];
  activeModels: { providerId: string; modelId: string; enabled: boolean }[];
  defaultModel: { providerId: string; modelId: string };
  modelCatalog: Record<string, { models: { id: string }[]; fetchedAt: string }>;
}

export interface McpServer {
  id: string;
  name: string;
  transport: "stdio" | "sse" | "http";
  command: string;
  args: string[];
  env: Record<string, string>;
  url: string;
  headers: Record<string, string>;
  enabled: boolean;
  templateId: string | null;
}

export interface Skill {
  id: string;
  name: string;
  description: string;
  category: string;
  content: string;
  files: { path: string; content: string }[];
  source: "builtin" | "custom";
  installed: boolean;
}

export interface AppItem {
  id: string;
  name: string;
  status: "provisioning" | "ready" | "error";
  sandboxId: string | null;
  sandboxDriver: "e2b" | "local" | null;
  previewUrl: string | null;
  createdAt: string;
  error?: string;
  log?: { t: string; text: string }[];
}

export interface ChatMsg {
  id: string;
  role: "user" | "assistant";
  content: string;
  display?: string;
  mode?: string;
  model?: string;
  error?: boolean;
  createdAt: string;
}

export interface Chat {
  id: string;
  appId: string;
  title: string;
  messages: ChatMsg[];
  createdAt: string;
}
