import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { appFiles, apps, type App } from "../db/schema";
import {
  getE2BApiKey,
  getRunner,
  getSetting,
  SETTINGS_KEYS,
  setSetting,
} from "../db/settings";
import { E2BRunner } from "./runner/e2b-runner";
import { LocalRunner } from "./runner/local-runner";
import { AppRunner, SandboxFile, safeAppPath } from "./runner/types";
import { templateFiles } from "./template-files";
import { getEnabledSkillsForApp, skillSandboxFiles } from "../skills/manager";

/**
 * Sandbox manager — single entry point the rest of the server uses to talk to
 * sandboxes. Owns per-app job serialization, status tracking and the
 * template/skills sync.
 */

const managers: { current?: SandboxManager } = { current: undefined };

class JobQueue {
  private chains = new Map<number, Promise<unknown>>();
  run<T>(appId: number, fn: () => Promise<T>): Promise<T> {
    const prev = this.chains.get(appId) ?? Promise.resolve();
    const next = prev.then(fn, fn);
    this.chains.set(appId, next.catch(() => {}));
    return next;
  }
}

export class SandboxManager {
  private e2b: E2BRunner;
  private local: LocalRunner;
  private queue = new JobQueue();

  constructor() {
    this.e2b = new E2BRunner({
      apiKey: () => getE2BApiKey(),
      template: () => {
        const t = require("../db/settings").getSetting(
          SETTINGS_KEYS.e2bTemplate,
        );
        return t || undefined;
      },
    });
    this.local = new LocalRunner();
  }

  runnerFor(app: App): AppRunner {
    const kind =
      app.runner === "local"
        ? "local"
        : app.runner === "e2b"
          ? "e2b"
          : getRunner();
    return kind === "local" ? this.local : this.e2b;
  }

  private async setStatus(appId: number, status: string, lastError?: string | null) {
    db.update(apps)
      .set({
        status,
        updatedAt: new Date(),
        ...(lastError !== undefined ? { lastError: lastError ?? null } : {}),
      })
      .where(eq(apps.id, appId))
      .run();
  }

  getApp(appId: number): App {
    const app = db.select().from(apps).where(eq(apps.id, appId)).get() as App | undefined;
    if (!app) throw new Error(`App ${appId} not found`);
    return app;
  }

  /** All files of an app as a plain map. */
  filesMap(appId: number): Record<string, string> {
    const rows = db
      .select()
      .from(appFiles)
      .where(eq(appFiles.appId, appId))
      .all() as { path: string; content: string }[];
    return Object.fromEntries(rows.map((r) => [r.path, r.content]));
  }

  filesList(appId: number): SandboxFile[] {
    const rows = db
      .select()
      .from(appFiles)
      .where(eq(appFiles.appId, appId))
      .all() as { path: string; content: string }[];
    return rows.map((r) => ({ path: r.path, content: r.content }));
  }

  /** Seed a brand-new app: template files into the DB. */
  async createApp(opts: { name: string; slug: string; description?: string }): Promise<App> {
    const runner = getRunner();
    const inserted = db
      .insert(apps)
      .values({
        name: opts.name,
        slug: opts.slug,
        description: opts.description ?? null,
        runner,
        status: "idle",
      })
      .returning()
      .get() as App;
    for (const f of templateFiles()) {
      db.insert(appFiles)
        .values({ appId: inserted.id, path: f.path, content: f.content })
        .run();
    }
    return inserted;
  }

  /** Create/resume the sandbox, sync all files, install deps, start dev. */
  async startApp(appId: number, onLog?: (l: string) => void): Promise<App> {
    return this.queue.run(appId, async () => {
      const app = this.getApp(appId);
      const runner = this.runnerFor(app);
      const log = (l: string) => onLog?.(l);
      await this.setStatus(appId, "creating");
      try {
        const ensured = await runner.ensure({
          appId,
          slug: app.slug,
          sandboxId: app.sandboxId,
          start: false,
          onLog: log,
        });
        await runner.syncFiles({ appId, slug: app.slug, files: this.filesList(appId), onLog: log });
        await this.syncSkills(appId, runner, log);
        // Install once per sandbox lifetime — marker: vite binary present.
        const marker = await runner.exec({
          appId,
          slug: app.slug,
          command: `test -x ${app.runner === "local" ? "." : "/home/user/app"}/node_modules/.bin/vite && echo yes || echo no`,
          onLog: log,
        });
        if (marker.stdout.trim() === "no") {
          await this.setStatus(appId, "installing");
          const res = await runner.install({ appId, slug: app.slug, onLog: log });
          if (res.exitCode !== 0) {
            throw new Error(`npm install failed — check the Logs tab for details`);
          }
        }
        await this.setStatus(appId, "running");
        const previewUrl = await runner.getPreviewUrl(appId);
        const started = await runner.ensure({
          appId,
          slug: app.slug,
          sandboxId: ensured.sandboxId,
          start: true,
          onLog: log,
        });
        db.update(apps)
          .set({
            sandboxId: started.sandboxId,
            previewUrl: started.previewUrl ?? previewUrl,
            status: "running",
            lastError: null,
            desiredState: "running",
            updatedAt: new Date(),
          })
          .where(eq(apps.id, appId))
          .run();
        return this.getApp(appId);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await this.setStatus(appId, "error", message);
        throw err;
      }
    });
  }

