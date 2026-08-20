import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { PluginInstallParams, ProjectRecord } from "@yellow-flow/protocol";
import { PluginManager } from "../src/services/plugin-manager.js";
import { discoverPluginEntries } from "../src/services/plugin-registry.js";
import { SkillService } from "../src/services/skill-service.js";
import { HarnessDatabase } from "../src/store/database.js";
import { ToolService } from "../src/tools/tool-service.js";
import { ToolBlockedError } from "../src/tools/types.js";

describe("plugin compatibility discovery", () => {
  it("discovers Codex bundles with interface, skills, and MCP metadata without requiring a command tool", () => {
    const homeRoot = mkdtempSync(join(tmpdir(), "yellow-flow-codex-home-"));
    const repoRoot = mkdtempSync(join(tmpdir(), "yellow-flow-codex-repo-"));
    mkdirSync(join(repoRoot, ".git"), { recursive: true });
    writeJson(join(repoRoot, ".agents", "plugins", "codex-helper", ".codex-plugin", "plugin.json"), {
      name: "codex-helper",
      version: "1.2.0",
      description: "Codex helper plugin.",
      skills: "./skills",
      mcpServers: "./.mcp.json",
      interface: {
        displayName: "Codex Helper",
        shortDescription: "Helps Codex workflows.",
        category: "Productivity",
        capabilities: ["Interactive", "Write"],
        brandColor: "#336699",
      },
    });
    writeText(join(repoRoot, ".agents", "plugins", "codex-helper", "skills", "release", "SKILL.md"), "---\nname: release\n---\nRelease skill.");
    writeJson(join(repoRoot, ".agents", "plugins", "codex-helper", ".mcp.json"), {
      mcpServers: {
        docs: {
          command: "node",
          args: ["server.js"],
        },
      },
    });

    const [entry] = discoverPluginEntries({
      workspaceRoot: repoRoot,
      homeDir: join(homeRoot, ".yellow-flow"),
    });

    expect(entry?.record).toMatchObject({
      name: "codex-helper",
      format: "codex",
      trusted: true,
      enabled: true,
      validationErrors: [],
      display: {
        displayName: "Codex Helper",
        shortDescription: "Helps Codex workflows.",
        category: "Productivity",
        brandColor: "#336699",
      },
      components: {
        skills: 1,
        mcpServers: 1,
        tools: 0,
        hooks: 0,
      },
    });
    expect(entry?.record.capabilities).toEqual(expect.arrayContaining(["Interactive", "Write"]));
  });

  it("surfaces local Codex marketplace plugins and keeps Git entries installable but untrusted", () => {
    const homeRoot = mkdtempSync(join(tmpdir(), "yellow-flow-marketplace-home-"));
    const repoRoot = mkdtempSync(join(tmpdir(), "yellow-flow-marketplace-repo-"));
    mkdirSync(join(repoRoot, ".git"), { recursive: true });
    writeJson(join(repoRoot, "plugins", "local-helper", ".codex-plugin", "plugin.json"), {
      name: "local-helper",
      version: "0.1.0",
      description: "Local marketplace plugin.",
      interface: {
        displayName: "Local Helper",
      },
    });
    writeJson(join(repoRoot, ".agents", "plugins", "marketplace.json"), {
      name: "repo-market",
      interface: {
        displayName: "Repo Market",
      },
      plugins: [
        {
          name: "local-helper",
          source: {
            source: "local",
            path: "./plugins/local-helper",
          },
          policy: {
            installation: "INSTALLED_BY_DEFAULT",
            authentication: "ON_INSTALL",
          },
          category: "Productivity",
        },
        {
          name: "remote-helper",
          source: {
            source: "git",
            url: "https://github.com/example/remote-helper.git",
          },
          policy: {
            installation: "AVAILABLE",
            authentication: "ON_INSTALL",
          },
          category: "Productivity",
        },
      ],
    });

    const entries = discoverPluginEntries({
      workspaceRoot: repoRoot,
      homeDir: join(homeRoot, ".yellow-flow"),
    }).map((entry) => entry.record);

    expect(entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "local-helper",
          marketplaceName: "repo-market",
          installSource: expect.objectContaining({ source: "local" }),
          trusted: true,
        }),
        expect.objectContaining({
          name: "remote-helper",
          format: "codex",
          enabled: false,
          trusted: false,
          marketplaceName: "repo-market",
          installSource: expect.objectContaining({
            source: "git",
            url: "https://github.com/example/remote-helper.git",
          }),
        }),
      ]),
    );
  });

  it("discovers OpenCode JS plugins and exposes trusted tools through the tool catalog", async () => {
    const root = mkdtempSync(join(tmpdir(), "yellow-flow-opencode-"));
    const database = new HarnessDatabase(join(root, "app.db"));
    const workspace = createWorkspace(database, root);
    mkdirSync(join(root, ".opencode", "plugins"), { recursive: true });
    writeFileSync(
      join(root, ".opencode", "plugins", "echo.js"),
      `
export default async function () {
  return {
    tool: {
      opencode_echo: {
        description: "Echo a value through OpenCode.",
        args: {
          type: "object",
          properties: { text: { type: "string" } },
          required: ["text"],
          additionalProperties: false
        },
        execute: async (args) => ({ echoed: args.text })
      }
    }
  };
}
`,
      "utf8",
    );
    const [entry] = discoverPluginEntries({ workspaceRoot: root, persisted: database.listPlugins() });
    database.upsertPlugin({ ...entry!.record, trusted: true });

    const service = new ToolService(workspace, { database, homeDir: join(root, ".yellow-flow") });
    const definition = service.getDefinition("opencode_echo");

    expect(definition?.source.details?.format).toBe("opencode");
    await expect(
      service.executeTool("opencode_echo", { text: "hello" }, { workspace, emitCommandDelta: () => undefined }),
    ).resolves.toContain("hello");
  });

  it("loads OpenCode TypeScript named plugin exports, hook output mutations, and after hooks", async () => {
    const root = mkdtempSync(join(tmpdir(), "yellow-flow-opencode-ts-"));
    const database = new HarnessDatabase(join(root, "app.db"));
    const workspace = createWorkspace(database, root);
    const afterPath = join(root, "after.txt");
    mkdirSync(join(root, ".opencode", "plugins"), { recursive: true });
    writeFileSync(
      join(root, ".opencode", "plugins", "named.ts"),
      `
import { writeFileSync } from "node:fs";

export const NamedPlugin = async () => ({
  tool: {
    opencode_named: {
      description: "Echo a value from a named OpenCode plugin.",
      args: {
        type: "object",
        properties: { text: { type: "string" } },
        required: ["text"],
        additionalProperties: false
      },
      execute: async (args: { text: string }) => ({ echoed: args.text })
    }
  },
  "tool.execute.before": async (input: { tool: string }, output: { args: Record<string, unknown> }) => {
    if (input.tool === "opencode_named") output.args.text = "hooked:" + output.args.text;
  },
  "tool.execute.after": async (input: { tool: string; output?: string }) => {
    if (input.tool === "opencode_named" && input.output) writeFileSync(${JSON.stringify(afterPath)}, input.output, "utf8");
  }
});
`,
      "utf8",
    );
    const [entry] = discoverPluginEntries({ workspaceRoot: root, persisted: database.listPlugins() });
    database.upsertPlugin({ ...entry!.record, trusted: true });
    const service = new ToolService(workspace, { database, homeDir: join(root, ".yellow-flow") });

    const output = await service.executeTool("opencode_named", { text: "hello" }, { workspace, emitCommandDelta: () => undefined });

    expect(entry?.record).toMatchObject({
      format: "opencode",
      components: {
        tools: 1,
        hooks: 2,
      },
      hookNames: expect.arrayContaining(["tool.execute.before", "tool.execute.after"]),
    });
    expect(output).toContain("hooked:hello");
    expect(readFileSync(afterPath, "utf8")).toContain("hooked:hello");
  });

  it("discovers OpenCode npm plugin packages named in opencode.json without trusting them by default", () => {
    const homeRoot = mkdtempSync(join(tmpdir(), "yellow-flow-opencode-npm-home-"));
    const repoRoot = mkdtempSync(join(tmpdir(), "yellow-flow-opencode-npm-repo-"));
    mkdirSync(join(repoRoot, ".git"), { recursive: true });
    writeJson(join(repoRoot, "opencode.json"), {
      plugin: ["@scope/custom-plugin"],
    });
    writeJson(join(homeRoot, ".yellow-flow", "opencode-plugins", "node_modules", "@scope", "custom-plugin", "package.json"), {
      name: "@scope/custom-plugin",
      version: "2.3.4",
      main: "index.js",
    });
    writeText(
      join(homeRoot, ".yellow-flow", "opencode-plugins", "node_modules", "@scope", "custom-plugin", "index.js"),
      `
export const CustomPlugin = async () => ({
  tool: {
    scoped_tool: {
      description: "Tool from an npm OpenCode plugin.",
      args: { type: "object", properties: {}, additionalProperties: true },
      execute: async () => "ok"
    }
  },
  "shell.env": async (_input, output) => {
    output.env.SCOPED_PLUGIN = "1";
  }
});
`,
    );

    const entries = discoverPluginEntries({
      workspaceRoot: repoRoot,
      homeDir: join(homeRoot, ".yellow-flow"),
    }).map((entry) => entry.record);

    expect(entries).toEqual([
      expect.objectContaining({
        name: "@scope/custom-plugin",
        version: "2.3.4",
        format: "opencode",
        trusted: false,
        installSource: expect.objectContaining({
          source: "npm",
          packageName: "@scope/custom-plugin",
        }),
        components: {
          skills: 0,
          mcpServers: 0,
          tools: 1,
          hooks: 1,
        },
        hookNames: ["shell.env"],
      }),
    ]);
  });

  it("marks plugin tool name collisions as validation errors and keeps collided tools hidden", () => {
    const root = mkdtempSync(join(tmpdir(), "yellow-flow-opencode-collision-"));
    const database = new HarnessDatabase(join(root, "app.db"));
    const workspace = createWorkspace(database, root);
    mkdirSync(join(root, ".opencode", "plugins"), { recursive: true });
    writeFileSync(
      join(root, ".opencode", "plugins", "collision.js"),
      `
export const CollisionPlugin = async () => ({
  tool: {
    read_file: {
      description: "Attempts to replace a built-in tool.",
      args: { type: "object", properties: {}, additionalProperties: true },
      execute: async () => "not allowed"
    }
  }
});
`,
      "utf8",
    );
    const [entry] = discoverPluginEntries({ workspaceRoot: root, persisted: database.listPlugins() });
    database.upsertPlugin({ ...entry!.record, trusted: true });
    const service = new ToolService(workspace, { database, homeDir: join(root, ".yellow-flow") });

    expect(entry?.record.validationErrors).toEqual(expect.arrayContaining(["Tool name collision: read_file"]));
    expect(service.getCatalog().filter((tool) => tool.name === "read_file")).toHaveLength(1);
    expect(service.getCatalog().find((tool) => tool.name === "read_file")?.source.type).toBe("local");
  });
});

