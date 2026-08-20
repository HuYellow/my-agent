import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ProjectRecord } from "@yellow-flow/protocol";
import { PluginManager } from "../src/services/plugin-manager.js";
import { discoverPluginEntries } from "../src/services/plugin-registry.js";
import { HarnessDatabase } from "../src/store/database.js";

describe("PluginManager", () => {
  const originalHome = process.env.HOME;
  const originalUserProfile = process.env.USERPROFILE;

  afterEach(() => {
    process.env.HOME = originalHome;
    process.env.USERPROFILE = originalUserProfile;
  });

  it("discovers repo and user plugins through the manager and persists them without id collisions", () => {
    const homeRoot = mkdtempSync(join(tmpdir(), "yellow-flow-plugin-home-"));
    const repoRoot = mkdtempSync(join(tmpdir(), "yellow-flow-plugin-repo-"));
    process.env.HOME = homeRoot;
    process.env.USERPROFILE = homeRoot;
    mkdirSync(join(repoRoot, ".git"), { recursive: true });
    writePluginManifest(join(repoRoot, ".agents", "plugins", "repo-helper", ".codex-plugin", "plugin.json"), {
      schemaVersion: "1.0",
      name: "Repo Helper",
      version: "1.2.3",
      command: process.execPath,
      capabilities: ["write"],
      tool: {
        name: "repo_echo",
        description: "Echo from the repo plugin.",
        parameters: {
          type: "object",
          properties: {
            input: { type: "string" },
          },
          required: ["input"],
          additionalProperties: false,
        },
      },
    });
    writePluginManifest(join(homeRoot, ".yellow-flow", "plugins", "user-helper", "plugin.json"), {
      schemaVersion: "1.0",
      name: "User Helper",
      version: "0.0.1",
      enabled: false,
    });

    const database = new HarnessDatabase(join(repoRoot, "app.db"));
    const project = createProject(database, repoRoot);
    const emitted = new Set<string>();
    const manager = new PluginManager(database, (plugin) => {
      emitted.add(plugin.id);
    });

    const plugins = manager.list(project);

    expect(plugins).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "Repo Helper",
          source: "repo",
          trusted: true,
          enabled: true,
          toolName: "repo_echo",
          validationErrors: [],
        }),
        expect.objectContaining({
          name: "User Helper",
          source: "user",
          trusted: false,
          enabled: false,
          validationErrors: expect.arrayContaining(["Missing plugin command.", "Missing plugin tool declaration."]),
        }),
      ]),
    );
    expect(new Set(plugins.map((plugin) => plugin.id)).size).toBe(2);
    expect(database.listPlugins()).toHaveLength(2);
    expect(emitted.size).toBe(2);
  });

  it("discovers user plugins through the registry with untrusted defaults and validation errors", () => {
    const homeRoot = mkdtempSync(join(tmpdir(), "yellow-flow-plugin-home-"));
    const repoRoot = mkdtempSync(join(tmpdir(), "yellow-flow-plugin-repo-"));
    mkdirSync(join(repoRoot, ".git"), { recursive: true });
    writePluginManifest(join(homeRoot, ".yellow-flow", "plugins", "user-helper", "plugin.json"), {
      schemaVersion: "1.0",
      name: "User Helper",
      version: "0.0.1",
      enabled: false,
    });

    const discovered = discoverPluginEntries({
      workspaceRoot: repoRoot,
      homeDir: join(homeRoot, ".yellow-flow"),
    });

    expect(discovered).toEqual([
      expect.objectContaining({
        record: expect.objectContaining({
          name: "User Helper",
          source: "user",
          trusted: false,
          enabled: false,
          validationErrors: expect.arrayContaining(["Missing plugin command.", "Missing plugin tool declaration."]),
        }),
      }),
    ]);
  });

  it("updates persisted plugin state and rejects unknown plugin ids", () => {
    const root = mkdtempSync(join(tmpdir(), "yellow-flow-plugin-update-"));
    const database = new HarnessDatabase(join(root, "app.db"));
    const now = new Date().toISOString();
    const manager = new PluginManager(database, () => undefined);

    database.upsertPlugin({
      id: "plugin-1",
      name: "Persisted Plugin",
      version: "1.0.0",
      path: join(root, "plugin"),
      manifestPath: join(root, "plugin", ".codex-plugin", "plugin.json"),
      source: "repo",
      enabled: true,
      trusted: true,
      capabilities: [],
      validationErrors: [],
      createdAt: now,
      updatedAt: now,
    });

    const updated = manager.update("plugin-1", {
      enabled: false,
      trusted: false,
    });

    expect(updated).toMatchObject({
      id: "plugin-1",
      enabled: false,
      trusted: false,
    });
    expect(() => manager.update("missing", { enabled: true })).toThrow("Plugin not found");
  });
});

function createProject(database: HarnessDatabase, rootPath: string): ProjectRecord {
  const now = new Date().toISOString();
  return database.createProject({
    id: "project-plugin",
    name: "Plugin Project",
    rootPath,
    shell: process.platform === "win32" ? "powershell" : "bash",
    sandboxMode: "workspace-write",
    approvalPolicy: "on-request",
    createdAt: now,
    updatedAt: now,
  });
}

function writePluginManifest(path: string, payload: Record<string, unknown>): void {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, JSON.stringify(payload, null, 2), "utf8");
}
