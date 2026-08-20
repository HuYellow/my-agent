# Review Findings Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the four review findings covering shell sandbox path enforcement, terminal session preflight validation, workspace review staged diffs, and production dependency audit advisories.

**Architecture:** Keep enforcement at the existing trust boundaries: `ToolService` should surface every likely filesystem path to `SandboxPolicy`, `TerminalManager` should validate cwd and shell before spawning, and `ReviewManager` should collect the documented workspace review inputs. Dependency remediation should use npm lockfile mechanisms instead of vendoring or code changes.

**Tech Stack:** TypeScript, Vitest, Node.js child process APIs, npm workspaces, npm audit.

---

## File Structure

- Modify: `packages/core/test/tool-service.test.ts`
  Add a regression test proving `run_shell` rejects an absolute outside-workspace path in `workspace-write` with `approvalPolicy: "never"`.
- Modify: `packages/core/src/tools/local-shell-utils.ts`
  Preserve all resolved likely path tokens in `buildShellAnalysis()` so `SandboxPolicy` can deny outside-workspace paths.
- Modify: `packages/core/test/terminal-manager.test.ts`
  Add regression tests proving `TerminalManager.createSession()` rejects an outside cwd and an unexpected shell before backend spawn.
- Modify: `packages/core/src/services/terminal-manager.ts`
  Add pre-spawn cwd containment validation and a conservative shell executable allowlist.
- Modify: `packages/core/test/review-manager.test.ts`
  Add a regression test proving workspace review includes staged-only diffs.
- Modify: `packages/core/src/services/review-manager.ts`
  Combine `git diff` and `git diff --staged` for `source.kind === "workspace"`.
- Modify: `package.json`
  Add npm `overrides` for patched `hono` and `@hono/node-server` if the transitive chain still resolves vulnerable versions.
- Modify: `package-lock.json`
  Refresh lockfile after dependency overrides or audit fix.

---

### Task 1: Shell Sandbox Outside Path Regression

**Files:**
- Test: `packages/core/test/tool-service.test.ts`
- Modify: `packages/core/src/tools/local-shell-utils.ts`

- [ ] **Step 1: Write the failing test**

Add a test inside `describe("ToolService", ...)`:

```ts
it("blocks shell commands that reference absolute paths outside the workspace", async () => {
  const { database, workspace } = createWorkspace({
    sandboxMode: "workspace-write",
    approvalPolicy: "never",
  });
  const outsidePath = join(tmpdir(), `yellow-flow-outside-${Date.now()}.txt`);
  writeFileSync(outsidePath, "outside secret", "utf8");
  const service = new ToolService(workspace, { database, threadId: "thread-1" });
  const command = process.platform === "win32" ? `Get-Content ${JSON.stringify(outsidePath)}` : `cat ${JSON.stringify(outsidePath)}`;

  const plan = service.planExecution("run_shell", { command });

  expect(plan.permission.allowed).toBe(false);
  expect(plan.permission.denialReason).toContain("outside the workspace");
  await expect(
    service.executeTool("run_shell", { command }, { workspace, emitCommandDelta: () => undefined }),
  ).rejects.toBeInstanceOf(ToolBlockedError);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
npm run test --workspace @yellow-flow/core -- test/tool-service.test.ts -t "blocks shell commands that reference absolute paths outside the workspace"
```

Expected before implementation: FAIL because `plan.permission.allowed` is `true` or execution reads the outside file.

- [ ] **Step 3: Write minimal implementation**

In `buildShellAnalysis()`, remove the final outside-workspace filter:

```ts
const paths = lowered
  .map((_token, index) => tokens[index] ?? "")
  .filter((token) => isLikelyPathToken(token))
  .map((token) => resolve(cwd, stripWrappingQuotes(token)))
  .filter((path, index, values) => values.indexOf(path) === index);
```

This leaves the policy decision to `SandboxPolicy.evaluate()`.

- [ ] **Step 4: Run test to verify it passes**

Run the same targeted command. Expected: PASS.

---

### Task 2: Terminal Create Preflight Regression

