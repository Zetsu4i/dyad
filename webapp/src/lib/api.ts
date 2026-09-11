// API client + SSE stream parser
export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

// ---------------------------------------------------------------------------
// Auth token
//
// The app is often embedded in a sandboxed preview iframe (opaque origin):
// localStorage throws SecurityError and third-party cookies are blocked, so a
// plain cookie/localStorage session can never stick. We therefore keep the
// token in the URL hash (#t=...) — which survives reloads even in sandboxed
// iframes — with localStorage and in-memory as fallbacks.
// ---------------------------------------------------------------------------

const TOKEN_KEY = "dc_token";
let currentToken: string | null = null;

function safeStorage(op: "get" | "set" | "del"): string | null | undefined {
  try {
    if (op === "get") return localStorage.getItem(TOKEN_KEY);
    if (op === "set") return localStorage.getItem(TOKEN_KEY);
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* storage unavailable (sandboxed iframe) */
  }
  return undefined;
}

/** Restore the token from hash → localStorage. Call once at app boot. */
export function initAuthToken(): string | null {
  try {
    const m = window.location.hash.match(/[#&]t=([^&]+)/);
    if (m?.[1]) {
      currentToken = decodeURIComponent(m[1]);
      try {
        localStorage.setItem(TOKEN_KEY, currentToken);
      } catch { /* ignore */ }
      return currentToken;
    }
  } catch { /* ignore */ }
  const stored = safeStorage("get");
  if (stored) currentToken = stored;
  return currentToken;
}

export function setAuthToken(token: string | null | undefined) {
  currentToken = token ?? null;
  if (token) {
    try {
      localStorage.setItem(TOKEN_KEY, token);
    } catch { /* ignore */ }
    try {
      const clean = window.location.pathname + window.location.search;
      window.history.replaceState(null, "", `#t=${encodeURIComponent(token)}`);
      void clean;
    } catch { /* ignore */ }
  } else {
    safeStorage("del");
    try {
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
    } catch { /* ignore */ }
  }
}

export function getAuthToken(): string | null {
  if (currentToken) return currentToken;
  return initAuthToken();
}

function authHeaders(): Record<string, string> {
  const token = getAuthToken();
  return token ? { authorization: `Bearer ${token}` } : {};
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: "same-origin",
    ...init,
    headers: { "content-type": "application/json", ...authHeaders(), ...init?.headers },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, (data as any).error ?? `Request failed (${res.status})`);
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) }),
  put: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "PUT", body: body === undefined ? undefined : JSON.stringify(body) }),
  del: <T>(path: string) => request<T>(path, { method: "DELETE" }),
};

export interface AgentStreamHandlers {
  onEvent: (event: any) => void;
  onError?: (error: string) => void;
}

/** POST that consumes a text/event-stream response. */
export async function streamPost(
  path: string,
  body: unknown,
  handlers: AgentStreamHandlers,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(path, {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json", ...authHeaders() },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok || !res.body) {
    let msg = `Request failed (${res.status})`;
    try {
      const data = await res.json();
      if (data.error) msg = data.error;
    } catch { /* ignore */ }
    handlers.onError?.(msg);
    return;
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buffer.indexOf("\n\n")) >= 0) {
        const chunk = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        for (const line of chunk.split("\n")) {
          if (!line.startsWith("data:")) continue;
          try {
            handlers.onEvent(JSON.parse(line.slice(5).trim()));
          } catch { /* ignore malformed */ }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
