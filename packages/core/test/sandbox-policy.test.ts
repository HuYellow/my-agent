import { describe, expect, it } from "vitest";
import type { ToolActionDescriptor, ToolPermissionDecision } from "../src/tools/types.js";
import { SandboxPolicy } from "../src/tools/sandbox-policy.js";

describe("SandboxPolicy", () => {
  it("blocks outside-workspace, write, and network operations when the sandbox disallows them", () => {
    const policy = new SandboxPolicy();

    expectDecision(
      policy.evaluate(
        descriptor({
          preview: "read outside",
          paths: ["C:/outside/file.txt"],
        }),
        workspace({ sandboxMode: "workspace-write" }),
      ),
      { allowed: false, denialReason: expect.stringContaining("outside the workspace") },
    );
    expectDecision(
      policy.evaluate(
        descriptor({
          preview: "write file",
          writes: true,
          paths: ["C:/repo/file.txt"],
        }),
        workspace({ sandboxMode: "read-only" }),
      ),
      { allowed: false, denialReason: expect.stringContaining("Read-only sandbox") },
    );
    expectDecision(
      policy.evaluate(
        descriptor({
          preview: "curl example.test",
          network: true,
          paths: ["C:/repo"],
        }),
        workspace({ sandboxMode: "workspace-write" }),
      ),
      { allowed: false, denialReason: expect.stringContaining("danger-full-access") },
    );
  });

  it("uses preflight, deferred, and session approvals for risky operations", () => {
    const policy = new SandboxPolicy();
    const riskyDescriptor = descriptor({
      preview: "git commit",
      risky: true,
      writes: true,
      approvalReason: "Committing changes requires approval.",
      paths: ["C:/repo"],
    });

    expectDecision(policy.evaluate(riskyDescriptor, workspace({ approvalPolicy: "on-request" })), {
      allowed: true,
      requiresApproval: true,
      approvalMode: "preflight",
      approvalReason: "Committing changes requires approval.",
    });
    expectDecision(policy.evaluate(riskyDescriptor, workspace({ approvalPolicy: "on-failure" })), {
      allowed: true,
      requiresApproval: false,
      approvalMode: "deferred",
      approvalReason: "Committing changes requires approval.",
    });
    expectDecision(
      policy.evaluate(riskyDescriptor, workspace({ approvalPolicy: "on-request" }), {
        sessionApproved: true,
      }),
      {
        allowed: true,
        requiresApproval: false,
        approvalMode: "none",
        sessionApproved: true,
      },
    );
  });
});

function workspace(
  overrides: Partial<{
    sandboxMode: "read-only" | "workspace-write" | "danger-full-access";
    approvalPolicy: "on-request" | "on-failure" | "never";
  }> = {},
) {
  return {
    id: "workspace-1",
    name: "Workspace",
    rootPath: "C:/repo",
    shell: "powershell",
    sandboxMode: overrides.sandboxMode ?? "workspace-write",
    approvalPolicy: overrides.approvalPolicy ?? "on-request",
  };
}

function descriptor(overrides: Partial<ToolActionDescriptor>): ToolActionDescriptor {
  return {
    preview: overrides.preview ?? "operation",
    scopeKey: overrides.scopeKey ?? "scope",
    source: overrides.source ?? { type: "local", label: "Local workspace" },
    risky: overrides.risky,
    interactive: overrides.interactive,
    riskLevel: overrides.riskLevel,
    writes: overrides.writes,
    network: overrides.network,
    paths: overrides.paths,
    approvalReason: overrides.approvalReason,
  };
}

function expectDecision(actual: ToolPermissionDecision, expected: Partial<ToolPermissionDecision>): void {
  expect(actual).toMatchObject(expected);
}
