import path from "path";
import fs from "fs-extra";
import { app } from "electron";
import { copyDirectoryRecursive } from "../utils/file_utils";
import { gitClone, getCurrentCommitHash } from "../utils/git_utils";
import { readSettings } from "@/main/settings";
import { getTemplateOrThrow } from "../utils/template_utils";
import log from "electron-log";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";

const logger = log.scope("createFromTemplate");


/**
 * Minimal, valid Expo (React Native) starter. Written inline so the template
 * never depends on an external repository being reachable.
 */
async function writeExpoStarter(fullAppPath: string): Promise<void> {
  await fs.ensureDir(fullAppPath);
  await fs.writeJSON(
    path.join(fullAppPath, "package.json"),
    {
      name: "dyad-expo-app",
      version: "1.0.0",
      main: "node_modules/expo/AppEntry.js",
      scripts: {
        dev: "expo start --web",
        start: "expo start",
        android: "expo start --android",
        ios: "expo start --ios",
        web: "expo start --web",
      },
      dependencies: {
        expo: "~52.0.0",
        react: "18.3.1",
        "react-native": "0.76.5",
        "react-dom": "18.3.1",
      },
      devDependencies: {
        "@types/react": "~18.3.12",
        typescript: "~5.3.3",
      },
      private: true,
    },
    { spaces: 2 },
  );
  await fs.writeJSON(
    path.join(fullAppPath, "app.json"),
    {
      expo: {
        name: "Dyad Mobile App",
        slug: "dyad-mobile-app",
        version: "1.0.0",
        orientation: "portrait",
        userInterfaceStyle: "light",
        web: { bundler: "metro", output: "single" },
        platforms: ["ios", "android", "web"],
      },
    },
    { spaces: 2 },
  );
  await fs.writeFile(
    path.join(fullAppPath, "App.tsx"),
    `import { StyleSheet, Text, View } from "react-native";

export default function App() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Welcome to your Dyad mobile app</Text>
      <Text style={styles.subtitle}>Edit App.tsx and ask the agent to build features.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  title: {
    fontSize: 20,
    fontWeight: "bold",
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
    color: "#666",
    textAlign: "center",
  },
});
`,
    "utf8",
  );
  await fs.writeFile(
    path.join(fullAppPath, "tsconfig.json"),
    JSON.stringify(
      {
        extends: "expo/tsconfig.base",
        compilerOptions: { strict: true },
      },
      null,
      2,
    ),
    "utf8",
  );
  await fs.writeFile(
    path.join(fullAppPath, ".gitignore"),
    "node_modules/\n.expo/\ndist/\nweb-build/\nexpo-env.d.ts\n",
    "utf8",
  );
}

/**
 * General-mode starter: an empty-but-documented project folder. The sandbox
 * is the workspace; the agent fills it in with run_command + write_file.
 */
async function writeGeneralStarter(fullAppPath: string): Promise<void> {
  await fs.ensureDir(fullAppPath);
  await fs.writeFile(
    path.join(fullAppPath, "README.md"),
    `# Project

This is a general-purpose project that runs inside an E2B sandbox.

- The agent can run shell commands in the sandbox with the run_command tool
  (working directory /home/user/app).
- Files you create with write_file persist in the project; files created by
  sandbox commands stay in the sandbox session.
- Use the E2B console in the preview panel to run commands yourself.
`,
    "utf8",
  );
  await fs.writeFile(
    path.join(fullAppPath, ".gitignore"),
    "node_modules/\n.env\n",
    "utf8",
  );
}


export async function createFromTemplate({
  fullAppPath,
  templateId: requestedTemplateId,
}: {
  fullAppPath: string;
  templateId?: string;
}) {
  const settings = readSettings();
  const templateId = requestedTemplateId ?? settings.selectedTemplateId;

  if (templateId === "react") {
    const sourceScaffoldPath = path.join(__dirname, "..", "..", "scaffold");
    const repoScaffoldPath = path.join(process.cwd(), "scaffold");
    await copyDirectoryRecursive(
      fs.existsSync(sourceScaffoldPath) ? sourceScaffoldPath : repoScaffoldPath,
      fullAppPath,
    );
    return;
  }

  if (templateId === "expo") {
    await writeExpoStarter(fullAppPath);
    return;
  }

  if (templateId === "general") {
    await writeGeneralStarter(fullAppPath);
    return;
  }

  const template = await getTemplateOrThrow(templateId);
  if (!template.githubUrl) {
    throw new DyadError(
      `Template ${templateId} has no GitHub URL`,
      DyadErrorKind.External,
    );
  }
  const repoCachePath = await cloneRepo(template.githubUrl);
  await copyRepoToApp(repoCachePath, fullAppPath);
}

