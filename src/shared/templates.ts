export interface Template {
  id: string;
  title: string;
  description: string;
  imageUrl: string;
  githubUrl?: string;
  isOfficial: boolean;
  isExperimental?: boolean;
  requiresNeon?: boolean;
  /** Which project mode this template belongs to. Defaults to web. */
  mode?: "web" | "mobile" | "general";
}

// API Template interface from the external API
export interface ApiTemplate {
  githubOrg: string;
  githubRepo: string;
  title: string;
  description: string;
  imageUrl: string;
}

export const DEFAULT_TEMPLATE_ID = "react";
export const DEFAULT_TEMPLATE = {
  id: "react",
  title: "React.js Template",
  description: "Uses React.js, Vite, Shadcn, Tailwind and TypeScript.",
  imageUrl:
    "https://github.com/user-attachments/assets/5b700eab-b28c-498e-96de-8649b14c16d9",
  isOfficial: true,
};

const PORTAL_MINI_STORE_ID = "portal-mini-store";
export const NEON_TEMPLATE_IDS = new Set<string>([PORTAL_MINI_STORE_ID]);

export const localTemplatesData: Template[] = [
  DEFAULT_TEMPLATE,
  {
    id: "next",
    title: "Next.js Template",
    description: "Uses Next.js, React.js, Shadcn, Tailwind and TypeScript.",
    imageUrl:
      "https://github.com/user-attachments/assets/96258e4f-abce-4910-a62a-a9dff77965f2",
    githubUrl: "https://github.com/dyad-sh/nextjs-template",
    isOfficial: true,
  },
  {
    id: "react-vite-nitro",
    title: "Fullstack Vite+Nitro Template",
    description:
      "Full-stack React + Vite + Nitro backend with Shadcn, Tailwind, TypeScript.",
    imageUrl:
      "https://github.com/user-attachments/assets/5b700eab-b28c-498e-96de-8649b14c16d9",
    githubUrl: "https://github.com/dyad-sh/react-vite-nitro",
    isOfficial: true,
    isExperimental: true,
  },
  {
    id: PORTAL_MINI_STORE_ID,
    title: "Portal: Mini Store Template",
    description: "Uses Neon DB, Payload CMS, Next.js",
    imageUrl:
      "https://github.com/user-attachments/assets/ed86f322-40bf-4fd5-81dc-3b1d8a16e12b",
    githubUrl: "https://github.com/dyad-sh/portal-mini-store-template",
    isOfficial: true,
    isExperimental: true,
    requiresNeon: true,
    mode: "web",
  },
  {
    id: "expo",
    title: "Expo Mobile App",
    description:
      "React Native with Expo: run on iOS/Android devices and in the browser. Executes in the E2B sandbox with QR/device info in the console.",
    imageUrl:
      "https://github.com/user-attachments/assets/5b700eab-b28c-498e-96de-8649b14c16d9",
    isOfficial: true,
    mode: "mobile",
  },
  {
    id: "general",
    title: "General Sandbox Project",
    description:
      "A general-purpose cloud coding environment: scripts, CLI tools, data processing, builds — not tied to web or mobile. Use with E2B mode.",
    imageUrl:
      "https://github.com/user-attachments/assets/5b700eab-b28c-498e-96de-8649b14c16d9",
    isOfficial: true,
    mode: "general",
  },
];

export function templatesForMode(
  templates: Template[],
  mode: "web" | "mobile" | "general",
): Template[] {
  return templates.filter(
    (template) => (template.mode ?? "web") === mode,
  );
}
