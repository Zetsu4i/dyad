import React, { useCallback, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Check,
  Download,
  FileCode,
  FileText,
  FolderPlus,
  Github,
  Globe,
  Loader2,
  Plus,
  Puzzle,
  RefreshCw,
  Save,
  Sparkles,
  Trash2,
  Wrench,
} from "lucide-react";
import { BackButton } from "@/components/ui/back-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ipc, type SkillMetaDto, type SkillLibraryEntryDto } from "@/ipc/types";
import { showError, showSuccess } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { queryKeys } from "@/lib/queryKeys";

// ---------------------------------------------------------------------------
// Query keys
// ---------------------------------------------------------------------------

const skillsListKey = ["skills", "list"] as const;
const libraryKey = ["skills", "library"] as const;

// ---------------------------------------------------------------------------
// Small building blocks
// ---------------------------------------------------------------------------

const cardClass =
  "rounded-lg border border-border/70 bg-card text-card-foreground transition-colors hover:border-ring/40";

function SourceBadge({ skill }: { skill: SkillMetaDto }) {
  if (skill.source === "github") {
    return (
      <Badge
        variant="outline"
        className="gap-1 border-border/70 text-[10px] text-muted-foreground"
      >
        <Github className="size-3" />
        GitHub
      </Badge>
    );
  }
  return (
    <Badge
      variant="outline"
      className="gap-1 border-border/70 text-[10px] text-muted-foreground"
    >
      <Wrench className="size-3" />
      Custom
    </Badge>
  );
}

// ---------------------------------------------------------------------------
// Dialogs
// ---------------------------------------------------------------------------

function NewSkillDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [skillMd, setSkillMd] = useState("");

  const createMutation = useMutation({
    mutationFn: async () => {
      await ipc.skills.create({
        name: name.trim(),
        description: description.trim() || undefined,
        skillMd: skillMd.trim() || undefined,
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: skillsListKey });
      showSuccess("Skill created");
      setName("");
      setDescription("");
      setSkillMd("");
      onOpenChange(false);
    },
    onError: (error) => showError(error),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="text-base">New skill</DialogTitle>
          <DialogDescription>
            A skill is a folder of instructions and scripts the agent can read
            and run inside every app sandbox.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="skill-name">Name</Label>
            <Input
              id="skill-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="deploy-checklist"
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="skill-description">Description</Label>
            <Input
              id="skill-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="How to build, verify and ship releases"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="skill-md">SKILL.md</Label>
            <Textarea
              id="skill-md"
              value={skillMd}
              onChange={(e) => setSkillMd(e.target.value)}
              placeholder={
                "Optional — leave empty to start from a template.\n\n---\nname: My Skill\ndescription: What it does\n---\n\n1. First step..."
              }
              className="min-h-40 font-mono text-xs"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => createMutation.mutate()}
            disabled={!name.trim() || createMutation.isPending}
          >
            {createMutation.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Plus className="size-4" />
            )}
            Create skill
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function GithubInstallDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [url, setUrl] = useState("");

  const installMutation = useMutation({
    mutationFn: async () => {
      return ipc.skills.installFromGithub({ url: url.trim() });
    },
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: skillsListKey });
      const installed = result.installed.length;
      const skipped = result.skipped.length;
      showSuccess(
        `Installed ${installed} skill${installed === 1 ? "" : "s"}${
          skipped ? ` (${skipped} already installed)` : ""
        }`,
      );
      setUrl("");
      onOpenChange(false);
    },
    onError: (error) => showError(error),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-base">Install from GitHub</DialogTitle>
          <DialogDescription>
            Paste a repo URL. Any folder containing a SKILL.md is installed as
            a skill. Subfolders work too:
            <span className="mt-1 block break-all font-mono text-[11px] text-muted-foreground">
              github.com/owner/repo/tree/main/path/to/skill
            </span>
          </DialogDescription>
        </DialogHeader>
        <Input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://github.com/anthropics/skills"
          autoFocus
        />
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => installMutation.mutate()}
            disabled={!url.trim() || installMutation.isPending}
          >
            {installMutation.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Download className="size-4" />
            )}
            Install
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Skill detail editor
// ---------------------------------------------------------------------------

