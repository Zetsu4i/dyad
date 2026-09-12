"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  LayoutGrid,
  Plus,
  Settings,
  LogOut,
  ChevronsLeft,
  ChevronsRight,
  MoreHorizontal,
  Trash2,
  Boxes,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { LogoMark } from "./logo";
import { api, timeAgo, type AppSummary } from "@/lib/client/api";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { toast } = useToast();
  const [collapsed, setCollapsed] = useState(false);
  const [apps, setApps] = useState<AppSummary[]>([]);
  const [user, setUser] = useState<{ email: string; name: string | null } | null>(null);

  useEffect(() => {
    api.me().then((r) => setUser(r.user)).catch(() => router.push("/login"));
    let alive = true;
    const load = () => api.listApps().then((r) => { if (alive) setApps(r.apps); }).catch(() => {});
    load();
    const interval = setInterval(load, 15000);
    return () => { alive = false; clearInterval(interval); };
  }, [router]);

  const isBuilder = pathname.startsWith("/builder/");
  const currentAppId = isBuilder ? pathname.split("/")[2] : null;

  async function handleDelete(app: AppSummary) {
    if (!confirm(`Delete "${app.name}"? The project and its sandbox data will be removed.`)) return;
    try {
      await api.deleteApp(app.id);
      setApps((prev) => prev.filter((a) => a.id !== app.id));
      if (app.id === currentAppId) router.push("/dashboard");
    } catch (err) {
      toast({ title: "Delete failed", description: err instanceof Error ? err.message : "", variant: "destructive" });
    }
  }

  return (
    <TooltipProvider delayDuration={200}>
      <div className="flex h-screen overflow-hidden bg-zinc-950 text-zinc-100">
        {/* Icon rail */}
        <div className="flex w-14 shrink-0 flex-col items-center border-r border-zinc-800/80 bg-zinc-950 py-3">
          <Link href="/dashboard" className="mb-4">
            <Tooltip>
              <TooltipTrigger asChild>
                <span><LogoMark className="h-7 w-7" /></span>
              </TooltipTrigger>
              <TooltipContent side="right">Forge</TooltipContent>
            </Tooltip>
          </Link>

          <Tooltip>
            <TooltipTrigger asChild>
              <Link
                href="/dashboard?new=1"
                className="mb-3 flex h-9 w-9 items-center justify-center rounded-lg bg-zinc-100 text-zinc-900 transition-colors hover:bg-white"
              >
                <Plus className="h-4.5 w-4.5" />
              </Link>
            </TooltipTrigger>
            <TooltipContent side="right">New app</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Link
                href="/dashboard"
                className={cn(
                  "mb-1 flex h-9 w-9 items-center justify-center rounded-lg transition-colors",
                  pathname === "/dashboard"
                    ? "bg-zinc-800 text-zinc-50"
                    : "text-zinc-500 hover:bg-zinc-900 hover:text-zinc-200"
                )}
              >
                <LayoutGrid className="h-4.5 w-4.5" />
              </Link>
            </TooltipTrigger>
            <TooltipContent side="right">My Apps</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Link
                href="/builder"
                className={cn(
                  "mb-1 flex h-9 w-9 items-center justify-center rounded-lg transition-colors",
                  pathname.startsWith("/builder")
                    ? "bg-zinc-800 text-zinc-50"
                    : "text-zinc-500 hover:bg-zinc-900 hover:text-zinc-200"
                )}
              >
                <Boxes className="h-4.5 w-4.5" />
              </Link>
            </TooltipTrigger>
            <TooltipContent side="right">App Builder</TooltipContent>
          </Tooltip>

          <div className="flex-1" />

          <Tooltip>
            <TooltipTrigger asChild>
              <Link
                href="/settings"
                className={cn(
                  "mb-2 flex h-9 w-9 items-center justify-center rounded-lg transition-colors",
                  pathname.startsWith("/settings")
                    ? "bg-zinc-800 text-zinc-50"
                    : "text-zinc-500 hover:bg-zinc-900 hover:text-zinc-200"
                )}
              >
                <Settings className="h-4.5 w-4.5" />
              </Link>
            </TooltipTrigger>
            <TooltipContent side="right">Settings</TooltipContent>
          </Tooltip>

          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <button className="flex h-8 w-8 items-center justify-center rounded-full border border-zinc-700 bg-zinc-900 text-xs font-medium text-zinc-200 transition-colors hover:border-zinc-500">
                    {(user?.name ?? user?.email ?? "?").slice(0, 1).toUpperCase()}
                  </button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent side="right">{user?.email ?? "Account"}</TooltipContent>
            </Tooltip>
            <DropdownMenuContent align="end" side="right" className="w-48 border-zinc-800 bg-zinc-900">
              <div className="px-3 py-2 text-xs text-zinc-500">{user?.email}</div>
              <DropdownMenuItem
                onClick={async () => {
                  await api.logout().catch(() => {});
                  router.push("/login");
                }}
                className="text-zinc-300 focus:text-zinc-100"
              >
                <LogOut className="mr-2 h-4 w-4" />
                Log out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Side panel — My Apps */}
        {!collapsed && (
          <aside className="flex w-64 shrink-0 flex-col border-r border-zinc-800/80 bg-zinc-900/40">
            <div className="flex h-12 items-center justify-between border-b border-zinc-800/60 px-3">
              <span className="text-xs font-medium uppercase tracking-wider text-zinc-500">
                My Apps
              </span>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-zinc-500 hover:text-zinc-200"
                onClick={() => setCollapsed(true)}
              >
                <ChevronsLeft className="h-4 w-4" />
              </Button>
            </div>
            <div className="flex-1 overflow-y-auto p-2">
              {apps.length === 0 && (
                <div className="px-3 py-8 text-center text-xs text-zinc-600">
                  No apps yet. Create your first one.
                </div>
              )}
              {apps.map((app) => (
                <div
                  key={app.id}
                  className={cn(
                    "group mb-0.5 flex items-center gap-2 rounded-md px-2 py-2 text-sm transition-colors",
                    app.id === currentAppId
                      ? "bg-zinc-800/80 text-zinc-100"
                      : "text-zinc-400 hover:bg-zinc-800/40 hover:text-zinc-200"
                  )}
                >
                  <Link href={`/builder/${app.id}`} className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <StatusDot status={app.sandboxStatus} />
                      <span className="truncate text-[13px]">{app.name}</span>
                    </div>
                    <div className="mt-0.5 flex items-center gap-2 pl-4 text-[11px] text-zinc-600">
                      <span className="truncate">{templateLabel(app.templateId)}</span>
                      <span>·</span>
                      <span className="shrink-0">{timeAgo(app.updatedAt)}</span>
                    </div>
                  </Link>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button className="hidden h-6 w-6 items-center justify-center rounded text-zinc-600 hover:text-zinc-200 group-hover:flex">
                        <MoreHorizontal className="h-3.5 w-3.5" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-40 border-zinc-800 bg-zinc-900">
                      <DropdownMenuItem
                        onClick={() => handleDelete(app)}
                        className="text-red-400 focus:text-red-300"
                      >
                        <Trash2 className="mr-2 h-4 w-4" />
                        Delete app
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              ))}
            </div>
          </aside>
        )}

        {collapsed && (
          <div className="flex w-10 shrink-0 flex-col items-center border-r border-zinc-800/80 bg-zinc-950 py-3">
            <div className="flex-1" />
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-zinc-600 hover:text-zinc-200"
              onClick={() => setCollapsed(false)}
            >
              <ChevronsRight className="h-4 w-4" />
            </Button>
          </div>
        )}

        {/* Main content */}
        <main className="flex min-w-0 flex-1 flex-col overflow-hidden bg-zinc-950">{children}</main>
      </div>
    </TooltipProvider>
  );
}

export function StatusDot({ status }: { status: string }) {
  const color =
    status === "running"
      ? "bg-emerald-500"
      : status === "starting"
        ? "bg-amber-400"
        : status === "paused"
          ? "bg-zinc-500"
          : status === "error"
            ? "bg-red-500"
            : "bg-zinc-700";
  return (
    <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", color, status === "running" && "shadow-[0_0_6px] shadow-emerald-500/60")} />
  );
}

export function templateLabel(templateId: string): string {
  switch (templateId) {
    case "react-vite": return "React + Vite";
    case "nextjs": return "Next.js";
    case "node-api": return "Node API";
    case "expo": return "Expo";
    case "static": return "Static";
    default: return templateId;
  }
}
