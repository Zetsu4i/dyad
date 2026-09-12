"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Loader2, Github, Sparkles, Trash2, Download, Search } from "lucide-react";
import { api, type SkillSummary, type CatalogSkill } from "@/lib/client/api";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

export function SkillsSection() {
  const { toast } = useToast();
  const [skills, setSkills] = useState<SkillSummary[]>([]);
  const [catalog, setCatalog] = useState<CatalogSkill[]>([]);
  const [loading, setLoading] = useState(true);
  const [installing, setInstalling] = useState<string | null>(null);
  const [githubOpen, setGithubOpen] = useState(false);
  const [githubUrl, setGithubUrl] = useState("");
  const [subdir, setSubdir] = useState("");
  const [search, setSearch] = useState("");

  async function load() {
    try {
      const [s, c] = await Promise.all([api.skills(), api.skillsCatalog()]);
      setSkills(s.skills);
      setCatalog(c.catalog);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function install(slug: string) {
    setInstalling(slug);
    try {
      const r = await api.installSkill({ catalogSlug: slug });
      toast({ title: `Installed ${r.name}`, description: `${r.fileCount} files` });
      await load();
    } catch (err) {
      toast({
        title: "Install failed",
        description: err instanceof Error ? err.message : "",
        variant: "destructive",
      });
    } finally {
      setInstalling(null);
    }
  }

  async function installFromGithub() {
    if (!githubUrl.trim()) return;
    setInstalling("github");
    try {
      const r = await api.installSkill({
        githubUrl: githubUrl.trim(),
        subdir: subdir.trim() || undefined,
      });
      toast({ title: `Installed ${r.name}`, description: `${r.fileCount} files` });
      setGithubOpen(false);
      setGithubUrl("");
      setSubdir("");
      await load();
    } catch (err) {
      toast({
        title: "Install failed",
        description: err instanceof Error ? err.message : "",
        variant: "destructive",
      });
    } finally {
      setInstalling(null);
    }
  }

  async function toggle(s: SkillSummary) {
    await api.setSkillEnabled(s.id, !s.enabled);
    await load();
  }

  async function remove(s: SkillSummary) {
    if (!confirm(`Uninstall "${s.name}"? It will be removed from all apps.`)) return;
    await api.deleteSkill(s.id);
    await load();
  }

  const installedSlugs = new Set(skills.map((s) => s.slug));
  const filteredCatalog = catalog.filter((c) =>
    !search || c.name.toLowerCase().includes(search.toLowerCase()) || c.description.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
        <h3 className="flex items-center gap-2 text-sm font-medium text-zinc-200">
          <Sparkles className="h-4 w-4 text-zinc-400" />
          Skills
        </h3>
        <p className="mt-1 text-[13px] leading-relaxed text-zinc-500">
          Skills are instruction + code bundles (SKILL.md format) that get installed
          into your app sandboxes. The agent reads them on demand and uses their files
          and scripts. Install from the curated catalog or any public GitHub repo.
        </p>
      </div>

      {/* Installed */}
      {loading ? (
        <div className="flex justify-center py-8">
          <Loader2 className="h-5 w-5 animate-spin text-zinc-600" />
        </div>
      ) : skills.length > 0 ? (
        <div className="space-y-1.5">
          <h4 className="text-xs font-medium uppercase tracking-wider text-zinc-500">
            Installed ({skills.length})
          </h4>
          {skills.map((s) => (
            <div
              key={s.id}
              className="flex items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-900/40 p-3.5"
            >
              <Switch checked={s.enabled} onCheckedChange={() => toggle(s)} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium text-zinc-200">{s.name}</span>
                  <span className="rounded border border-zinc-700 bg-zinc-950 px-1.5 py-0.5 text-[10px] text-zinc-500">
                    {s.source}
                  </span>
                </div>
                <div className="truncate text-xs text-zinc-500">{s.description ?? s.slug}</div>
                <div className="mt-0.5 text-[11px] text-zinc-600">
                  {s.fileCount} files · {s.appCount} app{s.appCount === 1 ? "" : "s"}
                </div>
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => remove(s)}
                className="h-7 w-7 text-zinc-600 hover:text-red-400"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
        </div>
      ) : null}

      {/* Catalog */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <h4 className="text-xs font-medium uppercase tracking-wider text-zinc-500">
            Skill library
          </h4>
          <div className="flex-1" />
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 h-3 w-3 -translate-y-1/2 text-zinc-600" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search…"
              className="h-7 w-40 border-zinc-800 bg-zinc-950 pl-8 text-xs"
            />
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setGithubOpen(true)}
            className="h-7 gap-1.5 border-zinc-800 bg-transparent text-xs text-zinc-300 hover:bg-zinc-800"
          >
            <Github className="h-3.5 w-3.5" />
            From GitHub
          </Button>
        </div>

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {filteredCatalog.map((c) => {
            const installed = installedSlugs.has(c.slug);
            return (
              <div key={c.slug} className="flex flex-col rounded-lg border border-zinc-800 bg-zinc-900/40 p-3.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium text-zinc-200">{c.name}</span>
                      <span className="shrink-0 rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-500">
                        {c.category}
                      </span>
                    </div>
                    <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-zinc-500">
                      {c.description}
                    </p>
                  </div>
                </div>
                <div className="mt-3 flex items-center justify-between">
                  <span className="truncate font-mono text-[10px] text-zinc-700">
                    {c.repo}/{c.subdir ?? ""}
                  </span>
                  <Button
                    size="sm"
                    disabled={installing === c.slug}
                    onClick={() => install(c.slug)}
                    className={cn(
                      "h-7 gap-1 text-xs",
                      installed
                        ? "border border-zinc-700 bg-transparent text-zinc-400 hover:bg-zinc-800"
                        : "bg-zinc-100 font-medium text-zinc-900 hover:bg-white"
                    )}
                    variant={installed ? "outline" : "default"}
                  >
                    {installing === c.slug ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Download className="h-3 w-3" />
                    )}
                    {installed ? "Reinstall" : "Install"}
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* GitHub install dialog */}
      <Dialog open={githubOpen} onOpenChange={setGithubOpen}>
        <DialogContent className="max-w-md border-zinc-800 bg-zinc-900">
          <DialogHeader>
            <DialogTitle className="text-zinc-100">Install skill from GitHub</DialogTitle>
            <DialogDescription className="text-zinc-500">
              Any public repo containing a SKILL.md (or folders of them) works.
              Anthropic-style skill repos are fully supported.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-zinc-400">Repository URL</Label>
              <Input
                value={githubUrl}
                onChange={(e) => setGithubUrl(e.target.value)}
                placeholder="https://github.com/owner/repo"
                className="border-zinc-800 bg-zinc-950 font-mono text-xs"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-zinc-400">Subdirectory (optional)</Label>
              <Input
                value={subdir}
                onChange={(e) => setSubdir(e.target.value)}
                placeholder="e.g. document-skills/pdf"
                className="border-zinc-800 bg-zinc-950 font-mono text-xs"
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button
                variant="ghost"
                onClick={() => setGithubOpen(false)}
                className="text-xs text-zinc-400"
              >
                Cancel
              </Button>
              <Button
                onClick={installFromGithub}
                disabled={installing === "github" || !githubUrl.trim()}
                className="bg-zinc-100 text-xs font-medium text-zinc-900 hover:bg-white"
              >
                {installing === "github" ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
                Install
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
