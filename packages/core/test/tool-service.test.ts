import { createServer } from "node:http";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { HarnessDatabase } from "../src/store/database.js";
import { ToolService } from "../src/tools/tool-service.js";
import {
  ApprovalRequiredError,
  DeferredApprovalRequiredError,
  ToolBlockedError,
  ToolExecutionAbortedError,
  ToolExecutionFailedError,
  ToolExecutionTimeoutError,
  ToolValidationError,
} from "../src/tools/types.js";

const timers: Array<ReturnType<typeof setTimeout>> = [];

afterEach(() => {
  while (timers.length > 0) {
    clearTimeout(timers.pop()!);
  }
});

describe("ToolService", () => {
  it("blocks write_patch inside read-only sandbox", () => {
    const { database, workspace } = createWorkspace({
      sandboxMode: "read-only",
      approvalPolicy: "never",
    });
    const service = new ToolService(workspace, { database, threadId: "thread-1" });
    const plan = service.planExecution("write_patch", {
      path: "notes/todo.txt",
      content: "hello",
    });

    expect(plan.permission.allowed).toBe(false);
    expect(plan.permission.denialReason).toContain("Read-only sandbox");
  });

  it("requires approval for direct writes when approval policy is on-request", async () => {
    const { database, workspace, root } = createWorkspace({
      sandboxMode: "workspace-write",
      approvalPolicy: "on-request",
    });
    const service = new ToolService(workspace, { database, threadId: "thread-1" });

    await expect(
      service.executeTool(
        "write_patch",
        { path: "notes/todo.txt", content: "hello" },
        {
          workspace,
          emitCommandDelta: () => undefined,
        },
      ),
    ).rejects.toBeInstanceOf(ApprovalRequiredError);

    expect(() => readFileSync(join(root, "notes", "todo.txt"), "utf8")).toThrow();
  });

  it("remembers session approvals for the same shell command scope", () => {
    const { database, workspace } = createWorkspace({
      sandboxMode: "workspace-write",
      approvalPolicy: "on-request",
    });
    const service = new ToolService(workspace, { database, threadId: "thread-1" });
    const firstPlan = service.planExecution("run_shell", {
      command: process.platform === "win32" ? "Get-ChildItem" : "ls",
    });

    expect(firstPlan.permission.requiresApproval).toBe(true);

    service.rememberSessionApproval("thread-1", "run_shell", firstPlan.permission.approvalKey!);

    const secondPlan = service.planExecution("run_shell", {
      command: process.platform === "win32" ? "Get-ChildItem" : "ls",
    });

    expect(secondPlan.permission.allowed).toBe(true);
    expect(secondPlan.permission.requiresApproval).toBe(false);
    expect(secondPlan.permission.sessionApproved).toBe(true);
  });

  it("defers approval for risky writes when approval policy is on-failure", async () => {
    const { database, workspace } = createWorkspace({
      sandboxMode: "workspace-write",
      approvalPolicy: "on-failure",
    });
    const service = new ToolService(workspace, { database, threadId: "thread-1" });
    const plan = service.planExecution("write_patch", {
      path: "notes/todo.txt",
      content: "hello",
    });

    expect(plan.permission.allowed).toBe(true);
    expect(plan.permission.requiresApproval).toBe(false);
    expect(plan.permission.approvalMode).toBe("deferred");

    await expect(
      service.executeTool(
        "write_patch",
        { path: "notes/todo.txt", content: "hello" },
        {
          workspace,
          emitCommandDelta: () => undefined,
        },
      ),
    ).rejects.toBeInstanceOf(DeferredApprovalRequiredError);
  });

  it("applies structured patches through apply_patch", async () => {
    const { database, workspace, root } = createWorkspace({
      sandboxMode: "danger-full-access",
      approvalPolicy: "never",
    });
    const service = new ToolService(workspace, { database, threadId: "thread-1" });

    await service.executeTool(
      "write_patch",
      { path: "notes/todo.txt", content: "before\n" },
      {
        workspace,
        emitCommandDelta: () => undefined,
      },
    );

    await service.executeTool(
      "apply_patch",
      {
        patch: [
          "*** Begin Patch",
          "*** Update File: notes/todo.txt",
          "@@",
          "-before",
          "+after",
          "*** End Patch",
        ].join("\n"),
      },
      {
        workspace,
        emitCommandDelta: () => undefined,
      },
    );

    expect(readFileSync(join(root, "notes", "todo.txt"), "utf8")).toContain("after");
  });

  it("aborts long-running shell commands when the signal is cancelled", async () => {
    const { database, workspace } = createWorkspace({
      sandboxMode: "danger-full-access",
      approvalPolicy: "never",
    });
    const service = new ToolService(workspace, { database, threadId: "thread-1" });
    const controller = new AbortController();
    const command = process.platform === "win32" ? "Start-Sleep -Seconds 30" : "sleep 30";
    const execution = service.executeTool(
      "run_shell",
      { command },
      {
        workspace,
        signal: controller.signal,
        emitCommandDelta: () => undefined,
      },
    );

    timers.push(setTimeout(() => controller.abort(), 150));

    await expect(execution).rejects.toBeInstanceOf(ToolExecutionAbortedError);
  });

  it("exposes unified source and capability metadata across local, internal, plugin, and mcp tools", () => {
    const homeDir = mkdtempSync(join(tmpdir(), "my-agent-home-"));
    const { database, workspace, root } = createWorkspace({
      sandboxMode: "danger-full-access",
      approvalPolicy: "never",
    });
    mkdirSync(join(root, ".git"));
    mkdirSync(join(root, ".codex", "plugins", "sample-plugin", ".codex-plugin"), { recursive: true });
    writeFileSync(
      join(root, ".codex", "plugins", "sample-plugin", ".codex-plugin", "plugin.json"),
      JSON.stringify({
        name: "sample-plugin",
        version: "1.2.3",
        enabled: true,
        sandboxMode: "read-only",
        capabilities: ["network"],
        command: process.execPath,
        args: ["-e", "process.stdin.resume();process.stdin.on('data', (chunk) => process.stdout.write(chunk));"],
        tool: {
          name: "plugin_echo",
          description: "Echo plugin payload",
          parameters: {
            type: "object",
            properties: {},
            additionalProperties: true,
          },
        },
      }),
      "utf8",
    );
    mkdirSync(join(homeDir, "internal-tools"), { recursive: true });
    writeFileSync(
      join(homeDir, "internal-tools", "notify.json"),
      JSON.stringify({
        name: "notify_team",
        description: "Send a notification",
        endpoint: "http://127.0.0.1/internal",
        approval: {
          required: true,
          writes: false,
          network: true,
        },
      }),
      "utf8",
    );
    const mcpManager = {
      list: () => [{ id: "mount_docs", name: "Docs", transport: "http", enabled: true }],
      getCachedMountData: () => ({
        tools: [
          {
            name: "lookup",
            description: "Lookup docs",
            inputSchema: {
              type: "object",
              properties: {},
              additionalProperties: true,
            },
          },
        ],
        prompts: [],
        resources: [],
      }),
      callTool: async () => "{\"ok\":true}",
    } as any;

    const service = new ToolService(workspace, {
      database,
      threadId: "thread-1",
      homeDir,
      mcpManager,
    });
    const definitions = service.getDefinitions();
    const readFile = definitions.find((definition) => definition.name === "read_file");
    const internal = definitions.find((definition) => definition.name === "notify_team");
    const plugin = definitions.find((definition) => definition.name === "plugin_echo");
    const mcp = definitions.find((definition) => definition.name === "mcp_docs_lookup");

    expect(readFile?.source.type).toBe("local");
    expect(readFile?.capability.writes).toBe(false);
    expect(readFile?.capability.approvalModes).toEqual(["none"]);

    expect(internal?.source.type).toBe("internal");
    expect(internal?.source.path).toContain("notify.json");
    expect(internal?.capability.network).toBe(true);
    expect(internal?.capability.timeoutMs).toBe(30_000);

    expect(plugin?.source.type).toBe("plugin");
    expect(plugin?.source.label).toBe("sample-plugin");
    expect(plugin?.capability.network).toBe(true);
    expect(plugin?.capability.approvalModes).toEqual(["preflight", "deferred"]);

    expect(mcp?.source.type).toBe("mcp");
    expect(mcp?.source.details?.mountId).toBe("mount_docs");
    expect(mcp?.capability.riskLevel).toBe("network");
  });

  it("classifies validation failures with the unified tool error model", async () => {
    const { database, workspace } = createWorkspace({
      sandboxMode: "danger-full-access",
      approvalPolicy: "never",
    });
    const service = new ToolService(workspace, { database, threadId: "thread-1" });

    await expect(
      service.executeTool(
        "write_patch",
        { content: "hello" },
        {
          workspace,
          emitCommandDelta: () => undefined,
        },
      ),
    ).rejects.toMatchObject({
      toolError: {
        code: "validation_error",
        tool: {
          name: "write_patch",
          source: {
            type: "local",
          },
        },
      },
    });
  });

  it("classifies blocked writes with the unified tool error model", async () => {
    const { database, workspace } = createWorkspace({
      sandboxMode: "read-only",
      approvalPolicy: "never",
    });
    const service = new ToolService(workspace, { database, threadId: "thread-1" });

    await expect(
      service.executeTool(
        "write_patch",
        { path: "notes/todo.txt", content: "hello" },
        {
          workspace,
          emitCommandDelta: () => undefined,
        },
      ),
    ).rejects.toMatchObject({
      toolError: {
        code: "blocked",
        tool: {
          name: "write_patch",
        },
      },
    });
  });

  it("classifies plugin execution failures with the unified tool error model", async () => {
    const { database, workspace, root } = createWorkspace({
      sandboxMode: "danger-full-access",
      approvalPolicy: "never",
    });
    mkdirSync(join(root, ".git"));
    mkdirSync(join(root, ".codex", "plugins", "failing-plugin", ".codex-plugin"), { recursive: true });
    writeFileSync(
      join(root, ".codex", "plugins", "failing-plugin", ".codex-plugin", "plugin.json"),
      JSON.stringify({
        name: "failing-plugin",
        enabled: true,
        sandboxMode: "workspace-write",
        command: process.execPath,
        args: ["-e", "process.exit(2)"],
        tool: {
          name: "plugin_fail",
          description: "Fail on purpose",
          parameters: {
            type: "object",
            properties: {},
            additionalProperties: true,
          },
        },
      }),
      "utf8",
    );
    const service = new ToolService(workspace, { database, threadId: "thread-1" });

    await expect(
      service.executeTool(
        "plugin_fail",
        {},
        {
          workspace,
          emitCommandDelta: () => undefined,
        },
      ),
    ).rejects.toMatchObject({
      toolError: {
        code: "execution_failed",
        tool: {
          source: {
            type: "plugin",
          },
        },
      },
    });
  });

  it("classifies internal tool timeouts with the unified tool error model", async () => {
    const server = createServer((_req, res) => {
      setTimeout(() => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end("{\"ok\":true}");
      }, 250);
    });
    const homeDir = mkdtempSync(join(tmpdir(), "my-agent-home-"));
    const { database, workspace } = createWorkspace({
      sandboxMode: "danger-full-access",
      approvalPolicy: "never",
    });
    const port = await new Promise<number>((resolve) => {
      server.listen(0, "127.0.0.1", () => {
        resolve((server.address() as import("node:net").AddressInfo).port);
      });
    });
    mkdirSync(join(homeDir, "internal-tools"), { recursive: true });
    writeFileSync(
      join(homeDir, "internal-tools", "slow.json"),
      JSON.stringify({
        name: "slow_internal",
        description: "Slow internal tool",
        endpoint: `http://127.0.0.1:${port}/slow`,
        timeoutMs: 50,
        approval: {
          required: false,
          writes: false,
          network: true,
        },
      }),
      "utf8",
    );
    const service = new ToolService(workspace, { database, threadId: "thread-1", homeDir });

    try {
      await expect(
        service.executeTool(
          "slow_internal",
          {},
          {
            workspace,
            emitCommandDelta: () => undefined,
          },
        ),
      ).rejects.toMatchObject({
        toolError: {
          code: "timeout",
          tool: {
            source: {
              type: "internal",
            },
          },
        },
      });
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

function createWorkspace(options: { sandboxMode: "read-only" | "workspace-write" | "danger-full-access"; approvalPolicy: "on-request" | "on-failure" | "never" }) {
  const root = mkdtempSync(join(tmpdir(), "my-agent-tools-"));
  const database = new HarnessDatabase(join(root, "app.db"));
  const defaults = database.getDefaultConfig();
  const workspace = {
    ...defaults.workspace,
    rootPath: root,
    sandboxMode: options.sandboxMode,
    approvalPolicy: options.approvalPolicy,
    shell: process.platform === "win32" ? "powershell" : "bash",
  } as const;

  database.writeConfig({
    ...defaults,
    workspace,
  });

  return { database, workspace, root };
}
