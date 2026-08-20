import { type WorkspaceProfile } from "@yellow-flow/protocol";
import { isPathInside } from "../utils/path-utils.js";
import { type ToolActionDescriptor, type ToolPermissionDecision } from "./types.js";

export class SandboxPolicy {
  evaluate(
    descriptor: ToolActionDescriptor,
    workspace: WorkspaceProfile,
    options: { sessionApproved?: boolean } = {},
  ): ToolPermissionDecision {
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

    if (options.sessionApproved || workspace.approvalPolicy === "never") {
      return {
        allowed: true,
        requiresApproval: false,
        approvalMode: "none",
        approvalKey: descriptor.scopeKey,
        approvalReason: descriptor.approvalReason,
        sessionApproved: options.sessionApproved ?? false,
      };
    }

    if (descriptor.risky) {
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