function SkillDetailView({
  slug,
  onBack,
}: {
  slug: string;
  onBack: () => void;
}) {
  const queryClient = useQueryClient();
  const [selectedFile, setSelectedFile] = useState<string>("SKILL.md");
  const [draft, setDraft] = useState<string | null>(null);
  const [newFileName, setNewFileName] = useState("");
  const [isNewFileDialogOpen, setIsNewFileDialogOpen] = useState(false);

  const filesQuery = useQuery({
    queryKey: ["skills", "files", slug],
    queryFn: () => ipc.skills.getFiles({ slug }),
  });

  const contentQuery = useQuery({
    queryKey: ["skills", "file-content", slug, selectedFile],
    queryFn: () => ipc.skills.readFile({ slug, relPath: selectedFile }),
  });

  React.useEffect(() => {
    if (contentQuery.data !== null && contentQuery.data !== undefined) {
      setDraft(contentQuery.data);
    }
  }, [contentQuery.data, selectedFile]);

  React.useEffect(() => {
    setDraft(null);
  }, [selectedFile]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      await ipc.skills.saveFile({ slug, relPath: selectedFile, content: draft ?? "" });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["skills", "files", slug] });
      showSuccess(`Saved ${selectedFile}`);
    },
    onError: (error) => showError(error),
  });

  const deleteFileMutation = useMutation({
    mutationFn: async (relPath: string) => {
      await ipc.skills.deleteFile({ slug, relPath });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["skills", "files", slug] });
      setSelectedFile("SKILL.md");
      showSuccess("File deleted");
    },
    onError: (error) => showError(error),
  });

  const addFileMutation = useMutation({
    mutationFn: async (relPath: string) => {
      await ipc.skills.saveFile({ slug, relPath, content: "" });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["skills", "files", slug] });
      setIsNewFileDialogOpen(false);
      if (newFileName) setSelectedFile(newFileName);
      setNewFileName("");
    },
    onError: (error) => showError(error),
  });

  const files = filesQuery.data ?? [];
  const isDirty = draft !== null && draft !== contentQuery.data;

  return (
    <div className="flex h-[calc(100vh-8rem)] flex-col gap-4 lg:flex-row">
      {/* File tree */}
      <div className="flex w-full shrink-0 flex-col rounded-lg border border-border/70 bg-card lg:w-64">
        <div className="flex items-center justify-between border-b border-border/60 px-3 py-2.5">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Puzzle className="size-4 text-muted-foreground" />
            <span className="max-w-40 truncate">{slug}</span>
          </div>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="sm"
                  className="size-7 p-0"
                  onClick={() => setIsNewFileDialogOpen(true)}
                  aria-label="Add file"
                />
              }
            >
              <Plus className="size-4" />
            </TooltipTrigger>
            <TooltipContent>Add file or folder</TooltipContent>
          </Tooltip>
        </div>
        <div className="flex-1 overflow-y-auto p-1.5">
          {files.length === 0 ? (
            <p className="px-2 py-4 text-xs text-muted-foreground">No files</p>
          ) : (
            files.map((file) => (
              <div
                key={file.relPath}
                className={cn(
                  "group flex items-center gap-1 rounded-md px-2 py-1.5 text-xs",
                  selectedFile === file.relPath
                    ? "bg-accent text-accent-foreground"
                    : "hover:bg-accent/50",
                )}
              >
                <button
                  className="flex min-w-0 flex-1 items-center gap-2 text-left"
                  onClick={() => setSelectedFile(file.relPath)}
                >
                  {file.relPath.endsWith(".md") ? (
                    <FileText className="size-3.5 shrink-0 text-muted-foreground" />
                  ) : (
                    <FileCode className="size-3.5 shrink-0 text-muted-foreground" />
                  )}
                  <span className="truncate">{file.relPath}</span>
                </button>
                {file.relPath !== "SKILL.md" && (
                  <button
                    aria-label={`Delete ${file.relPath}`}
                    className="hidden shrink-0 rounded p-0.5 text-muted-foreground hover:text-destructive group-hover:block"
                    onClick={() => deleteFileMutation.mutate(file.relPath)}
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                )}
              </div>
            ))
          )}
        </div>
      </div>

      {/* Editor */}
      <div className="flex min-h-80 flex-1 flex-col rounded-lg border border-border/70 bg-card">
        <div className="flex items-center justify-between gap-2 border-b border-border/60 px-3 py-2">
          <Button variant="ghost" size="sm" onClick={onBack} className="gap-1.5">
            <ArrowLeft className="size-4" />
            All skills
          </Button>
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate font-mono text-xs text-muted-foreground">
              {selectedFile}
            </span>
            {isDirty && (
              <Badge variant="outline" className="text-[10px]">
                unsaved
              </Badge>
            )}
            <Button
              size="sm"
              className="gap-1.5"
              onClick={() => saveMutation.mutate()}
              disabled={!isDirty || saveMutation.isPending}
            >
              {saveMutation.isPending ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Save className="size-3.5" />
              )}
              Save
            </Button>
          </div>
        </div>
        <Textarea
          value={draft ?? ""}
          onChange={(e) => setDraft(e.target.value)}
          className="flex-1 resize-none rounded-none border-0 bg-transparent font-mono text-xs leading-relaxed focus-visible:ring-0"
          placeholder={
            contentQuery.isLoading ? "Loading..." : "Select a file to edit"
          }
          spellCheck={false}
        />
      </div>

      <Dialog open={isNewFileDialogOpen} onOpenChange={setIsNewFileDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base">Add file</DialogTitle>
            <DialogDescription>
              Use a path to create folders, e.g.{" "}
              <span className="font-mono text-xs">scripts/deploy.sh</span>
            </DialogDescription>
          </DialogHeader>
          <Input
            value={newFileName}
            onChange={(e) => setNewFileName(e.target.value)}
            placeholder="scripts/deploy.sh"
            autoFocus
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setIsNewFileDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => addFileMutation.mutate(newFileName)}
              disabled={!newFileName.trim() || addFileMutation.isPending}
            >
              <FolderPlus className="size-4" />
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Library card
// ---------------------------------------------------------------------------

