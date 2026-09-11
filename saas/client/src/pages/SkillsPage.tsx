import React from "react";
import { Plus, Trash2, Hammer, Eye } from "lucide-react";
import { api, Skill } from "../lib/api";
import { useData, useToast } from "../state/store";
import { Button, Card, Field, Input, Badge, Modal, Tabs, Textarea, Switch, EmptyState, Spinner } from "../components/ui";

export function SkillsPage() {
  const [tab, setTab] = React.useState<"installed" | "catalog" | "custom">("installed");
  const { skills } = useData();
  const installed = skills?.filter((s) => s.installed) || [];
  return (
    <div className="mx-auto max-w-4xl px-6 py-6">
      <h1 className="text-lg font-semibold tracking-tight">Skills</h1>
      <p className="mb-4 mt-0.5 text-[13px] text-zinc-500">
        Instruction packs that extend the agent. Installed skills are injected into prompts and synced into every sandbox under <code className="font-mono text-[11px]">.skills/</code>.
      </p>
      <Tabs
        tabs={[
          { id: "installed", label: "Installed", count: installed.length },
          { id: "catalog", label: "Catalog" },
          { id: "custom", label: "Custom" },
        ]}
        value={tab}
        onChange={setTab}
      />
      <div className="mt-4">
        {tab === "installed" && <InstalledTab />}
        {tab === "catalog" && <CatalogTab />}
        {tab === "custom" && <CustomTab />}
      </div>
    </div>
  );
}

function InstalledTab() {
  const { skills, refreshSkills, apps } = useData();
  const toast = useToast();
  const [viewing, setViewing] = React.useState<Skill | null>(null);
  const [syncing, setSyncing] = React.useState(false);
  const installed = skills?.filter((s) => s.installed) || [];

  const toggle = async (s: Skill, v: boolean) => {
    try {
      await api.post(`/api/skills/${s.id}/toggle`, { installed: v });
      await refreshSkills();
    } catch (e: any) {
      toast(e.message, "err");
    }
  };

  const syncAll = async () => {
    setSyncing(true);
    try {
      for (const a of apps.filter((x) => x.status === "ready")) {
        await api.post(`/api/apps/${a.id}/skills/sync`, {});
      }
      toast(`Skills synced to ${apps.filter((x) => x.status === "ready").length} sandbox(es)`);
    } catch (e: any) {
      toast(e.message, "err");
    } finally {
      setSyncing(false);
    }
  };

  if (!skills) return <Spinner />;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex justify-end">
        <Button size="sm" variant="secondary" loading={syncing} onClick={syncAll}>Sync to all sandboxes</Button>
      </div>
      {installed.length === 0 && <EmptyState title="No skills installed" desc="Install skills from the Catalog, or create your own under Custom." />}
      {installed.map((s) => (
        <Card key={s.id}>
          <div className="flex items-center gap-3 px-4 py-3">
            <Switch checked={true} onChange={(v) => toggle(s, v)} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold">{s.name}</span>
                <Badge>{s.category}</Badge>
                {s.source === "custom" && <Badge tone="blue">custom</Badge>}
              </div>
              <div className="mt-0.5 truncate text-xs text-zinc-500">{s.description}</div>
            </div>
            <Button size="sm" variant="ghost" onClick={() => setViewing(s)}><Eye size={13} /> View</Button>
          </div>
        </Card>
      ))}
      {viewing && <SkillView skill={viewing} onClose={() => setViewing(null)} />}
    </div>
  );
}

function CatalogTab() {
  const { skills, refreshSkills } = useData();
  const toast = useToast();
  const [viewing, setViewing] = React.useState<Skill | null>(null);
  const builtin = skills?.filter((s) => s.source === "builtin") || [];

  const toggle = async (s: Skill, v: boolean) => {
    try {
      await api.post(`/api/skills/${s.id}/toggle`, { installed: v });
      await refreshSkills();
      if (v) toast(`Installed ${s.name} — it will sync to new sandboxes automatically.`);
    } catch (e: any) {
      toast(e.message, "err");
    }
  };

  if (!skills) return <Spinner />;
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
      {builtin.map((s) => (
        <Card key={s.id} className="p-4">
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="text-sm font-semibold">{s.name}</div>
              <div className="mt-0.5 text-xs text-zinc-500">{s.description}</div>
            </div>
            <Badge>{s.category}</Badge>
          </div>
          <div className="mt-3 flex gap-2">
            <Button size="sm" variant={s.installed ? "ghost" : "secondary"} onClick={() => toggle(s, !s.installed)}>
              <Hammer size={13} /> {s.installed ? "Installed ✓" : "Install"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setViewing(s)}>Preview</Button>
          </div>
        </Card>
      ))}
      {viewing && <SkillView skill={viewing} onClose={() => setViewing(null)} />}
    </div>
  );
}

