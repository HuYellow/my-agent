import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ProjectRecord } from "@yellow-flow/protocol";
import { InternalToolManager } from "../src/services/internal-tool-manager.js";
import { HarnessDatabase } from "../src/store/database.js";

describe("InternalToolManager", () => {
  it("discovers repo and user internal tools with validation metadata", () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "yellow-flow-internal-tools-repo-"));
    const homeDir = join(mkdtempSync(join(tmpdir(), "yellow-flow-internal-tools-home-")), ".yellow-flow");
    mkdirSync(join(repoRoot, ".git"), { recursive: true });
    writeInternalToolManifest(join(repoRoot, ".agents", "internal-tools", "notify.json"), {
      name: "notify_team",
      description: "Send a build notification",
      endpoint: "https://example.test/internal/notify",
      method: "POST",
      timeoutMs: 15_000,
      parameters: {
        type: "object",
        properties: {
          message: { type: "string" },
        },
        required: ["message"],
        additionalProperties: false,
      },
      approval: {
        required: true,
        reason: "Contacts an internal API.",
        writes: false,
        network: true,
      },
    });
    writeInternalToolManifest(join(homeDir, "internal-tools", "broken.json"), {
      name: "broken_tool",
      description: "Invalid tool",
      endpoint: "not-a-url",
    });

    const database = new HarnessDatabase(join(repoRoot, "app.db"));
    const project = createProject(database, repoRoot);
    const emitted = new Set<string>();
    const manager = new InternalToolManager(database, (internalTool) => {
      emitted.add(internalTool.id);
    }, homeDir);

    const tools = manager.list(project);

    expect(tools).toHaveLength(2);
    expect(tools).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "notify_team",
          source: "repo",
          enabled: true,
          timeoutMs: 15_000,
          approvalRequired: true,
          validationErrors: [],
        }),
        expect.objectContaining({
          name: "broken",
          source: "user",
          enabled: false,
          validationErrors: expect.arrayContaining([expect.stringContaining("Invalid URL")]),
        }),
      ]),
    );
    expect(database.listInternalTools()).toHaveLength(2);
    expect(emitted.size).toBe(2);
  });

  it("updates persisted internal tool state and rejects unknown tool ids", () => {
    const root = mkdtempSync(join(tmpdir(), "yellow-flow-internal-tool-update-"));
    const database = new HarnessDatabase(join(root, "app.db"));
    const now = new Date().toISOString();
    const manager = new InternalToolManager(database, () => undefined, join(root, ".yellow-flow"));

    database.upsertInternalTool({
      id: "internal-tool-1",
      name: "notify_team",
      description: "Notify the team",
      path: join(root, "notify.json"),
      source: "repo",
      enabled: true,
      endpoint: "https://example.test/internal/notify",
      method: "POST",
      timeoutMs: 10_000,
      approvalRequired: true,
      approvalReason: "Contacts an internal API.",
      writes: false,
      network: true,
      validationErrors: [],
      createdAt: now,
      updatedAt: now,
    });

    const updated = manager.update("internal-tool-1", {
      enabled: false,
    });

    expect(updated.enabled).toBe(false);
    expect(() => manager.update("missing", { enabled: true })).toThrow("Internal tool not found");
  });
});

function createProject(database: HarnessDatabase, rootPath: string): ProjectRecord {
  const now = new Date().toISOString();
  return database.createProject({
    id: "project-internal-tools",
    name: "Internal Tool Project",
    rootPath,
    shell: process.platform === "win32" ? "powershell" : "bash",
    sandboxMode: "workspace-write",
    approvalPolicy: "on-request",
    createdAt: now,
    updatedAt: now,
  });
}

function writeInternalToolManifest(path: string, payload: Record<string, unknown>): void {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, JSON.stringify(payload, null, 2), "utf8");
}
