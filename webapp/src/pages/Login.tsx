import React, { useState } from "react";
import { api } from "../lib/api";
import { useAppStore, toast } from "../lib/store";
import { Spinner } from "../components/ui";
import { Box, Cloud, Hammer, MessageSquareCode, Plug, ShieldCheck, Sparkles, Wrench } from "lucide-react";

export default function Login() {
  const { setUser } = useAppStore();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const path = mode === "signin" ? "/api/auth/login" : "/api/auth/register";
      const { user } = await api.post<{ user: any }>(path, { email, password });
      setUser(user);
      toast("success", mode === "signin" ? "Welcome back" : "Workspace created");
    } catch (err: any) {
      toast("error", err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-full">
      {/* Left — product story */}
      <div className="hidden lg:flex flex-col justify-between w-[46%] bg-surface-1 border-r border-line p-10 relative overflow-hidden">
        <div
          className="absolute inset-0 opacity-[0.35]"
          style={{
            backgroundImage:
              "radial-gradient(ellipse 60% 40% at 20% 0%, rgba(99,102,241,0.14), transparent), radial-gradient(ellipse 50% 45% at 90% 100%, rgba(52,211,153,0.07), transparent)",
          }}
        />
        <div className="relative">
          <div className="flex items-center gap-2.5">
            <Logo />
            <div>
              <div className="text-[15px] font-semibold tracking-tight">Dyad Cloud</div>
              <div className="text-2xs text-ink-faint -mt-0.5">AI app builder · SaaS</div>
            </div>
          </div>
        </div>

        <div className="relative max-w-md">
          <h1 className="text-[28px] leading-tight font-semibold tracking-tight text-ink">
            Describe it. The agent builds it — in a real cloud sandbox.
          </h1>
          <p className="mt-3 text-sm text-ink-mute leading-relaxed">
            A cloud-hosted, full-stack rebuild of the open-source Dyad agent. Every app runs in an isolated
            E2B sandbox with live preview, and you bring your own model providers, MCP servers, and skills.
          </p>
          <div className="mt-8 space-y-4">
            {[
              {
                icon: <Cloud size={15} />,
                title: "Cloud sandboxes",
                body: "Each app gets an isolated E2B sandbox — npm, dev server, live preview URL. Nothing runs on your machine.",
              },
              {
                icon: <Plug size={15} />,
                title: "Bring your own models",
                body: "Connect any OpenAI- or Anthropic-compatible API: base URL + key, pull the model list, pick what the agent uses.",
              },
              {
                icon: <Wrench size={15} />,
                title: "MCP + Skills built in",
                body: "One-click install of MCP servers and skills into every sandbox, with a consent policy for third-party tools.",
              },
            ].map((f) => (
              <div key={f.title} className="flex gap-3">
                <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-line bg-surface-2 text-accent">
                  {f.icon}
                </div>
                <div>
                  <div className="text-sm font-medium text-ink">{f.title}</div>
                  <div className="text-xs text-ink-mute mt-0.5 leading-relaxed">{f.body}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="relative flex items-center gap-4 text-2xs text-ink-faint">
          <span className="inline-flex items-center gap-1.5"><ShieldCheck size={12} /> Sandbox isolation</span>
          <span className="inline-flex items-center gap-1.5"><MessageSquareCode size={12} /> Agentic tool loop</span>
          <span className="inline-flex items-center gap-1.5"><Hammer size={12} /> Real code, real preview</span>
        </div>
      </div>

      {/* Right — auth */}
      <div className="flex flex-1 items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <div className="lg:hidden flex items-center gap-2.5 mb-8">
            <Logo />
            <span className="text-[15px] font-semibold tracking-tight">Dyad Cloud</span>
          </div>
          <h2 className="text-xl font-semibold tracking-tight">
            {mode === "signin" ? "Sign in to your workspace" : "Create your workspace"}
          </h2>
          <p className="hint mt-1.5">
            {mode === "signin"
              ? "Welcome back. Enter your credentials to continue."
              : "A workspace holds your apps, providers, models, MCP servers and skills."}
          </p>
          <form onSubmit={submit} className="mt-6 space-y-4">
            <div>
              <label className="label" htmlFor="email">Email</label>
              <input
                id="email"
                type="email"
                required
                autoComplete="email"
                className="input"
                placeholder="you@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div>
              <label className="label" htmlFor="password">Password</label>
              <input
                id="password"
                type="password"
                required
                minLength={6}
                autoComplete={mode === "signin" ? "current-password" : "new-password"}
                className="input"
                placeholder={mode === "signin" ? "Your password" : "At least 6 characters"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <button type="submit" className="btn-primary w-full" disabled={busy}>
              {busy && <Spinner size={14} />}
              {mode === "signin" ? "Sign in" : "Create workspace"}
            </button>
          </form>
          <p className="mt-4 text-center text-xs text-ink-mute">
            {mode === "signin" ? "Don't have a workspace?" : "Already have a workspace?"}{" "}
            <button
              className="text-accent hover:underline"
              onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
            >
              {mode === "signin" ? "Create one" : "Sign in"}
            </button>
          </p>
          <div className="mt-8 rounded-lg border border-line bg-surface-1 p-3.5 text-2xs text-ink-faint leading-relaxed">
            By continuing you agree to the terms of service and privacy policy. This is an MVP deployment —
            your workspace data is stored on this server.
          </div>
        </div>
      </div>
    </div>
  );
}

export function Logo({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      <rect width="32" height="32" rx="7" fill="#27272a" />
      <path
        d="M9 8h7.2c4.6 0 7.8 3.3 7.8 8s-3.2 8-7.8 8H9V8zm4 3.5v9h3c2.5 0 4.2-1.8 4.2-4.5s-1.7-4.5-4.2-4.5h-3z"
        fill="#fafafa"
      />
    </svg>
  );
}
