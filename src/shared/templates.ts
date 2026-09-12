export interface Template {
  id: string;
  title: string;
  description: string;
  imageUrl: string;
  githubUrl?: string;
  isOfficial: boolean;
  isExperimental?: boolean;
  requiresNeon?: boolean;
  /** App type the template targets — drives the builder's app-type switcher. */
  category?: "web" | "mobile" | "fullstack" | "general";
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

/** Template used for the "General" app type (anything the agent can build). */
export const GENERAL_TEMPLATE_ID = "node";
/** Template used for the "Mobile" app type (Expo / React Native). */
export const MOBILE_TEMPLATE_ID = "expo";

/**
 * Maps the builder's app-type switcher to a template id.
 */
export function templateIdForAppType(appType: "web" | "mobile" | "general"): string {
  switch (appType) {
    case "mobile":
      return MOBILE_TEMPLATE_ID;
    case "general":
      return GENERAL_TEMPLATE_ID;
    default:
      return DEFAULT_TEMPLATE_ID;
  }
}

const PORTAL_MINI_STORE_ID = "portal-mini-store";
export const NEON_TEMPLATE_IDS = new Set<string>([PORTAL_MINI_STORE_ID]);

export const localTemplatesData: Template[] = [
  { ...DEFAULT_TEMPLATE, category: "web" },
  {
    id: "next",
    title: "Next.js Template",
    description: "Uses Next.js, React.js, Shadcn, Tailwind and TypeScript.",
    imageUrl:
      "https://github.com/user-attachments/assets/96258e4f-abce-4910-a62a-a9dff77965f2",
    githubUrl: "https://github.com/dyad-sh/nextjs-template",
    isOfficial: true,
    category: "fullstack",
  },
  {
    id: "expo",
    title: "Expo Mobile App",
    description:
      "React Native + Expo (TypeScript, Expo Router). Preview in the browser via Expo web; run on devices with Expo Go.",
    imageUrl:
      "https://github.com/user-attachments/assets/96258e4f-abce-4910-a62a-a9dff77965f2",
    githubUrl: "https://github.com/expo/expo-template-default",
    isOfficial: true,
    category: "mobile",
  },
  {
    id: "node",
    title: "General (Node.js)",
    description:
      "Minimal Node.js server — a blank canvas for anything: APIs, scripts, bots, tools, full custom apps.",
    imageUrl:
      "https://github.com/user-attachments/assets/5b700eab-b28c-498e-96de-8649b14c16d9",
    isOfficial: true,
    category: "general",
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
    category: "fullstack",
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
    category: "fullstack",
  },
];