async function cloneRepo(repoUrl: string): Promise<string> {
  const url = new URL(repoUrl);
  if (url.protocol !== "https:") {
    throw new DyadError(
      "Repository URL must use HTTPS.",
      DyadErrorKind.External,
    );
  }
  if (url.hostname !== "github.com") {
    throw new DyadError(
      "Repository URL must be a github.com URL.",
      DyadErrorKind.Validation,
    );
  }

  // Pathname will be like "/org/repo" or "/org/repo.git"
  const pathParts = url.pathname.split("/").filter((part) => part.length > 0);

  if (pathParts.length !== 2) {
    throw new Error(
      "Invalid repository URL format. Expected 'https://github.com/org/repo'",
    );
  }

  const orgName = pathParts[0];
  const repoName = path.basename(pathParts[1], ".git"); // Remove .git suffix if present

  if (!orgName || !repoName) {
    // This case should ideally be caught by pathParts.length !== 2
    throw new Error(
      "Failed to parse organization or repository name from URL.",
    );
  }
  logger.info(`Parsed org: ${orgName}, repo: ${repoName} from ${repoUrl}`);

  const cachePath = path.join(
    app.getPath("userData"),
    "templates",
    orgName,
    repoName,
  );

  if (fs.existsSync(cachePath)) {
    try {
      logger.info(
        `Repo ${repoName} already exists in cache at ${cachePath}. Checking for updates.`,
      );

      // Construct GitHub API URL
      const apiUrl = `https://api.github.com/repos/${orgName}/${repoName}/commits/HEAD`;
      logger.info(`Fetching remote SHA from ${apiUrl}`);

      // Use native fetch for the template archive.
      const response = await fetch(apiUrl, {
        method: "GET",
        headers: {
          "User-Agent": "Dyad", // GitHub API requires this
          Accept: "application/vnd.github.v3+json",
        },
      });
      // Handle non-200 responses
      if (!response.ok) {
        throw new Error(
          `GitHub API request failed with status ${response.status}: ${response.statusText}`,
        );
      }
      // Parse JSON directly (fetch handles streaming internally)
      const commitData = await response.json();
      const remoteSha = commitData.sha;
      if (!remoteSha) {
        throw new DyadError(
          "SHA not found in GitHub API response.",
          DyadErrorKind.NotFound,
        );
      }

      logger.info(`Successfully fetched remote SHA: ${remoteSha}`);

      // Compare with local SHA
      const localSha = await getCurrentCommitHash({ path: cachePath });

      if (remoteSha === localSha) {
        logger.info(
          `Local cache for ${repoName} is up to date (SHA: ${localSha}). Skipping clone.`,
        );
        return cachePath;
      } else {
        logger.info(
          `Local cache for ${repoName} (SHA: ${localSha}) is outdated (Remote SHA: ${remoteSha}). Removing and re-cloning.`,
        );
        fs.rmSync(cachePath, { recursive: true, force: true });
        // Continue to clone…
      }
    } catch (err) {
      logger.warn(
        `Error checking for updates or comparing SHAs for ${repoName} at ${cachePath}. Will attempt to re-clone. Error: `,
        err,
      );
      return cachePath;
    }
  }

  fs.ensureDirSync(path.dirname(cachePath));

  logger.info(`Cloning ${repoUrl} to ${cachePath}`);
  try {
    await gitClone({ path: cachePath, url: repoUrl, depth: 1 });
    logger.info(`Successfully cloned ${repoUrl} to ${cachePath}`);
  } catch (err) {
    logger.error(`Failed to clone ${repoUrl} to ${cachePath}: `, err);
    throw err; // Re-throw the error after logging
  }
  return cachePath;
}

async function copyRepoToApp(repoCachePath: string, appPath: string) {
  logger.info(`Copying from ${repoCachePath} to ${appPath}`);
  try {
    await fs.copy(repoCachePath, appPath, {
      filter: (src, _dest) => {
        const excludedDirs = ["node_modules", ".git"];
        const relativeSrc = path.relative(repoCachePath, src);
        if (excludedDirs.includes(path.basename(relativeSrc))) {
          logger.info(`Excluding ${src} from copy`);
          return false;
        }
        return true;
      },
    });
    logger.info("Finished copying repository contents.");
  } catch (err) {
    logger.error(
      `Error copying repository from ${repoCachePath} to ${appPath}: `,
      err,
    );
    throw err; // Re-throw the error after logging
  }
}
