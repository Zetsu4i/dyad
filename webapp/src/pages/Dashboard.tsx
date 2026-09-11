import React, { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { useAppStore } from "../lib/store";
import { timeAgo } from "../lib/util";
import { Spinner, StatusDot } from "../components/ui";
import {
  ArrowRight, Boxes, Check, Hammer, Plug, Sparkles, Plus, Wrench, Zap,
} from "lucide-react";

interface AppRow {
  id: string;
  name: string;
  description: string;
  emoji: string;
  updatedAt: string;
  sandbox: { status: string; mode: string };
  config: { installedMcpServerIds: string[]; installedSkillIds: string[] };
}

export default function Dashboard() {
  const { user, settings } = useAppStore();
  const navigate = useNavigate();
  const [apps, setApps] = useState<AppRow[] | null>(null);
  const [mcps, setMcps] = useState(0);
  const [prompt, setPrompt] = useState("");

  useEffect(() => {
    api.get<{ apps: AppRow[] }>("/api/apps").then((r) => setApps(r.apps)).catch(() => setApps([]));
    api.get<{ servers: unknown[] }>("/api/mcp").then((r) => setMcps(r.servers.length)).catch(() => {});
    const t = setInterval(() => {
      api.get<{ apps: AppRow[] }>("/api/apps").then((r) => setApps(r.apps)).catch(() => {});
    }, 8000);
    return () => clearInterval(t);
  }, []);

  const list = apps ?? [];
  const running = list.filter((a) => a.sandbox.status === "running").length;
  const firstName = (user?.name ?? "there").split(" ")[0];

  return (
    <div className="mx-auto max-w-5xl px-8 py-8">
      {/* Hero / quick build */}
      <section className="relative overflow-hidden rounded-xl border border-line bg-surface-2 p-6">
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            backgroundImage:
              "radial-gradient(ellipse 55% 70% at 12% 0%, rgba(99,102,241,0.13), transparent), radial-gradient(ellipse 40% 55% at 95% 110%, rgba(52,211,153,0.06), transparent)",
          }}
        />
        <div className="relative">
          <h1 className="text-xl font-semibold tracking-tight">Welcome back, {firstName}</h1>
          <p className="mt-1 text-sm text-ink-mute">
            Describe an app and the agent builds it in an isolated cloud sandbox — code, deps, dev server, live preview.
          </p>
          <form
            className="mt-4 flex items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              navigate("/build", { state: { prompt } });
            }}
          >
            <input
              className="input h-11 flex-1 text-sm"
              placeholder="e.g. A CRM dashboard with pipeline stages and activity feed..."
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
            />
            <button className="btn-primary !h-11" type="submit">
              <Sparkles size={14} /> Build
            </button>
          </form>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {[
              "Kanban board with drag-and-drop",
              "Habit tracker with streak heatmap",
              "Expense splitter with balances",
            ].map((s) => (
              <button
                key={s}
                className="rounded-full border border-line bg-surface-1 px-2.5 py-1 text-2xs text-ink-mute transition-colors hover:border-accent/40 hover:text-ink"
                onClick={() => setPrompt(s)}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* Stats */}
      <section className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard icon={<Boxes size={15} />} label="Apps" value={String(list.length)} sub={`${running} running`} to="/apps" />
        <StatCard icon={<Hammer size={15} />} label="Build an app" value="New" sub="from a prompt" to="/build" />
        <StatCard icon={<Plug size={15} />} label="MCP servers" value={String(mcps)} sub="connected tools" to="/integrations" />
        <StatCard icon={<Wrench size={15} />} label="Skills" value="6+" sub="playbooks" to="/integrations" />
      </section>

      {/* Setup checklist */}
      {!settings?.defaultModel && (
        <section className="mt-5 flex items-start gap-3 rounded-lg border border-warn/25 bg-warn/5 px-4 py-3">
          <Sparkles size={15} className="mt-0.5 shrink-0 text-warn" />
          <div className="text-sm">
            <span className="font-medium text-ink">One step left:</span>{" "}
            <span className="text-ink-mute">confirm your default model so the agent can build. </span>
            <Link to="/settings" className="text-accent hover:underline">Open Settings →</Link>
          </div>
        </section>
      )}

      {/* Recent apps */}
      <section className="mt-7">
        <div className="flex items-center justify-between">
          <h2 className="text-[15px] font-semibold tracking-tight">Recent apps</h2>
          <Link to="/apps" className="inline-flex items-center gap-1 text-xs text-accent hover:underline">
            View all <ArrowRight size={12} />
          </Link>
        </div>
        {apps === null ? (
          <div className="mt-4 flex items-center gap-2 text-sm text-ink-faint">
            <Spinner size={14} /> Loading...
          </div>
        ) : list.length === 0 ? (
          <button
            onClick={() => navigate("/build")}
            className="mt-4 flex w-full flex-col items-center rounded-xl border border-dashed border-line-strong py-12 transition-colors hover:border-accent/50 hover:bg-accent-soft/30"
          >
            <Zap size={22} className="text-ink-faint" />
            <div className="mt-2.5 text-sm font-medium text-ink">Build your first app</div>
            <div className="hint mt-1 max-w-xs text-center">
              Start from a one-line prompt. The agent scaffolds, codes, installs and runs it in the sandbox.
            </div>
          </button>
        ) : (
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            {list.slice(0, 4).map((a) => (
              <Link
                key={a.id}
                to={`/apps/${a.id}`}
                className="panel group flex items-center gap-3.5 p-4 transition-colors hover:border-line-strong"
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-surface-3 text-lg">
                  {a.emoji}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold text-ink">{a.name}</div>
                  <div className="mt-0.5 flex items-center gap-1.5 text-2xs text-ink-faint">
                    <StatusDot status={a.sandbox.status} /> {a.sandbox.status} · {timeAgo(a.updatedAt)}
                  </div>
                </div>
                <ArrowRight size={14} className="shrink-0 text-ink-faint opacity-0 transition-opacity group-hover:opacity-100" />
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  sub,
  to,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub: string;
  to: string;
}) {
  return (
    <Link to={to} className="panel group p-4 transition-colors hover:border-line-strong">
      <div className="flex items-center gap-2 text-ink-faint">
        <span className="flex h-6.5 w-6.5 items-center justify-center rounded-md bg-surface-3 text-accent" style={{ height: 26, width: 26 }}>
          {icon}
        </span>
        <span className="text-xs font-medium">{label}</span>
      </div>
      <div className="mt-2.5 flex items-baseline gap-1.5">
        <span className="text-xl font-semibold tracking-tight text-ink">{value}</span>
        <span className="text-2xs text-ink-faint">{sub}</span>
      </div>
    </Link>
  );
}