function LibraryCard({
  entry,
  installed,
  onInstall,
  installing,
}: {
  entry: SkillLibraryEntryDto;
  installed: boolean;
  onInstall: () => void;
  installing: boolean;
}) {
  return (
    <div className={cn(cardClass, "flex flex-col gap-2 p-4")}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-md border border-border/70 bg-background-darker">
            <Sparkles className="size-4 text-muted-foreground" />
          </div>
          <div className="min-w-0">
            <h3 className="truncate text-sm font-medium">{entry.title}</h3>
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
              {entry.category}
            </p>
          </div>
        </div>
        {installed ? (
          <Badge
            variant="outline"
            className="shrink-0 gap-1 border-emerald-900/60 text-emerald-500"
          >
            <Check className="size-3" />
            Installed
          </Badge>
        ) : (
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5 shrink-0"
            onClick={onInstall}
            disabled={installing}
          >
            {installing ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Download className="size-3.5" />
            )}
            Install
          </Button>
        )}
      </div>
      <p className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">
        {entry.description}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function SkillsPage() {
  const queryClient = useQueryClient();
  const [selectedSkill, setSelectedSkill] = useState<string | null>(null);
  const [isNewSkillDialogOpen, setIsNewSkillDialogOpen] = useState(false);
  const [isGithubDialogOpen, setIsGithubDialogOpen] = useState(false);

  const skillsQuery = useQuery({
    queryKey: skillsListKey,
    queryFn: () => ipc.skills.list(),
  });

  const libraryQuery = useQuery({
    queryKey: libraryKey,
    queryFn: () => ipc.skills.library(),
  });

  const skills = useMemo(() => skillsQuery.data ?? [], [skillsQuery.data]);
  const library = useMemo(() => libraryQuery.data ?? [], [libraryQuery.data]);
  const installedSlugs = useMemo(
    () => new Set(skills.map((s) => s.slug)),
    [skills],
  );

  const toggleMutation = useMutation({
    mutationFn: ({ slug, enabled }: { slug: string; enabled: boolean }) =>
      ipc.skills.setEnabled({ slug, enabled }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: skillsListKey });
    },
    onError: (error) => showError(error),
  });

  const removeMutation = useMutation({
    mutationFn: (slug: string) => ipc.skills.remove({ slug }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: skillsListKey });
      setSelectedSkill(null);
      showSuccess("Skill removed");
    },
    onError: (error) => showError(error),
  });

  const installMutation = useMutation({
    mutationFn: (url: string) => ipc.skills.installFromGithub({ url }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: skillsListKey });
      showSuccess("Skill installed");
    },
    onError: (error) => showError(error),
  });

  const refreshLibrary = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: skillsListKey });
    void queryClient.invalidateQueries({ queryKey: libraryKey });
  }, [queryClient]);

  if (selectedSkill) {
    return (
      <div className="min-h-screen bg-background px-4 py-4 md:px-8">
        <div className="mx-auto max-w-6xl">
          <SkillDetailView
            slug={selectedSkill}
            onBack={() => setSelectedSkill(null)}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background px-4 py-4 md:px-8">
      <div className="mx-auto max-w-6xl pb-16">
        <div className="flex items-center justify-between">
          <BackButton />
          <Button variant="ghost" size="sm" onClick={refreshLibrary} className="gap-1.5">
            <RefreshCw className="size-3.5" />
            Refresh
          </Button>
        </div>

        <header className="mb-8 mt-2 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
              <Sparkles className="size-5 text-muted-foreground" />
              Skills
            </h1>
            <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
              Install capabilities the agent can use inside every app sandbox —
              instructions (SKILL.md), scripts and resources. Enabled skills are
              synced into sandboxes automatically.
            </p>
          </div>
          <div className="flex shrink-0 gap-2">
            <Button
              variant="outline"
              className="gap-1.5"
              onClick={() => setIsGithubDialogOpen(true)}
            >
              <Github className="size-4" />
              Install from GitHub
            </Button>
            <Button className="gap-1.5" onClick={() => setIsNewSkillDialogOpen(true)}>
              <Plus className="size-4" />
              New skill
            </Button>
          </div>
        </header>

        {/* Installed skills */}
        <section className="mb-10">
          <h2 className="mb-3 text-sm font-medium text-foreground">
            Installed ({skills.length})
          </h2>
          {skillsQuery.isLoading ? (
            <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Loading skills...
            </div>
          ) : skills.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border/70 p-8 text-center">
              <p className="text-sm text-muted-foreground">
                No skills installed yet. Install one from the library below or
                create your own.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              {skills.map((skill) => (
                <div key={skill.slug} className={cn(cardClass, "flex flex-col gap-3 p-4")}>
                  <div className="flex items-start justify-between gap-2">
                    <button
                      className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
                      onClick={() => setSelectedSkill(skill.slug)}
                    >
                      <div className="flex size-8 shrink-0 items-center justify-center rounded-md border border-border/70 bg-background-darker">
                        <Globe className="size-4 text-muted-foreground" />
                      </div>
                      <div className="min-w-0">
                        <h3 className="truncate text-sm font-medium">{skill.name}</h3>
                        <p className="text-[11px] text-muted-foreground">
                          {skill.fileCount} file{skill.fileCount === 1 ? "" : "s"}
                        </p>
                      </div>
                    </button>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <SourceBadge skill={skill} />
                      <Switch
                        checked={skill.enabled}
                        onCheckedChange={(enabled) =>
                          toggleMutation.mutate({ slug: skill.slug, enabled })
                        }
                        aria-label={`Enable ${skill.name}`}
                      />
                    </div>
                  </div>
                  <p className="line-clamp-2 min-h-8 text-xs leading-relaxed text-muted-foreground">
                    {skill.description || "No description"}
                  </p>
                  <div className="mt-auto flex items-center justify-between">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="gap-1.5 text-muted-foreground"
                      onClick={() => setSelectedSkill(skill.slug)}
                    >
                      <FileCode className="size-3.5" />
                      Edit files
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="gap-1.5 text-muted-foreground hover:text-destructive"
                      onClick={() => removeMutation.mutate(skill.slug)}
                    >
                      <Trash2 className="size-3.5" />
                      Remove
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Library */}
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-medium text-foreground">
              Library ({library.length})
            </h2>
          </div>
          {libraryQuery.isLoading ? (
            <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Loading library...
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              {library.map((entry) => (
                <LibraryCard
                  key={entry.slug}
                  entry={entry}
                  installed={installedSlugs.has(entry.slug)}
                  installing={
                    installMutation.isPending &&
                    installMutation.variables === entry.repoUrl
                  }
                  onInstall={() => installMutation.mutate(entry.repoUrl)}
                />
              ))}
            </div>
          )}
        </section>
      </div>

      <NewSkillDialog
        open={isNewSkillDialogOpen}
        onOpenChange={setIsNewSkillDialogOpen}
      />
      <GithubInstallDialog
        open={isGithubDialogOpen}
        onOpenChange={setIsGithubDialogOpen}
      />
    </div>
  );
}