**Files:**
- Test: `packages/core/test/terminal-manager.test.ts`
- Modify: `packages/core/src/services/terminal-manager.ts`

- [ ] **Step 1: Write failing tests**

Add helper objects or inline workspace records and two tests:

```ts
it("rejects terminal cwd outside the workspace before spawning", () => {
  const root = mkdtempSync(join(tmpdir(), "yellow-flow-terminal-"));
  const outside = mkdtempSync(join(tmpdir(), "yellow-flow-terminal-outside-"));
  const database = new HarnessDatabase(join(root, "app.db"));
  const manager = new TerminalManager(database, () => undefined, () => undefined, () => undefined, () => undefined);

  expect(() =>
    manager.createSession(
      {
        id: "workspace-1",
        name: "Workspace",
        rootPath: root,
        shell: process.platform === "win32" ? "powershell.exe" : "bash",
        sandboxMode: "workspace-write",
        approvalPolicy: "never",
      },
      { cwd: outside },
    ),
  ).toThrow(/outside the workspace/);
  expect(spawnMock).not.toHaveBeenCalled();
});

it("rejects unexpected terminal shells before spawning", () => {
  const root = mkdtempSync(join(tmpdir(), "yellow-flow-terminal-"));
  const database = new HarnessDatabase(join(root, "app.db"));
  const manager = new TerminalManager(database, () => undefined, () => undefined, () => undefined, () => undefined);

  expect(() =>
    manager.createSession(
      {
        id: "workspace-1",
        name: "Workspace",
        rootPath: root,
        shell: process.platform === "win32" ? "powershell.exe" : "bash",
        sandboxMode: "workspace-write",
        approvalPolicy: "never",
      },
      { shell: join(root, "custom-shell.exe") },
    ),
  ).toThrow(/not allowed/);
  expect(spawnMock).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```powershell
npm run test --workspace @yellow-flow/core -- test/terminal-manager.test.ts -t "rejects terminal"
```

Expected before implementation: FAIL because backend spawn is attempted or no error is thrown.

- [ ] **Step 3: Write minimal implementation**

In `terminal-manager.ts`:

```ts
import { basename, resolve } from "node:path";
import { isPathInside } from "../utils/path-utils.js";

const ALLOWED_TERMINAL_SHELLS = new Set(["bash", "sh", "zsh", "fish", "cmd", "cmd.exe", "powershell", "powershell.exe", "pwsh", "pwsh.exe"]);

function resolveTerminalCwd(workspace: WorkspaceProfile, cwd?: string): string {
  const resolved = cwd ? resolve(workspace.rootPath, cwd) : workspace.rootPath;
  if (workspace.sandboxMode !== "danger-full-access" && !isPathInside(workspace.rootPath, resolved)) {
    throw new Error(`Terminal cwd is outside the workspace: ${resolved}`);
  }
  return resolved;
}

