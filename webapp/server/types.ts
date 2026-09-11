// ============================================================================
// Dyad Cloud — shared server types
// ============================================================================

export type ProviderFormat = "openai" | "anthropic";

export interface User {
  id: string;
  email: string;
  name: string;
  passwordHash: string;
  createdAt: string;
}

export interface Session {
  token: string;
  userId: string;
  expiresAt: string;
}

/** A user-configured LLM provider (OpenAI-compatible or Anthropic-compatible). */
export interface Provider {
  id: string;
  userId: string;
  name: string;
  format: ProviderFormat;
  baseUrl: string;
  apiKey: string;
  createdAt: string;
}

/** A model the user has activated for a provider. */
export interface ModelConfig {
  userId: string;
  providerId: string;
  /** API model name, e.g. "openai/gpt-4.1" */
  apiName: string;
  displayName: string;
  enabled: boolean;
  contextWindow?: number;
  maxOutputTokens?: number;
  temperature?: number;
}

export type RuntimeMode = "e2b" | "local";

export interface Settings {
  userId: string;
  runtimeMode: RuntimeMode;
  e2bApiKey: string;
  e2bDomain: string;
  e2bTimeoutMinutes: number;
  /** Default model id: `${providerId}:${apiName}` */
  defaultModel: string | null;
  agentMaxSteps: number;
  agentTemperature: number;
  mcpConsentMode: "auto" | "always_allow" | "always_ask";
  autoManageSandbox: boolean;
  updatedAt: string;
}

export interface AppSandboxInfo {
  mode: RuntimeMode;
  sandboxId?: string;
  localDir?: string;
  port?: number;
  previewUrl?: string;
  status: "provisioning" | "running" | "stopped" | "error" | "paused";
  lastError?: string;
  startedAt?: string;
}

export interface AppConfig {
  installedMcpServerIds: string[];
  installedSkillIds: string[];
}

export interface App {
  id: string;
  userId: string;
  name: string;
  description: string;
  emoji: string;
  createdAt: string;
  updatedAt: string;
  sandbox: AppSandboxInfo;
  config: AppConfig;
  /** Mirrored files of the sandbox app (durability + code viewer). */
  fileCount?: number;
}

export type ChatStatus =
  | "idle"
  | "streaming"
  | "awaiting_consent"
  | "error";

export interface ToolActivity {
  id: string;
  toolName: string;
  args?: Record<string, unknown>;
  result?: string;
  error?: string;
  status: "running" | "completed" | "error" | "awaiting_consent";
  consentReason?: string;
  startedAt: string;
  finishedAt?: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt: string;
  model?: string;
  activity?: ToolActivity[];
  todos?: { id: string; content: string; status: "pending" | "in_progress" | "completed" }[];
  summary?: string;
  error?: string;
  /** Files changed during this assistant turn */
  filesChanged?: { path: string; action: "write" | "delete" | "rename" }[];
}

export interface Chat {
  id: string;
  userId: string;
  appId: string;
  title: string;
  messages: ChatMessage[];
  status: ChatStatus;
  /** Set while a tool call awaits user consent */
  pendingConsent?: {
    messageId: string;
    activityId: string;
    toolName: string;
    args: Record<string, unknown>;
    reason: string;
    resolve?: (allow: boolean) => void;
  };
  createdAt: string;
  updatedAt: string;
}

// ---- MCP ------------------------------------------------------------------

export type McpTransport = "stdio" | "http";

export interface McpServerConfig {
  id: string;
  userId: string;
  catalogId?: string;
  name: string;
  description: string;
  transport: McpTransport;
  /** stdio */
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  /** http (streamable HTTP / SSE JSON-RPC) */
  url?: string;
  headers?: Record<string, string>;
  /** Keys the user still needs to fill in (from catalog) */
  requiredEnvKeys?: string[];
  createdAt: string;
}

// ---- Skills ----------------------------------------------------------------

export interface Skill {
  id: string;
  userId: string;
  catalogId?: string;
  name: string;
  /** Slug used inside the sandbox path */
  slug: string;
  description: string;
  instructions: string;
  builtin: boolean;
  createdAt: string;
}

// ---- Streaming events (SSE) ------------------------------------------------

export type AgentEvent =
  | { type: "start"; messageId: string }
  | { type: "text_delta"; delta: string }
  | { type: "reasoning_delta"; delta: string }
  | { type: "tool_start"; activity: ToolActivity }
  | { type: "tool_result"; activity: ToolActivity }
  | { type: "consent_request"; activityId: string; toolName: string; args: Record<string, unknown>; reason: string }
  | { type: "summary"; summary: string }
  | { type: "todos"; todos: ChatMessage["todos"] }
  | { type: "files_changed"; files: { path: string; action: "write" | "delete" | "rename" }[] }
  | { type: "message_done"; message: ChatMessage }
  | { type: "status"; status: string; detail?: string }
  | { type: "error"; error: string }
  | { type: "done" };

// ---- Sandbox runtime ---------------------------------------------------------

export interface RunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface ProcInfo {
  pid: number;
  command: string;
  startedAt?: string;
}

/**
 * Abstraction over the execution environment for a user app.
 * Primary implementation: E2B cloud sandboxes.
 * Fallback (development): local process runtime.
 */
export interface SandboxRuntime {
  readonly mode: RuntimeMode;
  readonly sandboxId: string | null;
  /** Run a command and wait for exit. */
  run(cmd: string, opts?: { cwd?: string; timeoutMs?: number; env?: Record<string, string> }): Promise<RunResult>;
  /** Start a long-running background process (e.g. the dev server). */
  startBackground(cmd: string, opts?: { cwd?: string; env?: Record<string, string> }): Promise<ProcInfo>;
  listProcs(): Promise<ProcInfo[]>;
  killProc(pid: number): Promise<void>;
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  listDir(path: string): Promise<{ path: string; isDirectory: boolean }[]>;
  removeFile(path: string): Promise<void>;
  renameFile(from: string, to: string): Promise<void>;
  /** URL where an HTTP server bound on `port` inside the runtime is reachable. */
  getPreviewUrl(port: number): Promise<string>;
  keepAlive(): Promise<void>;
  stop(): Promise<void>;
}
