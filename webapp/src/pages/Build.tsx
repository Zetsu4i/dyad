import React, { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { toast } from "../lib/store";
import { Select, Spinner } from "../components/ui";
import { Hammer, Sparkles, Zap } from "lucide-react";

interface ModelRow {
  providerId: string;
  apiName: string;
  displayName: string;
  enabled: boolean;
  providerName: string;
}

const IDEAS = [
  "A project management tool with tasks, milestones, and a team activity feed",
  "A personal finance dashboard with budgets, spending categories and monthly trends",
  "A recipe manager with search, tags, and a weekly meal planner",
  "A customer feedback board with upvotes, tags and status tracking",
  "A pomodoro timer with session history and daily statistics",
  "An invoice generator with line items, totals and printable layout",
];

export default function Build() {
  const navigate = useNavigate();
  const location = useLocation();
  const [prompt, setPrompt] = useState<string>((location.state as any)?.prompt ?? "");
  const [name, setName] = useState("");
  const [models, setModels] = useState<ModelRow[]>([]);
  const [model, setModel] = useState("");
  const [busy, setBusy] = useState(false);
  const [ideaIdx, setIdeaIdx] = useState(0);

  useEffect(() => {
    api
      .get<{ models: ModelRow[]; defaultModel: string | null }>("/api/models")
      .then((r) => {
        const enabled = r.models.filter((m) => m.enabled);
        setModels(enabled);
        const def = enabled.find((m) => `${m.providerId}:${m.apiName}` === r.defaultModel) ?? enabled[0];
        if (def) setModel(`${def.providerId}:${def.apiName}`);
      })
      .catch(() => {});
  }, []);

  const create = async () => {
    setBusy(true);
    try {
      const { app } = await api.post<{ app: { id: string } }>("/api/apps", {
        name: name.trim() || undefined,
        description: prompt.trim().slice(0, 300) || undefined,
      });
      navigate(`/apps/${app.id}`, { state: { initialPrompt: prompt.trim() || undefined } });
    } catch (e: any) {
      toast("error", e.message);
      setBusy(false);
    }
  };

  const canCreate = !busy;

  return (
    <div className="mx-auto flex min-h-full max-w-3xl flex-col justify-center px-8 py-12">
      <div className="text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl border border-line bg-surface-2 shadow-panel">
          <Hammer size={20} className="text-accent" />
        </div>
        <h1 className="mt-4 text-2xl font-semibold tracking-tight">Build an app</h1>
        <p className="mx-auto mt-2 max-w-md text-sm text-ink-mute leading-relaxed">
          Describe what you want. The agent scaffolds a React + TypeScript + shadcn/ui project,
          writes the code, installs packages and runs it in a cloud sandbox.
        </p>
      </div>

      <div className="mt-8 rounded-xl border border-line bg-surface-2 p-1.5 shadow-panel focus-within:border-line-strong transition-colors">
        <textarea
          className="min-h-36 w-full resize-none bg-transparent px-4 py-3.5 text-sm text-ink placeholder:text-ink-faint focus:outline-none"
          placeholder="A CRM for a small sales team: contacts, deals pipeline with stages, and a weekly revenue chart..."
          value={prompt}
          autoFocus
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) create();
          }}
        />
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-3 py-2.5">
          <div className="flex items-center gap-2">
            <Select
              className="w-52"
              value={model}
              onChange={setModel}
              disabled={models.length === 0}
              placeholder={models.length === 0 ? "No models — check Settings" : undefined}
              options={models.map((m) => ({
                value: `${m.providerId}:${m.apiName}`,
                label: `${m.displayName} · ${m.providerName}`,
              }))}
            />
          </div>
          <button className="btn-primary" onClick={create} disabled={!canCreate}>
            {busy ? <Spinner size={14} /> : <Sparkles size={14} />}
            Create app
          </button>
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between text-2xs text-ink-faint">
        <span>Optional: leave empty to start from a blank scaffold.</span>
        <span>⌘/Ctrl + Enter to create</span>
      </div>

      <div className="mt-2 flex items-center gap-3">
        <div className="h-px flex-1 bg-line" />
        <span className="text-2xs uppercase tracking-wider text-ink-faint">or try an idea</span>
        <div className="h-px flex-1 bg-line" />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
        {IDEAS.map((idea, i) => (
          <button
            key={idea}
            className="flex items-start gap-2 rounded-lg border border-line bg-surface-1 px-3.5 py-3 text-left text-xs text-ink-mute transition-colors hover:border-accent/40 hover:text-ink-dim"
            onClick={() => {
              setIdeaIdx(i);
              setPrompt(idea);
            }}
          >
            <Zap size={12} className={`mt-0.5 shrink-0 ${ideaIdx === i ? "text-accent" : "text-ink-faint"}`} />
            {idea}
          </button>
        ))}
      </div>
    </div>
  );
}