function CustomTab() {
  const { skills, refreshSkills } = useData();
  const toast = useToast();
  const [showNew, setShowNew] = React.useState(false);
  const [editing, setEditing] = React.useState<Skill | null>(null);
  const custom = skills?.filter((s) => s.source === "custom") || [];

  const remove = async (s: Skill) => {
    if (!confirm(`Delete skill "${s.name}"?`)) return;
    try {
      await api.del(`/api/skills/${s.id}`);
      await refreshSkills();
    } catch (e: any) {
      toast(e.message, "err");
    }
  };

  if (!skills) return <Spinner />;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex justify-end">
        <Button size="sm" onClick={() => setShowNew(true)}><Plus size={14} /> New skill</Button>
      </div>
      {custom.length === 0 && (
        <EmptyState
          title="No custom skills"
          desc="Package your team's conventions, API docs, or internal workflows as a skill. Format: a name, a description, and Markdown instructions (SKILL.md style)."
        />
      )}
      {custom.map((s) => (
        <Card key={s.id}>
          <div className="flex items-center gap-3 px-4 py-3">
            <Switch checked={s.installed} onChange={async (v) => {
              try { await api.post(`/api/skills/${s.id}/toggle`, { installed: v }); await refreshSkills(); }
              catch (e: any) { toast(e.message, "err"); }
            }} />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold">{s.name}</div>
              <div className="mt-0.5 truncate text-xs text-zinc-500">{s.description}</div>
            </div>
            <Button size="sm" variant="ghost" onClick={() => setEditing(s)}>Edit</Button>
            <button onClick={() => remove(s)} className="rounded p-1.5 text-zinc-600 hover:bg-zinc-800 hover:text-red-400">
              <Trash2 size={14} />
            </button>
          </div>
        </Card>
      ))}
      {(showNew || editing) && (
        <SkillModal initial={editing} onClose={() => { setShowNew(false); setEditing(null); }} onSaved={refreshSkills} />
      )}
    </div>
  );
}

function SkillModal({ initial, onClose, onSaved }: { initial: Skill | null; onClose: () => void; onSaved: () => Promise<void> }) {
  const toast = useToast();
  const [name, setName] = React.useState(initial?.name || "");
  const [description, setDescription] = React.useState(initial?.description || "");
  const [content, setContent] = React.useState(initial?.content || "# My Skill\n\nWhen the user asks for …, always …\n");
  const [saving, setSaving] = React.useState(false);

  const save = async () => {
    setSaving(true);
    try {
      if (initial) await api.put(`/api/skills/${initial.id}`, { name, description, content });
      else await api.post("/api/skills", { name: name || "Untitled Skill", description, content });
      await onSaved();
      onClose();
      toast("Skill saved and enabled");
    } catch (e: any) {
      toast(e.message, "err");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title={initial ? "Edit skill" : "New skill"} onClose={onClose} wide>
      <div className="flex flex-col gap-3">
        <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Acme API Conventions" /></Field>
        <Field label="Description"><Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="One line shown in the catalog" /></Field>
        <Field label="Instructions (SKILL.md)" hint="Markdown. Be specific: when it applies, what to install, conventions to follow, what to avoid.">
          <Textarea value={content} onChange={(e) => setContent(e.target.value)} rows={14} />
        </Field>
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={save} loading={saving}>Save skill</Button>
        </div>
      </div>
    </Modal>
  );
}

function SkillView({ skill, onClose }: { skill: Skill; onClose: () => void }) {
  return (
    <Modal title={skill.name} onClose={onClose} wide>
      {skill.description && <p className="mb-3 text-[13px] text-zinc-400">{skill.description}</p>}
      <pre className="max-h-[55vh] overflow-auto whitespace-pre-wrap rounded-md border border-zinc-800 bg-zinc-950 p-3 font-mono text-xs leading-relaxed text-zinc-300">
        {skill.content}
      </pre>
    </Modal>
  );
}
