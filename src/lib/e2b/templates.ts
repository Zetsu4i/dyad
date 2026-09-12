// Project starter templates — scaffolded into E2B sandboxes at /app.
// Each template defines starter files, install + dev commands, and the preview port.

export interface ProjectTemplate {
  id: string;
  title: string;
  description: string;
  icon: string; // lucide icon key used by the UI
  port: number;
  installCmd: string;
  devCmd: string;
  files: Record<string, string>;
  badge?: string;
}

const VITE_REACT_PACKAGE_JSON = `{
  "name": "forge-app",
  "private": true,
  "version": "0.0.1",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "lucide-react": "^0.525.0",
    "react": "^19.1.0",
    "react-dom": "^19.1.0"
  },
  "devDependencies": {
    "@tailwindcss/vite": "^4.1.10",
    "@types/react": "^19.1.8",
    "@types/react-dom": "^19.1.6",
    "@vitejs/plugin-react": "^4.6.0",
    "tailwindcss": "^4.1.10",
    "typescript": "~5.8.3",
    "vite": "^6.3.5"
  }
}
`;

const VITE_CONFIG = `import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: true,
    port: 5173,
    strictPort: true,
    allowedHosts: true,
  },
})
`;

const VITE_INDEX_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Forge App</title>
  </head>
  <body class="bg-zinc-950 text-zinc-100 antialiased">
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
`;

const VITE_MAIN_TSX = `import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
`;

const VITE_INDEX_CSS = `@import "tailwindcss";
`;

const VITE_APP_TSX = `import { Sparkles, ArrowRight } from 'lucide-react'

export default function App() {
  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex items-center justify-center p-8">
      <div className="max-w-xl w-full">
        <div className="inline-flex items-center gap-2 rounded-full border border-zinc-800 bg-zinc-900 px-3 py-1 text-xs text-zinc-400">
          <Sparkles className="h-3 w-3" />
          Built with Forge
        </div>
        <h1 className="mt-6 text-4xl font-semibold tracking-tight">
          Your app starts here
        </h1>
        <p className="mt-4 text-zinc-400 leading-relaxed">
          Describe what you want to build in the chat panel. The agent will
          create and edit files, run commands, and keep this live preview
          up to date.
        </p>
        <a
          href="#"
          className="mt-8 inline-flex items-center gap-2 rounded-lg bg-zinc-100 px-4 py-2.5 text-sm font-medium text-zinc-900 hover:bg-white transition-colors"
        >
          Get started
          <ArrowRight className="h-4 w-4" />
        </a>
      </div>
    </div>
  )
}
`;

const VITE_TSCONFIG = `{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true,
    "isolatedModules": true
  },
  "include": ["src"]
}
`;

const NEXT_PACKAGE_JSON = `{
  "name": "forge-next-app",
  "private": true,
  "version": "0.0.1",
  "scripts": {
    "dev": "next dev -p 3000 -H 0.0.0.0",
    "build": "next build",
    "start": "next start -p 3000 -H 0.0.0.0"
  },
  "dependencies": {
    "next": "^15.3.3",
    "react": "^19.1.0",
    "react-dom": "^19.1.0"
  },
  "devDependencies": {
    "@types/react": "^19.1.8",
    "@types/react-dom": "^19.1.6",
    "typescript": "^5.8.3"
  }
}
`;

const NEXT_CONFIG_TS = `import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["*.e2b.app", "*.e2b-staging.app"],
};

export default nextConfig;
`;

const NEXT_LAYOUT_TSX = `import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Forge Next App",
  description: "Built with Forge",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="bg-zinc-950 text-zinc-100 antialiased">{children}</body>
    </html>
  );
}
`;

const NEXT_PAGE_TSX = `export default function Home() {
  return (
    <main className="min-h-screen flex items-center justify-center p-8">
      <div className="max-w-xl">
        <h1 className="text-4xl font-semibold tracking-tight">
          Your Next.js app starts here
        </h1>
        <p className="mt-4 text-zinc-400 leading-relaxed">
          Describe what you want to build in the chat panel. The agent will
          create pages, components and API routes, then verify them with real
          commands in the sandbox.
        </p>
      </div>
    </main>
  );
}
`;

const NEXT_GLOBALS_CSS = `@import "tailwindcss";
`;

const NEXT_TSCONFIG = `{
  "compilerOptions": {
    "target": "ES2017",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
`;

const NODE_API_PACKAGE_JSON = `{
  "name": "forge-node-api",
  "private": true,
  "version": "0.0.1",
  "type": "module",
  "scripts": {
    "dev": "node server.js"
  },
  "dependencies": {
    "cors": "^2.8.5",
    "express": "^5.1.0"
  }
}
`;

const NODE_API_SERVER = `import express from 'express'
import cors from 'cors'

const app = express()
const PORT = process.env.PORT || 3000

app.use(cors())
app.use(express.json())

const items = [
  { id: 1, name: 'First item', done: false },
  { id: 2, name: 'Second item', done: true },
]

app.get('/api/items', (req, res) => {
  res.json(items)
})

app.post('/api/items', (req, res) => {
  const { name } = req.body ?? {}
  if (!name) return res.status(400).json({ error: 'name is required' })
  const item = { id: items.length + 1, name, done: false }
  items.push(item)
  res.status(201).json(item)
})

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() })
})