  /** Sync enabled skills into the sandbox at /home/user/skills/<slug>/SKILL.md */
  private async syncSkills(appId: number, runner: AppRunner, log: (l: string) => void) {
    const skills = getEnabledSkillsForApp(appId);
    const files = skills.flatMap((s) => skillSandboxFiles(s));
    if (files.length === 0) return;
    await runner.syncFiles({ appId, slug: this.getApp(appId).slug, files, onLog: log });
    log(`[skills] synced ${skills.length} skill(s) into the sandbox`);
  }

  /**
   * Apply a completed chat turn: DB writes, sandbox sync, dependency install,
   * dev-server restart. Returns the updated app.
   */
  async applyChatChanges(
    appId: number,
    changes: {
      writes: { path: string; content: string }[];
      renames: { from: string; to: string }[];
      deletes: string[];
      addDependency: string[];
    },
    onLog?: (l: string) => void,
  ): Promise<App> {
    return this.queue.run(appId, async () => {
      const app = this.getApp(appId);
      const runner = this.runnerFor(app);
      const log = (l: string) => onLog?.(l);

      // 1. Persist + validate in DB.
      for (const w of changes.writes) {
        const p = safeAppPath(w.path);
        const existing = db
          .select()
          .from(appFiles)
          .where(and(eq(appFiles.appId, appId), eq(appFiles.path, p)))
          .get();
        if (existing) {
          db.update(appFiles)
            .set({ content: w.content, updatedAt: new Date() })
            .where(eq(appFiles.id, (existing as { id: number }).id))
            .run();
        } else {
          db.insert(appFiles).values({ appId, path: p, content: w.content }).run();
        }
      }
      for (const r of changes.renames) {
        const from = safeAppPath(r.from);
        const to = safeAppPath(r.to);
        const existing = db
          .select()
          .from(appFiles)
          .where(and(eq(appFiles.appId, appId), eq(appFiles.path, from)))
          .get() as { content: string } | undefined;
        if (existing) {
          db.delete(appFiles).where(and(eq(appFiles.appId, appId), eq(appFiles.path, from))).run();
          db.insert(appFiles)
            .values({ appId, path: to, content: existing.content, updatedAt: new Date() })
            .onConflictDoUpdate({
              target: [appFiles.appId, appFiles.path],
              set: { content: existing.content, updatedAt: new Date() },
            })
            .run();
        }
      }
      for (const d of changes.deletes) {
        const p = safeAppPath(d);
        db.delete(appFiles).where(and(eq(appFiles.appId, appId), eq(appFiles.path, p))).run();
      }

      // 2. If nothing changed on disk, just make sure the sandbox is current.
      const allFiles = this.filesList(appId);
      try {
        if (app.sandboxId || app.runner === "local") {
          await runner.syncFiles({ appId, slug: app.slug, files: allFiles, onLog: log });
        }
      } catch (err) {
        log(`[sync] sandbox not available (${err instanceof Error ? err.message : err}); changes saved`);
      }

      // 3. Dependencies (only when package.json changed or deps were requested).
      const packageJsonChanged =
        changes.writes.some((w) => w.path === "package.json") ||
        changes.addDependency.length > 0;
      if (packageJsonChanged) {
        if (changes.addDependency.length > 0) {
          // Rewrite package.json deps using npm install <pkgs> semantics.
          const pkgPath = allFiles.find((f) => f.path === "package.json");
          if (pkgPath) {
            try {
              const pkg = JSON.parse(pkgPath.content);
              pkg.dependencies = pkg.dependencies ?? {};
              for (const spec of changes.addDependency) {
                const at = spec.lastIndexOf("@");
                const name =
                  at > 0 ? spec.slice(0, at) : spec;
                const version =
                  at > 0 && spec.slice(at + 1) && !/^\d/.test(spec.slice(at + 1))
                    ? `^${spec.slice(at + 1)}`
                    : at > 0
                      ? `^${spec.slice(at + 1)}`
                      : "latest";
                pkg.dependencies[name] = version === "latest" ? "latest" : version;
              }
              const newContent = JSON.stringify(pkg, null, 2);
              db.update(appFiles)
                .set({ content: newContent, updatedAt: new Date() })
                .where(and(eq(appFiles.appId, appId), eq(appFiles.path, "package.json")))
                .run();
              await runner.syncFiles({
                appId,
                slug: app.slug,
                files: [{ path: "package.json", content: newContent }],
                onLog: log,
              });
            } catch {
              /* fall through to plain install */
            }
          }
        }
        await this.setStatus(appId, "installing");
        const res = await runner.install({ appId, slug: app.slug, onLog: log });
        if (res.exitCode !== 0) {
          await this.setStatus(appId, "error", "npm install failed after chat changes");
          throw new Error("npm install failed — check the Logs tab");
        }
      }

      // 4. Restart the dev server so the preview reflects the new code.
      //    A first-turn app (never started) boots fully — Dyad's home flow
      //    shows the preview as soon as the agent's first build completes.
      if (app.desiredState === "running" || app.status === "idle") {
        try {
          await this.setStatus(appId, "building");
          if (app.status === "idle") {
            await runner.ensure({
              appId,
              slug: app.slug,
              sandboxId: app.sandboxId,
              start: false,
              onLog: log,
            });
          }
          await runner.restart({ appId, slug: app.slug, onLog: log });
          const previewUrl = await runner.getPreviewUrl(appId);
          await this.setStatus(appId, "running", null);
          db.update(apps)
            .set({
              previewUrl,
              status: "running",
              lastError: null,
              desiredState: "running",
              updatedAt: new Date(),
            })
            .where(eq(apps.id, appId))
            .run();
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          await this.setStatus(appId, "error", message);
        }
      }
      return this.getApp(appId);
    });
  }