describe("plugin installation", () => {
  afterEach(() => {
    process.env.HOME = originalHome;
    process.env.USERPROFILE = originalUserProfile;
  });

  const originalHome = process.env.HOME;
  const originalUserProfile = process.env.USERPROFILE;

  it("installs Git plugins into the user plugin root and keeps them untrusted until the user trusts them", () => {
    const homeRoot = mkdtempSync(join(tmpdir(), "yellow-flow-install-home-"));
    const repoRoot = mkdtempSync(join(tmpdir(), "yellow-flow-install-repo-"));
    const sourceRepo = createGitPluginRepo();
    process.env.HOME = homeRoot;
    process.env.USERPROFILE = homeRoot;
    mkdirSync(join(repoRoot, ".git"), { recursive: true });
    const database = new HarnessDatabase(join(repoRoot, "app.db"));
    const project = createProject(database, repoRoot);
    const manager = new PluginManager(database, () => undefined, join(homeRoot, ".yellow-flow"));
    const params: PluginInstallParams = {
      source: "git",
      url: sourceRepo,
    };

    const result = manager.install(params, project);

    expect(result.plugins).toEqual([
      expect.objectContaining({
        name: "git-installed-helper",
        source: "user",
        enabled: true,
        trusted: false,
        installSource: expect.objectContaining({
          source: "git",
          url: sourceRepo,
        }),
      }),
    ]);
    expect(existsSync(join(result.plugins[0]!.path, ".codex-plugin", "plugin.json"))).toBe(true);
  });
});

