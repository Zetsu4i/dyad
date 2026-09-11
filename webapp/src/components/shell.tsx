"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Hammer, Boxes, Plug, GraduationCap, Settings } from "lucide-react";
import type { ReactNode } from "react";

const NAV = [
  { href: "/", label: "Apps", icon: Boxes, exact: true },
  { href: "/settings", label: "Settings", icon: Settings, tab: "general" },
  { href: "/settings?tab=mcp", label: "MCP Servers", icon: Plug, tab: "mcp" },
  { href: "/settings?tab=skills", label: "Skills", icon: GraduationCap, tab: "skills" },
];

/** App shell: fixed enterprise sidebar + content area. */
export function Shell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return (
    <div className="flex min-h-screen">
      <aside className="fixed inset-y-0 left-0 z-40 flex w-60 flex-col border-r border-zinc-800/80 bg-[var(--surface)]">
        <div className="flex h-14 items-center gap-2.5 border-b border-zinc-800/80 px-5">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-500 text-[13px] font-bold text-white">
            D
          </span>
          <div className="leading-tight">
            <p className="text-sm font-semibold tracking-tight text-zinc-100">Dyad Cloud</p>
            <p className="text-2xs text-zinc-500">AI App Builder</p>
          </div>
        </div>
        <nav className="flex-1 space-y-0.5 px-3 py-4">
          {NAV.map((item) => {
            const base = item.href.split("?")[0];
            const active = item.exact
              ? pathname === base
              : pathname.startsWith(base) && (item.tab ? true : true);
            const isActive = item.exact
              ? pathname === base
              : pathname.startsWith("/settings");
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors ${
                  isActive && (item.exact || item.href.startsWith("/settings"))
                    ? "bg-zinc-800/80 text-zinc-100"
                    : "text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-200"
                }`}
              >
                <item.icon className="h-4 w-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="border-t border-zinc-800/80 px-4 py-3">
          <div className="flex items-center gap-2 text-2xs text-zinc-600">
            <Hammer className="h-3 w-3" />
            <span>Powered by Dyad + E2B</span>
          </div>
        </div>
      </aside>
      <main className="ml-60 flex-1">{children}</main>
    </div>
  );
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between border-b border-zinc-800/80 px-8 py-5">
      <div>
        <h1 className="text-lg font-semibold tracking-tight text-zinc-100">{title}</h1>
        {description ? <p className="mt-0.5 text-xs text-zinc-500">{description}</p> : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
  );
}