function resolveTerminalShell(workspace: WorkspaceProfile, shell?: string): string {
  const candidate = shell ?? workspace.shell;
  if (!ALLOWED_TERMINAL_SHELLS.has(basename(candidate).toLowerCase())) {
    throw new Error(`Terminal shell is not allowed: ${candidate}`);
  }
  return candidate;
}
```

Use those helpers before `this.defaultBackend.start()`.

- [ ] **Step 4: Run tests to verify they pass**

Run:

```powershell
npm run test --workspace @yellow-flow/core -- test/terminal-manager.test.ts
```

Expected: PASS.

---

### Task 3: Workspace Review Staged Diff Regression

**Files:**
- Test: `packages/core/test/review-manager.test.ts`
- Modify: `packages/core/src/services/review-manager.ts`

- [ ] **Step 1: Write the failing test**

Add a test proving staged-only diffs are reviewed:

```ts
it("includes staged-only changes in workspace reviews", async () => {
  const { manager, database, project } = createReviewHarness();
  spawnSyncMock
    .mockReturnValueOnce({ status: 0, stdout: "", stderr: "" })
    .mockReturnValueOnce({ status: 0, stdout: "diff --git a/src/staged.ts b/src/staged.ts\n+const staged = true;\n", stderr: "" });

  const review = manager.start({
    project,
    provider: configuredProvider(),
    source: { kind: "workspace" },
  });

  await vi.waitFor(() => {
    expect(database.getReview(review.id)?.status).toBe("completed");
  });

  expect(spawnSyncMock).toHaveBeenCalledWith("git", ["-c", "core.quotepath=false", "diff", "--no-ext-diff", "--unified=3"], expect.any(Object));
  expect(spawnSyncMock).toHaveBeenCalledWith("git", ["-c", "core.quotepath=false", "diff", "--staged", "--no-ext-diff", "--unified=3"], expect.any(Object));
  expect(database.getReview(review.id)?.summary).toBe("No findings.");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
npm run test --workspace @yellow-flow/core -- test/review-manager.test.ts -t "includes staged-only changes in workspace reviews"
```

Expected before implementation: FAIL because only `git diff` runs and the review completes with "No diff is available for review."

- [ ] **Step 3: Write minimal implementation**

Change the workspace case to collect both diffs:

```ts
case "workspace":
  return joinDiffs(
    runGit(cwd, ["diff", "--no-ext-diff", "--unified=3"]),
    runGit(cwd, ["diff", "--staged", "--no-ext-diff", "--unified=3"]),
  );
```

Add:

```ts
function joinDiffs(...diffs: string[]): string {
  return diffs.map((diff) => diff.trim()).filter(Boolean).join("\n\n");
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run:

```powershell
npm run test --workspace @yellow-flow/core -- test/review-manager.test.ts
```

Expected: PASS.

---

### Task 4: Production Dependency Audit Remediation

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`

- [ ] **Step 1: Confirm vulnerable production tree**

Run:

```powershell
npm audit --omit=dev --registry=https://registry.npmjs.org/
```

Expected before remediation: non-zero exit with moderate advisories for `hono` and `@hono/node-server`.

- [ ] **Step 2: Check patched versions**

Run:

```powershell
npm view hono version --registry=https://registry.npmjs.org/
npm view @hono/node-server version --registry=https://registry.npmjs.org/
```

Expected: versions newer than the vulnerable lockfile entries.

- [ ] **Step 3: Add npm overrides and refresh lockfile**

Add to root `package.json`:

```json
"overrides": {
  "hono": "<patched-version>",
  "@hono/node-server": "<patched-version>"
}
```

Then run:

```powershell
npm install --package-lock-only --registry=https://registry.npmjs.org/
```

- [ ] **Step 4: Verify audit passes**

Run:

```powershell
npm audit --omit=dev --registry=https://registry.npmjs.org/
```

Expected: exit 0 or no production vulnerabilities. If audit still reports the same chain, use `npm audit fix --package-lock-only --omit=dev --registry=https://registry.npmjs.org/`, inspect the diff, and rerun audit.

---

### Task 5: Final Verification

**Files:**
- All modified files above.

- [ ] **Step 1: Run targeted regression tests**

```powershell
npm run test --workspace @yellow-flow/core -- test/tool-service.test.ts -t "blocks shell commands that reference absolute paths outside the workspace"
npm run test --workspace @yellow-flow/core -- test/terminal-manager.test.ts
npm run test --workspace @yellow-flow/core -- test/review-manager.test.ts
```

- [ ] **Step 2: Run repo-level verification**

```powershell
npm run typecheck
npm test
npm run build
npm audit --omit=dev --registry=https://registry.npmjs.org/
```

- [ ] **Step 3: Inspect final diff**

```powershell
git status --short
git diff --stat
git diff -- package.json package-lock.json packages/core/src/tools/local-shell-utils.ts packages/core/src/services/terminal-manager.ts packages/core/src/services/review-manager.ts packages/core/test/tool-service.test.ts packages/core/test/terminal-manager.test.ts packages/core/test/review-manager.test.ts docs/superpowers/plans/2026-04-25-review-findings-remediation.md
```

Expected: changes are limited to the plan, three implementation files, three test files, and dependency metadata.

