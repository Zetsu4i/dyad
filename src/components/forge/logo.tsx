"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" fill="none" className={cn("h-6 w-6", className)}>
      <rect width="32" height="32" rx="7" fill="#18181b" stroke="#27272a" />
      <path d="M9 23V9h13.5v3.5h-9.4v2.6h7.8v3.5h-7.8V23H9z" fill="#f4f4f5" />
      <rect x="9" y="9" width="13.5" height="3.5" fill="#a1a1aa" opacity="0.35" />
    </svg>
  );
}

export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <Link href="/dashboard" className="flex items-center gap-2.5 group">
      <LogoMark className="h-7 w-7" />
      {!compact && (
        <span className="text-[15px] font-semibold tracking-tight text-zinc-100">
          Forge
        </span>
      )}
    </Link>
  );
}
