import { create } from "zustand";
import { api } from "./api";

export interface CurrentUser {
  id: string;
  email: string;
  name: string;
}

export interface AppSettings {
  runtimeMode: "e2b" | "local";
  e2bTimeoutMinutes: number;
  e2bDomain?: string;
  defaultModel: string | null;
  agentMaxSteps: number;
  agentTemperature: number;
  mcpConsentMode: "auto" | "always_allow" | "always_ask";
  hasE2BKey: boolean;
  e2bApiKey?: string;
}

interface AppState {
  user: CurrentUser | null;
  authChecked: boolean;
  settings: AppSettings | null;
  setUser: (u: CurrentUser | null) => void;
  checkAuth: () => Promise<void>;
  loadSettings: () => Promise<void>;
}

export const useAppStore = create<AppState>((set) => ({
  user: null,
  authChecked: false,
  settings: null,
  setUser: (u) => set({ user: u }),
  checkAuth: async () => {
    try {
      const { user } = await api.get<{ user: CurrentUser }>("/api/auth/me");
      set({ user, authChecked: true });
      api.get<{ user: CurrentUser; [k: string]: unknown }>("/api/settings").then((s) =>
        set({ settings: s as unknown as AppSettings }),
      ).catch(() => {});
    } catch {
      set({ user: null, authChecked: true });
    }
  },
  loadSettings: async () => {
    const s = await api.get<Record<string, unknown>>("/api/settings");
    set({ settings: s as unknown as AppSettings });
  },
}));

// ---- Toasts -----------------------------------------------------------------

export interface Toast {
  id: number;
  kind: "info" | "success" | "error";
  text: string;
}

interface ToastState {
  toasts: Toast[];
  push: (kind: Toast["kind"], text: string) => void;
  dismiss: (id: number) => void;
}

let toastId = 1;

export const useToasts = create<ToastState>((set) => ({
  toasts: [],
  push: (kind, text) => {
    const id = toastId++;
    set((s) => ({ toasts: [...s.toasts, { id, kind, text }] }));
    setTimeout(() => {
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
    }, 4200);
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

export function toast(kind: Toast["kind"], text: string) {
  useToasts.getState().push(kind, text);
}
