# Repository Policy

Teams can commit `.my-agent/policy.json` to tighten local agent permissions for a repository. Repository policy can never expand the user's sandbox or approval permissions.

```json
{
  "enforceReadOnly": false,
  "denyNetwork": true,
  "requireApprovalForWrites": true,
  "protectedPaths": [
    ".github/workflows",
    "deploy/production"
  ]
}
```

- `enforceReadOnly` blocks every write operation.
- `denyNetwork` blocks network-capable tools even when the workspace uses full access.
- `requireApprovalForWrites` requires preflight approval for writes, including when the user-level approval policy is `never`.
- `protectedPaths` contains paths relative to the repository root; writes to those paths and their descendants are blocked.

Invalid policy files fail closed and surface a structured `blocked` tool error. Keep secrets and machine-specific paths out of this file.
