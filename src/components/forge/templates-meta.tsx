import { Atom, Layers, Server, Smartphone, FileCode, Boxes } from "lucide-react";

// Client-safe template metadata for UI rendering.
export const TEMPLATES_META: { id: string; title: string; description: string; badge?: string }[] = [
  { id: "react-vite", title: "React + Vite", description: "React 19, TypeScript, Tailwind CSS 4. Fast SPA with live HMR." },
  { id: "nextjs", title: "Next.js", description: "Next.js 15 App Router with TypeScript. Pages + API routes." },
  { id: "node-api", title: "Node.js API", description: "Express 5 REST API. Pure backend service." },
  { id: "expo", title: "Expo (React Native)", description: "iOS, Android and Web from one codebase.", badge: "Mobile" },
  { id: "static", title: "Static HTML", description: "Plain HTML, CSS, JS. Zero build step." },
];

export const TEMPLATE_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  "react-vite": Atom,
  nextjs: Layers,
  "node-api": Server,
  expo: Smartphone,
  static: FileCode,
};

export function TemplateIcon({ id, className }: { id: string; className?: string }) {
  const Icon = TEMPLATE_ICONS[id] ?? Boxes;
  return <Icon className={className} />;
}
