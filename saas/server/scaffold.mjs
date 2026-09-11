// Minimal, reliable Vite + React + TS + Tailwind v4 + React Router scaffold.
// Written into every new sandbox (E2B or local fallback) at provision time.
export const SCAFFOLD_FILES = {
  "package.json": JSON.stringify(
    {
      name: "dyad-app",
      private: true,
      version: "0.0.0",
      type: "module",
      scripts: {
        dev: "vite --host 0.0.0.0 --port 5173",
        build: "tsc -b && vite build",
        preview: "vite preview --host 0.0.0.0 --port 4173",
      },
      dependencies: {
        "lucide-react": "^0.462.0",
        react: "^19.2.0",
        "react-dom": "^19.2.0",
        "react-router-dom": "^6.30.0",
      },
      devDependencies: {
        "@tailwindcss/vite": "^4.1.0",
        "@types/node": "^22.5.5",
        "@types/react": "^19.0.0",
        "@types/react-dom": "^19.0.0",
        "@vitejs/plugin-react": "^4.3.4",
        tailwindcss: "^4.1.0",
        typescript: "^5.5.3",
        vite: "^6.0.0",
      },
    },
    null,
    2,
  ),
  "vite.config.ts": `import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

export default defineConfig({
  // relative base keeps the build working under any sub-path (static previews)
  base: "./",
  plugins: [react(), tailwindcss()],
  server: { host: "0.0.0.0", port: 5173 },
  resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
});
`,
  "tsconfig.json": JSON.stringify(
    {
      compilerOptions: {
        target: "ES2022",
        lib: ["ES2022", "DOM", "DOM.Iterable"],
        module: "ESNext",
        moduleResolution: "bundler",
        jsx: "react-jsx",
        strict: true,
        skipLibCheck: true,
        resolveJsonModule: true,
        isolatedModules: true,
        noEmit: true,
        baseUrl: ".",
        paths: { "@/*": ["./src/*"] },
        types: ["vite/client"],
      },
      include: ["src", "vite.config.ts"],
    },
    null,
    2,
  ),
  "index.html": `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Dyad App</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
`,
  "src/main.tsx": `import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
);
`,
  "src/App.tsx": `import { Routes, Route } from "react-router-dom";
import Index from "./pages/Index";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Index />} />
      <Route path="*" element={<Index />} />
    </Routes>
  );
}
`,
  "src/index.css": `@import "tailwindcss";

body {
  font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
}
`,
  "src/vite-env.d.ts": `/// <reference types="vite/client" />
`,
  "src/pages/Index.tsx": `export default function Index() {
  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex items-center justify-center p-8">
      <div className="max-w-xl text-center space-y-4">
        <h1 className="text-4xl font-semibold tracking-tight">Welcome to your app</h1>
        <p className="text-zinc-400">
          Describe what you want to build in the chat, and the agent will create it here.
        </p>
      </div>
    </div>
  );
}
`,
  "src/lib/utils.ts": `export function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}
`,
  "AI_RULES.md": `# Tech Stack
- You are building a React application.
- Use TypeScript.
- Use React Router. KEEP the routes in src/App.tsx
- Always put source code in the src folder.
- Put pages into src/pages/
- Put components into src/components/
- The main page (default page) is src/pages/Index.tsx
- UPDATE the main page to include the new components. OTHERWISE, the user can NOT see any components!
- Tailwind CSS: always use Tailwind CSS for styling components. Utilize Tailwind classes extensively for layout, spacing, colors, and other design aspects.

Available packages and libraries:
- The lucide-react package is installed for icons.
- react-router-dom is installed for routing.
- If you need more packages (e.g. a component library), install them with the add_dependency tool first.
`,
};

export const SCAFFOLD_PATHS = Object.keys(SCAFFOLD_FILES);