app.listen(PORT, '0.0.0.0', () => {
  console.log(\`API listening on port \${PORT}\`)
})
`;

const STATIC_INDEX_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Forge Static App</title>
    <link rel="stylesheet" href="styles.css" />
  </head>
  <body>
    <main>
      <h1>Your static app starts here</h1>
      <p>
        Describe what you want to build in the chat panel. The agent will edit
        these HTML, CSS and JavaScript files directly — refresh the preview to
        see changes.
      </p>
      <button id="counter">Clicked 0 times</button>
    </main>
    <script src="app.js"></script>
  </body>
</html>
`;

const STATIC_STYLES_CSS = `* { box-sizing: border-box; margin: 0; }

body {
  font-family: ui-sans-serif, system-ui, -apple-system, sans-serif;
  background: #09090b;
  color: #f4f4f5;
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
}

main {
  max-width: 40rem;
  padding: 2rem;
}

h1 { font-size: 2rem; font-weight: 600; letter-spacing: -0.02em; }

p {
  margin-top: 1rem;
  color: #a1a1aa;
  line-height: 1.6;
}

button {
  margin-top: 1.5rem;
  padding: 0.6rem 1.2rem;
  border-radius: 0.5rem;
  border: 1px solid #3f3f46;
  background: #18181b;
  color: #f4f4f5;
  font-size: 0.9rem;
  cursor: pointer;
}

button:hover { background: #27272a; }
`;

const STATIC_APP_JS = `let count = 0
const btn = document.getElementById('counter')
btn.addEventListener('click', () => {
  count++
  btn.textContent = \`Clicked \${count} times\`
})
`;

const EXPO_APP_TSX = `import { StatusBar } from 'expo-status-bar'
import { StyleSheet, Text, View } from 'react-native'

export default function App() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Your Expo app starts here</Text>
      <Text style={styles.subtitle}>
        Describe what you want to build in the chat panel. Preview the web
        version here, then run it on iOS/Android with the Expo Go app.
      </Text>
      <StatusBar style="light" />
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#09090b',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    gap: 12,
  },
  title: {
    color: '#f4f4f5',
    fontSize: 28,
    fontWeight: '700',
    textAlign: 'center',
  },
  subtitle: {
    color: '#a1a1aa',
    fontSize: 16,
    lineHeight: 24,
    textAlign: 'center',
    maxWidth: 480,
  },
})
`;

const EXPO_PACKAGE_JSON = `{
  "name": "forge-expo-app",
  "version": "1.0.0",
  "main": "index.ts",
  "scripts": {
    "start": "EXPO_NO_TELEMETRY=1 npx expo start --web --port 8081 --host lan",
    "android": "expo start --android",
    "ios": "expo start --ios",
    "web": "expo start --web"
  },
  "dependencies": {
    "expo": "~53.0.17",
    "expo-status-bar": "~2.2.3",
    "react": "19.0.0",
    "react-dom": "19.0.0",
    "react-native": "0.79.5",
    "react-native-web": "^0.20.0"
  },
  "devDependencies": {
    "@types/react": "~19.0.10"
  },
  "private": true
}
`;

const EXPO_INDEX_TS = `import { registerRootComponent } from 'expo'
import App from './App'

registerRootComponent(App)
`;

const EXPO_APP_JSON = `{
  "expo": {
    "name": "Forge Expo App",
    "slug": "forge-expo-app",
    "version": "1.0.0",
    "orientation": "portrait",
    "userInterfaceStyle": "dark",
    "platforms": ["ios", "android", "web"],
    "web": {
      "bundler": "metro",
      "output": "single",
      "favicon": "./assets/favicon.png"
    },
    "experiments": {
      "typedRoutes": true
    }
  }
}
`;

export const TEMPLATES: ProjectTemplate[] = [
  {
    id: "react-vite",
    title: "React + Vite",
    description: "React 19, TypeScript, Tailwind CSS 4. Fast SPA with live HMR preview.",
    icon: "atom",
    port: 5173,
    installCmd: "npm install --no-audit --no-fund --loglevel=error",
    devCmd: "npx vite --host 0.0.0.0 --port 5173 --strictPort",
    files: {
      "package.json": VITE_REACT_PACKAGE_JSON,
      "vite.config.ts": VITE_CONFIG,
      "index.html": VITE_INDEX_HTML,
      "tsconfig.json": VITE_TSCONFIG,
      "src/main.tsx": VITE_MAIN_TSX,
      "src/index.css": VITE_INDEX_CSS,
      "src/App.tsx": VITE_APP_TSX,
      "README.md": "# Forge App\n\nReact + Vite + Tailwind app built with Forge.\n\n- `npm run dev` — start dev server\n- `npm run build` — production build\n",
    },
  },
  {
    id: "nextjs",
    title: "Next.js",
    description: "Next.js 15 App Router with TypeScript. Fullstack pages and API routes.",
    icon: "layers",
    port: 3000,
    installCmd: "npm install --no-audit --no-fund --loglevel=error",
    devCmd: "npm run dev",
    files: {
      "package.json": NEXT_PACKAGE_JSON,
      "next.config.ts": NEXT_CONFIG_TS,
      "tsconfig.json": NEXT_TSCONFIG,
      "app/layout.tsx": NEXT_LAYOUT_TSX,
      "app/page.tsx": NEXT_PAGE_TSX,
      "app/globals.css": NEXT_GLOBALS_CSS,
      "README.md": "# Forge Next.js App\n\nNext.js 15 App Router app built with Forge.\n\n- `npm run dev` — start dev server\n- `npm run build` — production build\n",
    },
  },
  {
    id: "node-api",
    title: "Node.js API",
    description: "Express 5 REST API with CORS and JSON handling. Pure backend service.",
    icon: "server",
    port: 3000,
    installCmd: "npm install --no-audit --no-fund --loglevel=error",
    devCmd: "node server.js",
    files: {
      "package.json": NODE_API_PACKAGE_JSON,
      "server.js": NODE_API_SERVER,
      "README.md": "# Forge Node API\n\nExpress API built with Forge.\n\n- `GET /api/items`, `POST /api/items`, `GET /api/health`\n- `npm run dev` — start server\n",
    },
  },
  {
    id: "expo",
    title: "Expo (React Native)",
    description: "Expo SDK 53 app for iOS, Android and Web from one codebase.",
    icon: "smartphone",
    port: 8081,
    installCmd: "npm install --no-audit --no-fund --loglevel=error",
    devCmd: "EXPO_NO_TELEMETRY=1 npx expo start --web --port 8081 --host lan",
    files: {
      "package.json": EXPO_PACKAGE_JSON,
      "app.json": EXPO_APP_JSON,
      "index.ts": EXPO_INDEX_TS,
      "App.tsx": EXPO_APP_TSX,
      "README.md": "# Forge Expo App\n\nExpo app built with Forge.\n\n- Web preview runs in the Preview panel\n- `npx expo start` in the sandbox for device testing via Expo Go\n",
    },
    badge: "Mobile",
  },
  {
    id: "static",
    title: "Static HTML",
    description: "Plain HTML, CSS and JavaScript. Zero build step, instant preview.",
    icon: "file-code",
    port: 4173,
    installCmd: "echo 'no dependencies to install'",
    devCmd: "npx -y http-server /app -p 4173 -c-1 --silent",
    files: {
      "index.html": STATIC_INDEX_HTML,
      "styles.css": STATIC_STYLES_CSS,
      "app.js": STATIC_APP_JS,
      "README.md": "# Forge Static App\n\nStatic site built with Forge. Edit HTML/CSS/JS directly.\n",
    },
  },
];

export function getTemplate(id: string): ProjectTemplate {
  return TEMPLATES.find((t) => t.id === id) ?? TEMPLATES[0];
}

// Paths the file tree, editor, and agent context should skip.
export const IGNORED_PATH_PREFIXES = [
  "node_modules/",
  ".git/",
  ".next/",
  "dist/",
  "build/",
  ".expo/",
  ".cache/",
  ".skills/",
];