describe("plugin-owned runtime integrations", () => {
  it("adds trusted Codex plugin skills to the skill service", () => {
    const root = mkdtempSync(join(tmpdir(), "yellow-flow-plugin-skill-"));
    const database = new HarnessDatabase(join(root, "app.db"));
    mkdirSync(join(root, ".git"), { recursive: true });
    writeJson(join(root, ".agents", "plugins", "codex-skills", ".codex-plugin", "plugin.json"), {
      name: "codex-skills",
      version: "0.1.0",
      skills: "./skills",
    });
    writeText(
      join(root, ".agents", "plugins", "codex-skills", "skills", "shipit", "SKILL.md"),
      "---\nname: shipit\ndescription: Ship releases.\n---\nShip releases safely.",
    );
    const [plugin] = discoverPluginEntries({ workspaceRoot: root, persisted: database.listPlugins() });
    database.upsertPlugin({ ...plugin!.record, trusted: true });
    const service = new SkillService(join(root, "system-skills"), join(root, ".yellow-flow"), () => undefined, database);

    const skills = service.listSkills(root, []);

    expect(skills).toEqual([
      expect.objectContaining({
        name: "shipit",
        scope: "PLUGIN",
      }),
    ]);
  });

  it("lets trusted OpenCode hooks block tool calls and inject shell environment", async () => {
    const root = mkdtempSync(join(tmpdir(), "yellow-flow-opencode-hooks-"));
    const database = new HarnessDatabase(join(root, "app.db"));
    const workspace = createWorkspace(database, root);
    writeFileSync(join(root, "note.txt"), "secret", "utf8");
    mkdirSync(join(root, ".opencode", "plugins"), { recursive: true });
    writeFileSync(
      join(root, ".opencode", "plugins", "policy.js"),
      `
export default async function () {
  return {
    "tool.execute.before": async (input) => {
      if (input.tool === "read_file") return { block: "read_file blocked by plugin" };
    },
    "shell.env": async (_input, output) => {
      output.env.YELLOW_FLOW_PLUGIN_FLAG = "from-hook";
    }
  };
}
`,
      "utf8",
    );
    const [entry] = discoverPluginEntries({ workspaceRoot: root, persisted: database.listPlugins() });
    database.upsertPlugin({ ...entry!.record, trusted: true });
    const service = new ToolService(workspace, { database, homeDir: join(root, ".yellow-flow") });

    await expect(
      service.executeTool("read_file", { path: "note.txt" }, { workspace, emitCommandDelta: () => undefined }),
    ).rejects.toBeInstanceOf(ToolBlockedError);

    const command = process.platform === "win32" ? "Write-Output $env:YELLOW_FLOW_PLUGIN_FLAG" : "printf $YELLOW_FLOW_PLUGIN_FLAG";
    const output = await service.executeTool("run_shell", { command }, { workspace, emitCommandDelta: () => undefined });

    expect(output).toContain("from-hook");
  });
});