  async rebuild(appId: number, onLog?: (l: string) => void): Promise<App> {
    return this.queue.run(appId, async () => {
      const app = this.getApp(appId);
      const runner = this.runnerFor(app);
      const log = (l: string) => onLog?.(l);
      try {
        await this.setStatus(appId, "installing");
        await runner.ensure({
          appId,
          slug: app.slug,
          sandboxId: app.sandboxId,
          start: false,
          onLog: log,
        });
        const res = await runner.rebuild({ appId, slug: app.slug, onLog: log });
        if (res.exitCode !== 0) throw new Error("rebuild: npm install failed");
        const previewUrl = await runner.getPreviewUrl(appId);
        await this.setStatus(appId, "running", null);
        db.update(apps)
          .set({ previewUrl, status: "running", lastError: null, desiredState: "running", updatedAt: new Date() })
          .where(eq(apps.id, appId))
          .run();
        return this.getApp(appId);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await this.setStatus(appId, "error", message);
        throw err;
      }
    });
  }

  async restart(appId: number, onLog?: (l: string) => void): Promise<App> {
    return this.queue.run(appId, async () => {
      const app = this.getApp(appId);
      const runner = this.runnerFor(app);
      const log = (l: string) => onLog?.(l);
      try {
        await this.setStatus(appId, "building");
        await runner.restart({ appId, slug: app.slug, onLog: log });
        const previewUrl = await runner.getPreviewUrl(appId);
        await this.setStatus(appId, "running", null);
        db.update(apps)
          .set({ previewUrl, status: "running", lastError: null, desiredState: "running", updatedAt: new Date() })
          .where(eq(apps.id, appId))
          .run();
        return this.getApp(appId);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await this.setStatus(appId, "error", message);
        throw err;
      }
    });
  }

  async refresh(appId: number): Promise<App> {
    // Refresh is a client-side iframe reload; here we just make sure state is sane.
    return this.getApp(appId);
  }

  async stopApp(appId: number, onLog?: (l: string) => void): Promise<App> {
    return this.queue.run(appId, async () => {
      const app = this.getApp(appId);
      const runner = this.runnerFor(app);
      await runner.stop({ appId, slug: app.slug, onLog: onLog ?? (() => {}) });
      await this.setStatus(appId, "stopped", null);
      db.update(apps).set({ desiredState: "stopped", status: "stopped", updatedAt: new Date() }).where(eq(apps.id, appId)).run();
      return this.getApp(appId);
    });
  }

  async deleteApp(appId: number, onLog?: (l: string) => void): Promise<void> {
    return this.queue.run(appId, async () => {
      const app = this.getApp(appId);
      const runner = this.runnerFor(app);
      try {
        await runner.dispose({ appId, slug: app.slug, onLog: onLog ?? (() => {}) });
      } catch {
        /* ignore */
      }
      db.delete(apps).where(eq(apps.id, appId)).run();
    });
  }

  async execInApp(appId: number, command: string, onLog?: (l: string) => void) {
    const app = this.getApp(appId);
    const runner = this.runnerFor(app);
    return runner.exec({ appId, slug: app.slug, command, onLog: onLog ?? (() => {}) });
  }

  getLogs(appId: number): string[] {
    const app = this.getApp(appId);
    const runner = this.runnerFor(app);
    return runner.getLogs(appId);
  }

  async statusOf(appId: number) {
    const app = this.getApp(appId);
    const runner = this.runnerFor(app);
    const previewUrl =
      app.status === "running" ? app.previewUrl ?? (await runner.getPreviewUrl(appId)) : null;
    return {
      status: app.status,
      lastError: app.lastError,
      previewUrl,
      sandboxId: app.sandboxId,
      runner: app.runner,
    };
  }
}

export function getManager(): SandboxManager {
  if (!managers.current) managers.current = new SandboxManager();
  return managers.current;
}

export { setSetting, SETTINGS_KEYS };
