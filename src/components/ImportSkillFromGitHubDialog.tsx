import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Github, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { showError, showSuccess } from "@/lib/toast";
import type { PromptItem } from "@/hooks/usePrompts";

interface ImportSkillFromGitHubDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onCreatePrompt: (params: {
    title: string;
    content: string;
    description?: string;
    slug?: string;
  }) => Promise<PromptItem>;
}

type ParsedSkill = {
  title: string;
  description?: string;
  content: string;
  slug?: string;
};

const FRONTMATTER_DELIMITER = "---";

function parseSkillMarkdown(raw: string, fallbackTitle: string): ParsedSkill {
  let title = fallbackTitle;
  let description: string | undefined;
  let slug: string | undefined;
  let content = raw;

  const trimmed = raw.trimStart();
  if (trimmed.startsWith(FRONTMATTER_DELIMITER)) {
    const end = trimmed.indexOf("\n---", 3);
    if (end !== -1) {
      const frontmatter = trimmed
        .slice(FRONTMATTER_DELIMITER.length, end)
        .trim();
      content = trimmed
        .slice(end + FRONTMATTER_DELIMITER.length)
        .replace(/^\s*\n/, "");
      for (const line of frontmatter.split("\n")) {
        const match = /^(title|description|slug|name):\s*(.+)$/.exec(
          line.trim(),
        );
        if (!match) {
          continue;
        }
        const value = match[2].trim().replace(/^["']|["']$/g, "");
        if (match[1] === "title" || match[1] === "name") {
          title = value;
        } else if (match[1] === "description") {
          description = value;
        } else if (match[1] === "slug") {
          slug = value;
        }
      }
    }
  }
  return { title, description, content, slug };
}

async function resolveRawUrls(githubUrl: string): Promise<string[]> {
  const trimmed = githubUrl.trim().replace(/\/+$/, "");
  // Direct file link: github.com/org/repo/blob/<ref>/<path>
  const blobMatch = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/([^/]+)\/(.+)$/.exec(
    trimmed,
  );
  if (blobMatch) {
    const [, org, repo, ref, filePath] = blobMatch;
    return [
      `https://raw.githubusercontent.com/${org}/${repo}/${ref}/${filePath}`,
    ];
  }
  // Repo link: try SKILL.md then README.md on common default branches.
  const repoMatch = /^https:\/\/github\.com\/([^/]+)\/([^/]+)(?:\/tree\/([^/]+))?$/.exec(
    trimmed,
  );
  if (repoMatch) {
    const [, org, repo, maybeRef] = repoMatch;
    const refs = maybeRef ? [maybeRef] : ["main", "master", "HEAD"];
    const files = ["SKILL.md", "skill.md", "README.md"];
    return refs.flatMap((ref) =>
      files.map(
        (file) => `https://raw.githubusercontent.com/${org}/${repo}/${ref}/${file}`,
      ),
    );
  }
  throw new Error(
    "Unsupported GitHub URL. Use a repository link or a link to a markdown file.",
  );
}

/**
 * Imports a skill (markdown instructions, optionally with YAML frontmatter)
 * from GitHub into the skill/prompt library. Imported skills become slash
 * commands the agent can use in chat.
 */
export function ImportSkillFromGitHubDialog({
  isOpen,
  onOpenChange,
  onCreatePrompt,
}: ImportSkillFromGitHubDialogProps) {
  const [url, setUrl] = useState("");
  const [preview, setPreview] = useState<ParsedSkill | null>(null);

  const fetchMutation = useMutation({
    mutationFn: async (): Promise<ParsedSkill> => {
      const candidates = await resolveRawUrls(url);
      let lastStatus = "";
      for (const candidate of candidates) {
        const response = await fetch(candidate, { redirect: "follow" });
        if (response.ok) {
          const raw = await response.text();
          if (raw.trim().length === 0) {
            continue;
          }
          const nameFromPath = decodeURIComponent(
            candidate.split("/").pop() ?? "skill",
          ).replace(/\.md$/i, "");
          return parseSkillMarkdown(raw, nameFromPath);
        }
        lastStatus = `HTTP ${response.status}`;
      }
      throw new Error(
        `Could not fetch a SKILL.md/README.md from that repository (${lastStatus}). For repos, the skill must live in SKILL.md or README.md; otherwise link the file directly.`,
      );
    },
    onSuccess: (skill) => {
      setPreview(skill);
    },
    onError: (error: Error) => {
      showError(error.message);
    },
  });

  const importMutation = useMutation({
    mutationFn: async (skill: ParsedSkill) => {
      return onCreatePrompt({
        title: skill.title,
        content: skill.content,
        description: skill.description,
        slug: skill.slug,
      });
    },
    onSuccess: () => {
      showSuccess(
        "Skill imported. Use it in chat as a slash command: /" +
          (preview?.slug ?? preview?.title ?? "skill"),
      );
      setUrl("");
      setPreview(null);
      onOpenChange(false);
    },
    onError: (error: Error) => {
      showError(`Import failed: ${error.message}`);
    },
  });

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) {
          setPreview(null);
          setUrl("");
        }
        onOpenChange(open);
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Import skill from GitHub</DialogTitle>
          <DialogDescription>
            Link a repository (imports SKILL.md or README.md) or a specific
            markdown file. The imported skill becomes a slash command the agent
            can use in chat.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <div className="grid gap-2">
            <Label htmlFor="skill-github-url">GitHub URL</Label>
            <div className="flex gap-2">
              <Input
                id="skill-github-url"
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                placeholder="https://github.com/owner/repo"
                className="flex-1 font-mono text-[13px]"
                spellCheck={false}
                disabled={fetchMutation.isPending}
              />
              <Button
                variant="outline"
                onClick={() => fetchMutation.mutate()}
                disabled={!url.trim() || fetchMutation.isPending}
              >
                {fetchMutation.isPending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Github className="size-4" />
                )}
                Fetch
              </Button>
            </div>
          </div>

          {preview && (
            <div className="grid gap-2">
              <div className="text-sm font-medium">
                {preview.title}
                {preview.slug && (
                  <span className="ml-2 font-mono text-[12px] text-muted-foreground">
                    /{preview.slug}
                  </span>
                )}
              </div>
              {preview.description && (
                <div className="text-[13px] text-muted-foreground">
                  {preview.description}
                </div>
              )}
              <div className="max-h-48 overflow-y-auto rounded-md border border-border/60 bg-muted/30 p-3 text-[12px] leading-relaxed whitespace-pre-wrap">
                {preview.content.slice(0, 2000)}
                {preview.content.length > 2000 && "\n… (truncated preview)"}
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={importMutation.isPending}
          >
            Cancel
          </Button>
          <Button
            onClick={() => preview && importMutation.mutate(preview)}
            disabled={!preview || importMutation.isPending}
          >
            {importMutation.isPending && (
              <Loader2 className="size-4 animate-spin" />
            )}
            Import skill
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
