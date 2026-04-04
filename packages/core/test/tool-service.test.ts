import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { HarnessDatabase } from "../src/store/database.js";
import { ToolService } from "../src/tools/tool-service.js";
import { ApprovalRequiredError, ToolExecutionAbortedError } from "../src/tools/types.js";

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
