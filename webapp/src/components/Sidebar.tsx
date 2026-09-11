import React from "react";
import { Link, useLocation } from "react-router-dom";
import { useAppStore } from "../lib/store";
import { Logo } from "./Logo";
import {
  Boxes,
  LayoutDashboard,
  Plug,
  Settings,
  Hammer,
  Cloud,
  HardDrive,
} from "lucide-react";

const NAV = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, exact: true },
  { to: "/build", label: "Build an app", icon: Hammer },
  { to: "/apps", label: "My apps", icon: Boxes },
  { to: "/integrations", label: "Integrations", icon: Plug },
];

export default function Sidebar() {
  const location = useLocation();
  const { settings } = useAppStore();

  const isActive = (item: (typeof NAV)[number]) =>
    item.exact ? location.pathname === item.to : location.pathname.startsWith(item.to);

  return (
    <aside className="flex w-56 shrink-0 flex-col border-r border-line bg-surface-1">
      {/* Brand */}
      <Link to="/" className="flex h-14 items-center gap-2.5 border-b border-line px-4">
        <Logo size={26} />
        <div className="leading-tight">
          <div className="text-[13px] font-semibold tracking-tight">Dyad Cloud</div>
          <div className="text-[10px] text-ink-faint">AI app builder</div>
        </div>
      </Link>

      {/* Primary nav */}
      <nav className="flex-1 overflow-y-auto px-2.5 py-3">
        <div className="mb-1 px-2 text-[10px] font-semibold uppercase tracking-wider text-ink-faint">
          Workspace
        </div>
        <div className="space-y-0.5">
          {NAV.map((item) => {
            const Icon = item.icon;
            const active = isActive(item);
            return (
              <Link
                key={item.to}
                to={item.to}
                className={`relative flex items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px] font-medium transition-colors ${
                  active
                    ? "bg-surface-3 text-ink"
                    : "text-ink-mute hover:bg-surface-2 hover:text-ink-dim"
                }`}
              >
                {active && (
                  <span className="absolute left-0 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-full bg-accent" />
                )}
                <Icon size={15} className={active ? "text-accent" : "text-ink-faint"} />
                {item.label}
              </Link>
            );
          })}
        </div>

        <div className="mb-1 mt-6 px-2 text-[10px] font-semibold uppercase tracking-wider text-ink-faint">
          Configuration
        </div>
        <Link
          to="/settings"
          className={`relative flex items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px] font-medium transition-colors ${
            location.pathname.startsWith("/settings")
              ? "bg-surface-3 text-ink"
              : "text-ink-mute hover:bg-surface-2 hover:text-ink-dim"
          }`}
        >
          {location.pathname.startsWith("/settings") && (
            <span className="absolute left-0 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-full bg-accent" />
          )}
          <Settings size={15} className={location.pathname.startsWith("/settings") ? "text-accent" : "text-ink-faint"} />
          Settings
        </Link>
      </nav>

      {/* Runtime + user */}
      <div className="border-t border-line p-3">
        <div className="mb-2.5 flex items-center gap-2 rounded-md border border-line bg-surface-2 px-2.5 py-2">
          {settings?.runtimeMode === "e2b" ? (
            <Cloud size={13} className="shrink-0 text-ok" />
          ) : (
            <HardDrive size={13} className="shrink-0 text-ink-faint" />
          )}
          <div className="min-w-0 leading-tight">
            <div className="text-[11px] font-medium text-ink-dim">
              {settings?.runtimeMode === "e2b" ? "E2B sandboxes" : "Local runtime"}
            </div>
            <div className="truncate text-[10px] text-ink-faint">
              {settings?.runtimeMode === "e2b" ? "cloud isolated" : "dev fallback"}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent-soft text-[11px] font-semibold text-accent ring-1 ring-accent/30">
            D
          </div>
          <div className="min-w-0 flex-1 leading-tight">
            <div className="truncate text-[12px] font-medium text-ink-dim">Workspace</div>
            <div className="truncate text-[10px] text-ink-faint">demo mode</div>
          </div>
        </div>
      </div>
    </aside>
  );
}
