import { type WorkspaceProfile } from "@my-agent/protocol";
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
        approvalKey: descriptor.scopeKey,
        denialReason: `Operation targets a path outside the workspace: ${outsidePaths[0]}.`,
      };
    }

    if (workspace.sandboxMode === "read-only" && descriptor.writes) {
      return {
        allowed: false,
        requiresApproval: false,
        approvalKey: descriptor.scopeKey,
        denialReason: "Read-only sandbox blocks write operations.",
      };
    }

    if (workspace.sandboxMode !== "danger-full-access" && descriptor.network) {
      return {
        allowed: false,
        requiresApproval: false,
        approvalKey: descriptor.scopeKey,
        denialReason: `Network-capable operations require danger-full-access sandbox mode.`,
      };
    }

    if (options.sessionApproved || workspace.approvalPolicy === "never") {
      return {
        allowed: true,
        requiresApproval: false,
        approvalKey: descriptor.scopeKey,
        approvalReason: descriptor.approvalReason,
        sessionApproved: options.sessionApproved ?? false,
      };
    }

    if (descriptor.risky) {
      return {
        allowed: true,
        requiresApproval: true,
        approvalKey: descriptor.scopeKey,
        approvalReason: descriptor.approvalReason ?? `Tool action "${descriptor.preview}" requires approval.`,
      };
    }

    return {
      allowed: true,
      requiresApproval: false,
      approvalKey: descriptor.scopeKey,
    };
  }
}
