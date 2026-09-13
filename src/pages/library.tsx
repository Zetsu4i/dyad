import { usePrompts } from "@/hooks/usePrompts";
import { useAddPromptDeepLink } from "@/hooks/useAddPromptDeepLink";
import { CreatePromptDialog } from "@/components/CreatePromptDialog";
import { ImportSkillFromGitHubDialog } from "@/components/ImportSkillFromGitHubDialog";
import { useState } from "react";
import { LibraryCard } from "@/components/LibraryCard";
import { Button } from "@/components/ui/button";
import { Github } from "lucide-react";

export default function LibraryPage() {
  const { prompts, isLoading, createPrompt, updatePrompt, deletePrompt } =
    usePrompts();
  const { prefillData, dialogOpen, handleDialogClose } = useAddPromptDeepLink();
  const [isImportDialogOpen, setIsImportDialogOpen] = useState(false);

  return (
    <div className="w-full px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-6xl">
        <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h1 className="text-2xl font-bold sm:text-3xl">Library: Prompts</h1>
          <div className="shrink-0">
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => setIsImportDialogOpen(true)}
              >
                <Github className="size-4" />
                Import from GitHub
              </Button>
              <CreatePromptDialog
                onCreatePrompt={createPrompt}
                prefillData={prefillData}
                isOpen={dialogOpen}
                onOpenChange={handleDialogClose}
              />
            </div>
          </div>
        </div>

        <ImportSkillFromGitHubDialog
          isOpen={isImportDialogOpen}
          onOpenChange={setIsImportDialogOpen}
          onCreatePrompt={createPrompt}
        />

        {isLoading ? (
          <div>Loading...</div>
        ) : prompts.length === 0 ? (
          <div className="text-muted-foreground">
            No prompts yet. Create one to get started.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {prompts.map((p) => (
              <LibraryCard
                key={p.id}
                item={{ type: "prompt", data: p }}
                onUpdatePrompt={updatePrompt}
                onDeletePrompt={deletePrompt}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
