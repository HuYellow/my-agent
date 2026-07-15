import { type WorkspaceProfile } from "@my-agent/protocol";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import { isPathInside } from "../utils/path-utils.js";
import { type ToolActionDescriptor, type ToolPermissionDecision } from "./types.js";

export class SandboxPolicy {
  evaluate(
    descriptor: ToolActionDescriptor,
    workspace: WorkspaceProfile,
    options: { sessionApproved?: boolean } = {},
  ): ToolPermissionDecision {
    const repoPolicy = readRepoPolicy(workspace.rootPath);
    if (repoPolicy.error) {
      return denied(descriptor, repoPolicy.error);
    }
    if (descriptor.writes && repoPolicy.value?.enforceReadOnly) {
      return denied(descriptor, "Repository policy enforces read-only access.");
    }
    if (descriptor.network && repoPolicy.value?.denyNetwork) {
      return denied(descriptor, "Repository policy blocks network-capable operations.");
    }
    const protectedPath = descriptor.writes
      ? (descriptor.paths ?? []).find((path) =>
          (repoPolicy.value?.protectedPaths ?? []).some((protectedEntry) =>
            isPathInside(resolve(workspace.rootPath, protectedEntry), path),
          ),
        )
      : undefined;
    if (protectedPath) {
      return denied(descriptor, `Repository policy protects this path from writes: ${protectedPath}.`);
    }
    const outsidePaths = (descriptor.paths ?? []).filter(
      (path) => workspace.sandboxMode !== "danger-full-access" && !isPathInside(workspace.rootPath, path),
    );

    if (outsidePaths.length > 0) {
      return {
        allowed: false,
        requiresApproval: false,
        approvalMode: "none",
        approvalKey: descriptor.scopeKey,
        denialReason: `Operation targets a path outside the workspace: ${outsidePaths[0]}.`,
      };
    }

    if (workspace.sandboxMode === "read-only" && descriptor.writes) {
      return {
        allowed: false,
        requiresApproval: false,
        approvalMode: "none",
        approvalKey: descriptor.scopeKey,
        denialReason: "Read-only sandbox blocks write operations.",
      };
    }

    if (workspace.sandboxMode !== "danger-full-access" && descriptor.network) {
      return {
        allowed: false,
        requiresApproval: false,
        approvalMode: "none",
        approvalKey: descriptor.scopeKey,
        denialReason: `Network-capable operations require danger-full-access sandbox mode.`,
      };
    }

    const repoRequiresWriteApproval = Boolean(descriptor.writes && repoPolicy.value?.requireApprovalForWrites);
    if (!repoRequiresWriteApproval && (options.sessionApproved || workspace.approvalPolicy === "never")) {
      return {
        allowed: true,
        requiresApproval: false,
        approvalMode: "none",
        approvalKey: descriptor.scopeKey,
        approvalReason: descriptor.approvalReason,
        sessionApproved: options.sessionApproved ?? false,
      };
    }

    if (descriptor.risky || repoRequiresWriteApproval) {
      if (workspace.approvalPolicy === "on-failure") {
        return {
          allowed: true,
          requiresApproval: false,
          approvalMode: "deferred",
          approvalKey: descriptor.scopeKey,
          approvalReason: descriptor.approvalReason ?? `Tool action "${descriptor.preview}" can be retried after approval.`,
        };
      }

      return {
        allowed: true,
        requiresApproval: true,
        approvalMode: "preflight",
        approvalKey: descriptor.scopeKey,
        approvalReason: descriptor.approvalReason ?? `Tool action "${descriptor.preview}" requires approval.`,
      };
    }

    return {
      allowed: true,
      requiresApproval: false,
      approvalMode: "none",
      approvalKey: descriptor.scopeKey,
    };
  }
}

const REPO_POLICY_SCHEMA = z.object({
  enforceReadOnly: z.boolean().optional(),
  denyNetwork: z.boolean().optional(),
  requireApprovalForWrites: z.boolean().optional(),
  protectedPaths: z.array(z.string().min(1)).default([]),
});

function readRepoPolicy(rootPath: string): {
  value?: z.infer<typeof REPO_POLICY_SCHEMA>;
  error?: string;
} {
  const policyPath = resolve(rootPath, ".my-agent", "policy.json");
  if (!existsSync(policyPath)) {
    return {};
  }
  try {
    return { value: REPO_POLICY_SCHEMA.parse(JSON.parse(readFileSync(policyPath, "utf8"))) };
  } catch (error) {
    return { error: `Invalid repository policy ${policyPath}: ${error instanceof Error ? error.message : String(error)}` };
  }
}

function denied(descriptor: ToolActionDescriptor, denialReason: string): ToolPermissionDecision {
  return {
    allowed: false,
    requiresApproval: false,
    approvalMode: "none",
    approvalKey: descriptor.scopeKey,
    denialReason,
  };
}