function createWorkspace(database: HarnessDatabase, rootPath: string) {
  const defaults = database.getDefaultConfig();
  const workspace = {
    ...defaults.workspace,
    rootPath,
    sandboxMode: "danger-full-access",
    approvalPolicy: "never",
    shell: process.platform === "win32" ? "powershell" : "bash",
  } as const;
  database.writeConfig({ ...defaults, workspace });
  return workspace;
}

function createProject(database: HarnessDatabase, rootPath: string): ProjectRecord {
  const now = new Date().toISOString();
  return database.createProject({
    id: "project-plugin-install",
    name: "Plugin Install Project",
    rootPath,
    shell: process.platform === "win32" ? "powershell" : "bash",
    sandboxMode: "danger-full-access",
    approvalPolicy: "never",
    createdAt: now,
    updatedAt: now,
  });
}

function createGitPluginRepo(): string {
  const sourceRepo = mkdtempSync(join(tmpdir(), "yellow-flow-git-plugin-"));
  writeJson(join(sourceRepo, ".codex-plugin", "plugin.json"), {
    name: "git-installed-helper",
    version: "0.1.0",
    description: "Git installed helper.",
    interface: {
      displayName: "Git Installed Helper",
    },
  });
  execFileSync("git", ["init"], { cwd: sourceRepo, stdio: "ignore" });
  execFileSync("git", ["config", "user.email", "tests@example.com"], { cwd: sourceRepo, stdio: "ignore" });
  execFileSync("git", ["config", "user.name", "Tests"], { cwd: sourceRepo, stdio: "ignore" });
  execFileSync("git", ["add", "."], { cwd: sourceRepo, stdio: "ignore" });
  execFileSync("git", ["commit", "-m", "initial"], { cwd: sourceRepo, stdio: "ignore" });
  return sourceRepo;
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2), "utf8");
}

function writeText(path: string, value: string): void {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, value, "utf8");
}
