import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { type PluginInstallParams, type PluginInstallResult, type PluginRecord, type ProjectRecord } from "@yellow-flow/protocol";
import { HarnessDatabase } from "../store/database.js";
import { discoverPluginEntries } from "./plugin-registry.js";

export class PluginManager {
  constructor(
    private readonly database: HarnessDatabase,
    private readonly emit: (plugin: PluginRecord) => void,
    private readonly homeDir = join(homedir(), ".yellow-flow"),
  ) {}

  list(project?: ProjectRecord): PluginRecord[] {
    if (!project) {
      return [];
    }

    const discovered = discoverPluginEntries({
      workspaceRoot: project.rootPath,
      persisted: this.database.listPlugins(),
      homeDir: this.homeDir,
    }).map((entry) => entry.record);

    for (const plugin of discovered) {
      this.database.upsertPlugin(plugin);
      this.emit(plugin);
    }

    return discovered;
  }

  update(pluginId: string, patch: Partial<Pick<PluginRecord, "enabled" | "trusted">>): PluginRecord {
    const current = this.database.getPlugin(pluginId);

    if (!current) {
      throw new Error(`Plugin not found: ${pluginId}`);
    }

    const plugin = this.database.upsertPlugin({
      ...current,
      ...patch,
      updatedAt: new Date().toISOString(),
    });
    this.emit(plugin);
    return plugin;
  }

  install(params: PluginInstallParams, project: ProjectRecord): PluginInstallResult {
    if (params.source === "git") {
      const target = join(this.homeDir, "plugins", slugFromGitUrl(params.url));
      mkdirSync(join(this.homeDir, "plugins"), { recursive: true });

      if (!existsSync(target)) {
        execFileSync("git", ["clone", params.url, target], { stdio: "ignore" });
      }

      if (params.ref) {
        execFileSync("git", ["checkout", params.ref], { cwd: target, stdio: "ignore" });
      }

      return this.persistInstalled(project, target, {
        source: "git",
        url: params.url,
        ref: params.ref,
      });
    }

    const packageSpec = params.version ? `${params.packageName}@${params.version}` : params.packageName;
    const installRoot = join(this.homeDir, "opencode-plugins");
    mkdirSync(installRoot, { recursive: true });

    if (!existsSync(join(installRoot, "package.json"))) {
      execFileSync("npm", ["init", "-y"], { cwd: installRoot, stdio: "ignore" });
    }

    execFileSync("npm", ["install", packageSpec], { cwd: installRoot, stdio: "ignore" });

    return this.persistInstalled(project, join(installRoot, "node_modules"), {
      source: "npm",
      packageName: params.packageName,
      version: params.version,
    });
  }

  private persistInstalled(project: ProjectRecord, targetPath: string, installSource: NonNullable<PluginRecord["installSource"]>): PluginInstallResult {
    const discovered = discoverPluginEntries({
      workspaceRoot: project.rootPath,
      persisted: this.database.listPlugins(),
      homeDir: this.homeDir,
    })
      .map((entry) => entry.record)
      .filter((plugin) => plugin.path.startsWith(targetPath));
    const plugins = discovered.map((plugin) =>
      this.database.upsertPlugin({
        ...plugin,
        installSource,
        trusted: false,
        updatedAt: new Date().toISOString(),
      }),
    );

    for (const plugin of plugins) {
      this.emit(plugin);
    }

    return { plugins };
  }
}

function slugFromGitUrl(url: string): string {
  const clean = url.replace(/[\\/]+$/, "").replace(/\.git$/i, "");
  return (
    basename(clean)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "plugin"
  );
}
