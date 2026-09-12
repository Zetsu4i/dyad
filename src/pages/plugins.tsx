import React, { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { BackButton } from "@/components/ui/back-button";
import { Button } from "@/components/ui/button";
import { PluginsList } from "@/components/plugins/PluginsList";
import { CatalogSection } from "@/components/plugins/catalog/CatalogSection";
import { useDeepLink } from "@/contexts/DeepLinkContext";

const PluginsPage: React.FC = () => {
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const { lastDeepLink } = useDeepLink();

  // The dyad://add-mcp-server deep link lands on this page; open the
  // add dialog so the prefilled form (see AddPluginDialog) is visible.
  useEffect(() => {
    if (lastDeepLink?.type === "add-mcp-server") {
      setIsAddDialogOpen(true);
    }
  }, [lastDeepLink?.timestamp]);

  return (
    <div className="w-full min-h-screen px-8 py-4">
      <div className="max-w-5xl pb-12">
        <BackButton />
        <header className="mb-8 flex items-start justify-between gap-4">
          <div className="text-left">
            <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">
              MCP Servers
            </h1>
            <p className="text-md text-gray-600 dark:text-gray-400">
              Connect Model Context Protocol servers to give the agent live
              tools — external APIs, databases and internal workflows. Enabled
              servers are available to the agent inside every app sandbox.
            </p>
          </div>
          <Button onClick={() => setIsAddDialogOpen(true)}>
            <Plus size={16} />
            Add Server
          </Button>
        </header>
        <PluginsList
          addDialogOpen={isAddDialogOpen}
          onAddDialogOpenChange={setIsAddDialogOpen}
        />
        <CatalogSection />
      </div>
    </div>
  );
};

export default PluginsPage;
