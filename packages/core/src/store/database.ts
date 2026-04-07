import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { type AgentInputItem } from "@openai/agents";
import {
  type EnvironmentRecord,
  type AgentTaskRecord,
  type AppConfig,
  type ExecutionContextRecord,
  type ItemRecord,
  type McpMountRecord,
  type McpPromptRecord,
  type McpResourceRecord,
  type McpSessionRecord,
  type McpToolRecord,
  type PendingApproval,
  type PluginRecord,
  type ProjectRecord,
  type ReviewRecord,
  type TerminalSessionRecord,
  type ThreadRecord,
  type TurnRecord,
  type WorktreeRecord,
  type WorkspaceProfile,
  type WorkflowRecord,
  type WorkflowRunRecord,
} from "@my-agent/protocol";
import { detectProviderCapabilities } from "../services/provider-capabilities.js";
import { mergeStoredProviderConfig } from "../services/my-agent-config.js";

const DEFAULT_PROVIDER = {
  id: "default-provider",
  name: "Default Provider",
  baseUrl: "",
  apiKey: "",
  model: "",
  apiFlavor: "responses" as const,
  reasoningEffort: "high" as const,
};

const DEFAULT_WORKSPACE: WorkspaceProfile = {
  id: "default-workspace",
  name: "Current Workspace",
  rootPath: process.cwd(),
  shell: process.platform === "win32" ? "powershell" : "bash",
  sandboxMode: "workspace-write",
  approvalPolicy: "on-request",
};

type ThreadWriteRecord = Omit<ThreadRecord, "sandboxMode"> & {
  sandboxMode?: ThreadRecord["sandboxMode"];
  hidden?: ThreadRecord["hidden"];
};

export class HarnessDatabase {
  private readonly db: DatabaseSync;

  constructor(filePath: string) {
    mkdirSync(dirname(filePath), { recursive: true });
    this.db = new DatabaseSync(filePath);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS config (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        root_path TEXT NOT NULL,
        shell TEXT NOT NULL,
        sandbox_mode TEXT NOT NULL,
        approval_policy TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS threads (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        sandbox_mode TEXT NOT NULL DEFAULT 'workspace-write',
        hidden INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        archived_at TEXT
      );

      CREATE TABLE IF NOT EXISTS turns (
        id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL,
        status TEXT NOT NULL,
        input TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS items (
        id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL,
        turn_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        status TEXT NOT NULL,
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        metadata_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS approvals (
        id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL,
        turn_id TEXT NOT NULL,
        tool_name TEXT NOT NULL,
        reason TEXT NOT NULL,
        args_json TEXT NOT NULL,
        scope TEXT NOT NULL,
        runtime_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS approval_rules (
        thread_id TEXT NOT NULL,
        tool_name TEXT NOT NULL,
        approval_key TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (thread_id, tool_name, approval_key)
      );

      CREATE TABLE IF NOT EXISTS session_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        item_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS terminal_sessions (
        id TEXT PRIMARY KEY,
        thread_id TEXT,
        workspace_id TEXT NOT NULL,
        cwd TEXT NOT NULL,
        shell TEXT NOT NULL,
        backend TEXT NOT NULL DEFAULT 'pipe',
        status TEXT NOT NULL,
        cols INTEGER,
        rows INTEGER,
        pid INTEGER,
        exit_code INTEGER,
        failure_reason TEXT,
        started_at TEXT,
        last_active_at TEXT,
        closed_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS agent_tasks (
        id TEXT PRIMARY KEY,
        parent_thread_id TEXT NOT NULL,
        parent_turn_id TEXT,
        title TEXT NOT NULL,
        status TEXT NOT NULL,
        final_output TEXT,
        child_thread_id TEXT,
        last_turn_id TEXT,
        worktree_id TEXT,
        environment_id TEXT,
        execution_context_id TEXT,
        summary_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS worktrees (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        thread_id TEXT,
        agent_id TEXT,
        branch TEXT NOT NULL,
        path TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS environments (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        thread_id TEXT,
        worktree_id TEXT,
        cwd TEXT NOT NULL,
        shell TEXT NOT NULL,
        env_json TEXT NOT NULL,
        detected_tools_json TEXT NOT NULL,
        python_venv_path TEXT,
        node_version TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS execution_contexts (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        thread_id TEXT,
        agent_id TEXT,
        worktree_id TEXT,
        environment_id TEXT,
        cwd TEXT NOT NULL,
        shell TEXT NOT NULL,
        env_json TEXT NOT NULL,
        detected_tools_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS workflows (
        id TEXT PRIMARY KEY,
        project_id TEXT,
        name TEXT NOT NULL,
        description TEXT NOT NULL,
        path TEXT NOT NULL,
        source TEXT NOT NULL,
        steps_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS workflow_runs (
        id TEXT PRIMARY KEY,
        workflow_id TEXT NOT NULL,
        project_id TEXT NOT NULL,
        thread_id TEXT,
        status TEXT NOT NULL,
        pending_step_ids_json TEXT NOT NULL,
        paused_step_ids_json TEXT NOT NULL,
        completed_step_ids_json TEXT NOT NULL,
        failed_step_ids_json TEXT NOT NULL,
        steps_json TEXT NOT NULL,
        pause_reason TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS plugins (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        version TEXT NOT NULL,
        path TEXT NOT NULL,
        source TEXT NOT NULL,
        enabled INTEGER NOT NULL,
        capabilities_json TEXT NOT NULL,
        sandbox_mode TEXT,
        command TEXT,
        args_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS mcp_mounts (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        transport TEXT NOT NULL,
        command TEXT,
        args_json TEXT,
        url TEXT,
        enabled INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS mcp_sessions (
        id TEXT PRIMARY KEY,
        mount_id TEXT NOT NULL,
        status TEXT NOT NULL,
        transport TEXT NOT NULL,
        last_connected_at TEXT,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS mcp_mount_cache (
        mount_id TEXT PRIMARY KEY,
        tools_json TEXT NOT NULL,
        prompts_json TEXT NOT NULL,
        resources_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS reviews (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        thread_id TEXT,
        execution_context_id TEXT,
        status TEXT NOT NULL,
        source_json TEXT NOT NULL,
        instructions TEXT,
        summary TEXT,
        findings_json TEXT NOT NULL,
        error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        completed_at TEXT
      );
    `);
    this.migrate();
  }

  getDefaultConfig(): AppConfig {
    const providerCapabilities = detectProviderCapabilities(DEFAULT_PROVIDER);
    return {
      globalInstructions: "You are a local coding agent. Be accurate, cautious with changes, and explicit about approvals.",
      provider: DEFAULT_PROVIDER,
      providerCapabilities,
      workspace: DEFAULT_WORKSPACE,
      disabledSkillIds: [],
      runtimeRunMode: providerCapabilities.recommendedRunMode,
    };
  }

  getConfig(): AppConfig {
    const row = this.db.prepare("SELECT value FROM config WHERE key = ?").get("app_config") as { value?: string } | undefined;

    if (!row?.value) {
      const defaults = this.getDefaultConfig();
      this.writeConfig(defaults);
      return mergeStoredProviderConfig(defaults);
    }

    const parsed = JSON.parse(row.value) as AppConfig;
    return mergeStoredProviderConfig({
      ...this.getDefaultConfig(),
      ...parsed,
      selectedProjectId: parsed.selectedProjectId ?? parsed.selectedWorkspaceId,
      provider: {
        ...DEFAULT_PROVIDER,
        ...parsed.provider,
      },
      workspace: {
        ...DEFAULT_WORKSPACE,
        ...parsed.workspace,
      },
      disabledSkillIds: parsed.disabledSkillIds ?? [],
      providerCapabilities: detectProviderCapabilities({
        ...DEFAULT_PROVIDER,
        ...parsed.provider,
      }),
    });
  }

  writeConfig(config: AppConfig): AppConfig {
    this.db
      .prepare("INSERT INTO config(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .run("app_config", JSON.stringify(config));
    return config;
  }

  listThreads(options: { includeHidden?: boolean } = {}): ThreadRecord[] {
    const rows = options.includeHidden
      ? (this.db.prepare("SELECT * FROM threads ORDER BY updated_at DESC").all() as Record<string, unknown>[])
      : (this.db.prepare("SELECT * FROM threads WHERE COALESCE(hidden, 0) = 0 ORDER BY updated_at DESC").all() as Record<string, unknown>[]);

    return rows.map((row) => this.mapThread(row));
  }

  listProjects(): ProjectRecord[] {
    return this.db
      .prepare("SELECT * FROM projects ORDER BY updated_at DESC, created_at DESC")
      .all()
      .map((row) => this.mapProject(row as Record<string, unknown>));
  }

  getProject(projectId: string): ProjectRecord | null {
    const row = this.db.prepare("SELECT * FROM projects WHERE id = ?").get(projectId) as Record<string, unknown> | undefined;
    return row ? this.mapProject(row) : null;
  }

  createProject(project: ProjectRecord): ProjectRecord {
    this.db
      .prepare(
        "INSERT INTO projects(id, name, root_path, shell, sandbox_mode, approval_policy, created_at, updated_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(project.id, project.name, project.rootPath, project.shell, project.sandboxMode, project.approvalPolicy, project.createdAt, project.updatedAt);
    return project;
  }

  updateProject(project: ProjectRecord): ProjectRecord {
    this.db
      .prepare(
        "UPDATE projects SET name = ?, root_path = ?, shell = ?, sandbox_mode = ?, approval_policy = ?, updated_at = ? WHERE id = ?",
      )
      .run(project.name, project.rootPath, project.shell, project.sandboxMode, project.approvalPolicy, project.updatedAt, project.id);
    return project;
  }

  getThread(threadId: string): ThreadRecord | null {
    const row = this.db.prepare("SELECT * FROM threads WHERE id = ?").get(threadId) as Record<string, unknown> | undefined;
    return row ? this.mapThread(row) : null;
  }

  createThread(thread: ThreadWriteRecord): ThreadRecord {
    const normalized = this.normalizeThread(thread);
    this.db
      .prepare(
        "INSERT INTO threads(id, title, workspace_id, project_id, sandbox_mode, hidden, created_at, updated_at, archived_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        normalized.id,
        normalized.title,
        normalized.projectId,
        normalized.projectId,
        normalized.sandboxMode,
        normalized.hidden ? 1 : 0,
        normalized.createdAt,
        normalized.updatedAt,
        normalized.archivedAt ?? null,
      );
    return normalized;
  }

  updateThread(thread: ThreadWriteRecord): ThreadRecord {
    const normalized = this.normalizeThread(thread);
    this.db
      .prepare("UPDATE threads SET title = ?, workspace_id = ?, project_id = ?, sandbox_mode = ?, hidden = ?, updated_at = ?, archived_at = ? WHERE id = ?")
      .run(
        normalized.title,
        normalized.projectId,
        normalized.projectId,
        normalized.sandboxMode,
        normalized.hidden ? 1 : 0,
        normalized.updatedAt,
        normalized.archivedAt ?? null,
        normalized.id,
      );
    return normalized;
  }

  createTurn(turn: TurnRecord): TurnRecord {
    this.db
      .prepare("INSERT INTO turns(id, thread_id, status, input, created_at, updated_at) VALUES(?, ?, ?, ?, ?, ?)")
      .run(turn.id, turn.threadId, turn.status, turn.input, turn.createdAt, turn.updatedAt);
    return turn;
  }

  getTurn(turnId: string): TurnRecord | null {
    const row = this.db.prepare("SELECT * FROM turns WHERE id = ?").get(turnId) as Record<string, unknown> | undefined;
    return row ? this.mapTurn(row) : null;
  }

  listTurns(threadId: string): TurnRecord[] {
    return this.db
      .prepare("SELECT * FROM turns WHERE thread_id = ? ORDER BY created_at ASC")
      .all(threadId)
      .map((row) => this.mapTurn(row as Record<string, unknown>));
  }

  updateTurn(turn: TurnRecord): TurnRecord {
    this.db
      .prepare("UPDATE turns SET status = ?, updated_at = ?, input = ? WHERE id = ?")
      .run(turn.status, turn.updatedAt, turn.input, turn.id);
    return turn;
  }

  createItem(item: ItemRecord): ItemRecord {
    this.db
      .prepare(
        "INSERT INTO items(id, thread_id, turn_id, kind, status, title, body, metadata_json, created_at, updated_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(item.id, item.threadId, item.turnId, item.kind, item.status, item.title, item.body, JSON.stringify(item.metadata ?? {}), item.createdAt, item.updatedAt);
    return item;
  }

  updateItem(item: ItemRecord): ItemRecord {
    this.db
      .prepare("UPDATE items SET status = ?, title = ?, body = ?, metadata_json = ?, updated_at = ? WHERE id = ?")
      .run(item.status, item.title, item.body, JSON.stringify(item.metadata ?? {}), item.updatedAt, item.id);
    return item;
  }

  listItems(threadId: string): ItemRecord[] {
    return this.db
      .prepare("SELECT * FROM items WHERE thread_id = ? ORDER BY created_at ASC")
      .all(threadId)
      .map((row) => this.mapItem(row as Record<string, unknown>));
  }

  createReview(review: ReviewRecord): ReviewRecord {
    this.db
      .prepare(
        `
          INSERT INTO reviews(
            id,
            project_id,
            thread_id,
            execution_context_id,
            status,
            source_json,
            instructions,
            summary,
            findings_json,
            error,
            created_at,
            updated_at,
            completed_at
          ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        review.id,
        review.projectId,
        review.threadId ?? null,
        review.executionContextId ?? null,
        review.status,
        JSON.stringify(review.source),
        review.instructions ?? null,
        review.summary ?? null,
        JSON.stringify(review.findings),
        review.error ?? null,
        review.createdAt,
        review.updatedAt,
        review.completedAt ?? null,
      );
    return review;
  }

  getReview(reviewId: string): ReviewRecord | null {
    const row = this.db.prepare("SELECT * FROM reviews WHERE id = ?").get(reviewId) as Record<string, unknown> | undefined;
    return row ? this.mapReview(row) : null;
  }

  listReviews(projectId?: string, threadId?: string): ReviewRecord[] {
    let rows: Record<string, unknown>[];

    if (threadId) {
      rows = this.db.prepare("SELECT * FROM reviews WHERE thread_id = ? ORDER BY created_at DESC").all(threadId) as Record<string, unknown>[];
    } else if (projectId) {
      rows = this.db.prepare("SELECT * FROM reviews WHERE project_id = ? ORDER BY created_at DESC").all(projectId) as Record<string, unknown>[];
    } else {
      rows = this.db.prepare("SELECT * FROM reviews ORDER BY created_at DESC").all() as Record<string, unknown>[];
    }

    return rows.map((row) => this.mapReview(row));
  }

  updateReview(review: ReviewRecord): ReviewRecord {
    this.db
      .prepare(
        `
          UPDATE reviews
          SET project_id = ?, thread_id = ?, execution_context_id = ?, status = ?, source_json = ?, instructions = ?, summary = ?, findings_json = ?, error = ?, updated_at = ?, completed_at = ?
          WHERE id = ?
        `,
      )
      .run(
        review.projectId,
        review.threadId ?? null,
        review.executionContextId ?? null,
        review.status,
        JSON.stringify(review.source),
        review.instructions ?? null,
        review.summary ?? null,
        JSON.stringify(review.findings),
        review.error ?? null,
        review.updatedAt,
        review.completedAt ?? null,
        review.id,
      );
    return review;
  }

  putPendingApproval(approval: PendingApproval, runtime: Record<string, unknown>): PendingApproval {
    this.db
      .prepare(
        "INSERT INTO approvals(id, thread_id, turn_id, tool_name, reason, args_json, scope, runtime_json, created_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(approval.id, approval.threadId, approval.turnId, approval.toolName, approval.reason, JSON.stringify(approval.args), approval.scope, JSON.stringify(runtime), approval.createdAt);
    return approval;
  }

  getPendingApproval(approvalId: string): { approval: PendingApproval; runtime: Record<string, unknown> } | null {
    const row = this.db.prepare("SELECT * FROM approvals WHERE id = ?").get(approvalId) as Record<string, unknown> | undefined;

    if (!row) {
      return null;
    }

    return {
      approval: this.mapApproval(row),
      runtime: JSON.parse(String(row.runtime_json)) as Record<string, unknown>,
    };
  }

  getPendingApprovalForTurn(turnId: string): PendingApproval | null {
    const row = this.db.prepare("SELECT * FROM approvals WHERE turn_id = ? ORDER BY created_at DESC LIMIT 1").get(turnId) as Record<string, unknown> | undefined;
    return row ? this.mapApproval(row) : null;
  }

  deletePendingApproval(approvalId: string): void {
    this.db.prepare("DELETE FROM approvals WHERE id = ?").run(approvalId);
  }

  hasApprovalRule(threadId: string, toolName: string, approvalKey: string): boolean {
    const row = this.db
      .prepare("SELECT 1 AS present FROM approval_rules WHERE thread_id = ? AND tool_name = ? AND approval_key = ? LIMIT 1")
      .get(threadId, toolName, approvalKey) as { present?: number } | undefined;
    return row?.present === 1;
  }

  upsertApprovalRule(rule: { threadId: string; toolName: string; approvalKey: string; createdAt: string; updatedAt: string }): void {
    this.db
      .prepare(
        `
          INSERT INTO approval_rules(thread_id, tool_name, approval_key, created_at, updated_at)
          VALUES(?, ?, ?, ?, ?)
          ON CONFLICT(thread_id, tool_name, approval_key) DO UPDATE SET updated_at = excluded.updated_at
        `,
      )
      .run(rule.threadId, rule.toolName, rule.approvalKey, rule.createdAt, rule.updatedAt);
  }

  clearApprovalRules(threadId: string): void {
    this.db.prepare("DELETE FROM approval_rules WHERE thread_id = ?").run(threadId);
  }

  listSessionItems(sessionId: string, limit?: number): AgentInputItem[] {
    if (typeof limit === "number") {
      const rows = this.db
        .prepare(
          "SELECT item_json FROM (SELECT item_json, id FROM session_items WHERE session_id = ? ORDER BY id DESC LIMIT ?) ORDER BY id ASC",
        )
        .all(sessionId, limit) as Array<{ item_json: string }>;
      return rows.map((row) => JSON.parse(row.item_json) as AgentInputItem);
    }

    const rows = this.db.prepare("SELECT item_json FROM session_items WHERE session_id = ? ORDER BY id ASC").all(sessionId) as Array<{ item_json: string }>;
    return rows.map((row) => JSON.parse(row.item_json) as AgentInputItem);
  }

  countSessionItems(sessionId: string): number {
    const row = this.db.prepare("SELECT COUNT(*) AS count FROM session_items WHERE session_id = ?").get(sessionId) as { count: number };
    return row.count;
  }

  appendSessionItems(sessionId: string, items: AgentInputItem[]): void {
    const statement = this.db.prepare("INSERT INTO session_items(session_id, item_json, created_at) VALUES(?, ?, ?)");

    for (const item of items) {
      statement.run(sessionId, JSON.stringify(item), new Date().toISOString());
    }
  }

  popSessionItem(sessionId: string): AgentInputItem | undefined {
    const row = this.db.prepare("SELECT id, item_json FROM session_items WHERE session_id = ? ORDER BY id DESC LIMIT 1").get(sessionId) as
      | { id: number; item_json: string }
      | undefined;

    if (!row) {
      return undefined;
    }

    this.db.prepare("DELETE FROM session_items WHERE id = ?").run(row.id);
    return JSON.parse(row.item_json) as AgentInputItem;
  }

  clearSession(sessionId: string): void {
    this.db.prepare("DELETE FROM session_items WHERE session_id = ?").run(sessionId);
  }

  copySessionItems(fromSessionId: string, toSessionId: string): void {
    const items = this.listSessionItems(fromSessionId);
    this.appendSessionItems(toSessionId, items);
  }

  getTerminalSession(sessionId: string): TerminalSessionRecord | null {
    const row = this.db.prepare("SELECT * FROM terminal_sessions WHERE id = ?").get(sessionId) as Record<string, unknown> | undefined;
    return row ? this.mapTerminalSession(row) : null;
  }

  createTerminalSession(session: TerminalSessionRecord): TerminalSessionRecord {
    this.db
      .prepare(
        `INSERT INTO terminal_sessions(
          id, thread_id, workspace_id, cwd, shell, backend, status, cols, rows, pid, exit_code, failure_reason, started_at, last_active_at, closed_at, created_at, updated_at
        ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)` ,
      )
      .run(
        session.id,
        session.threadId ?? null,
        session.workspaceId,
        session.cwd,
        session.shell,
        session.backend,
        session.status,
        session.cols ?? null,
        session.rows ?? null,
        session.pid ?? null,
        session.exitCode ?? null,
        session.failureReason ?? null,
        session.startedAt,
        session.lastActiveAt,
        session.closedAt ?? null,
        session.createdAt,
        session.updatedAt,
      );
    return session;
  }

  updateTerminalSession(session: TerminalSessionRecord): TerminalSessionRecord {
    this.db
      .prepare(
        `UPDATE terminal_sessions
         SET thread_id = ?, workspace_id = ?, cwd = ?, shell = ?, backend = ?, status = ?, cols = ?, rows = ?, pid = ?, exit_code = ?, failure_reason = ?, started_at = ?, last_active_at = ?, closed_at = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        session.threadId ?? null,
        session.workspaceId,
        session.cwd,
        session.shell,
        session.backend,
        session.status,
        session.cols ?? null,
        session.rows ?? null,
        session.pid ?? null,
        session.exitCode ?? null,
        session.failureReason ?? null,
        session.startedAt,
        session.lastActiveAt,
        session.closedAt ?? null,
        session.updatedAt,
        session.id,
      );
    return session;
  }

  listTerminalSessions(threadId?: string): TerminalSessionRecord[] {
    const rows = threadId
      ? (this.db.prepare("SELECT * FROM terminal_sessions WHERE thread_id = ? ORDER BY created_at ASC").all(threadId) as Record<string, unknown>[])
      : (this.db.prepare("SELECT * FROM terminal_sessions ORDER BY created_at ASC").all() as Record<string, unknown>[]);
    return rows.map((row) => this.mapTerminalSession(row));
  }

  createAgentTask(task: AgentTaskRecord): AgentTaskRecord {
    this.db
      .prepare(
        "INSERT INTO agent_tasks(id, parent_thread_id, parent_turn_id, title, status, final_output, child_thread_id, last_turn_id, worktree_id, environment_id, execution_context_id, summary_json, created_at, updated_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        task.id,
        task.parentThreadId,
        task.parentTurnId ?? null,
        task.title,
        task.status,
        task.finalOutput ?? null,
        task.childThreadId ?? null,
        task.lastTurnId ?? null,
        task.worktreeId ?? null,
        task.environmentId ?? null,
        task.executionContextId ?? null,
        task.summary ? JSON.stringify(task.summary) : null,
        task.createdAt,
        task.updatedAt,
      );
    return task;
  }

  getAgentTask(taskId: string): AgentTaskRecord | null {
    const row = this.db.prepare("SELECT * FROM agent_tasks WHERE id = ?").get(taskId) as Record<string, unknown> | undefined;
    return row ? this.mapAgentTask(row) : null;
  }

  getAgentTaskByChildThreadId(threadId: string): AgentTaskRecord | null {
    const row = this.db.prepare("SELECT * FROM agent_tasks WHERE child_thread_id = ? ORDER BY created_at DESC LIMIT 1").get(threadId) as
      | Record<string, unknown>
      | undefined;
    return row ? this.mapAgentTask(row) : null;
  }

  updateAgentTask(task: AgentTaskRecord): AgentTaskRecord {
    this.db
      .prepare(
        "UPDATE agent_tasks SET title = ?, status = ?, final_output = ?, child_thread_id = ?, last_turn_id = ?, worktree_id = ?, environment_id = ?, execution_context_id = ?, summary_json = ?, updated_at = ? WHERE id = ?",
      )
      .run(
        task.title,
        task.status,
        task.finalOutput ?? null,
        task.childThreadId ?? null,
        task.lastTurnId ?? null,
        task.worktreeId ?? null,
        task.environmentId ?? null,
        task.executionContextId ?? null,
        task.summary ? JSON.stringify(task.summary) : null,
        task.updatedAt,
        task.id,
      );
    return task;
  }

  createWorktree(worktree: WorktreeRecord): WorktreeRecord {
    this.db
      .prepare(
        "INSERT INTO worktrees(id, project_id, thread_id, agent_id, branch, path, status, created_at, updated_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        worktree.id,
        worktree.projectId,
        worktree.threadId ?? null,
        worktree.agentId ?? null,
        worktree.branch,
        worktree.path,
        worktree.status,
        worktree.createdAt,
        worktree.updatedAt,
      );
    return worktree;
  }

  getWorktree(worktreeId: string): WorktreeRecord | null {
    const row = this.db.prepare("SELECT * FROM worktrees WHERE id = ?").get(worktreeId) as Record<string, unknown> | undefined;
    return row ? this.mapWorktree(row) : null;
  }

  listWorktrees(projectId?: string): WorktreeRecord[] {
    const rows = projectId
      ? (this.db.prepare("SELECT * FROM worktrees WHERE project_id = ? ORDER BY created_at ASC").all(projectId) as Record<string, unknown>[])
      : (this.db.prepare("SELECT * FROM worktrees ORDER BY created_at ASC").all() as Record<string, unknown>[]);
    return rows.map((row) => this.mapWorktree(row));
  }

  updateWorktree(worktree: WorktreeRecord): WorktreeRecord {
    this.db
      .prepare("UPDATE worktrees SET thread_id = ?, agent_id = ?, branch = ?, path = ?, status = ?, updated_at = ? WHERE id = ?")
      .run(worktree.threadId ?? null, worktree.agentId ?? null, worktree.branch, worktree.path, worktree.status, worktree.updatedAt, worktree.id);
    return worktree;
  }

  createEnvironment(environment: EnvironmentRecord): EnvironmentRecord {
    this.db
      .prepare(
        "INSERT INTO environments(id, project_id, thread_id, worktree_id, cwd, shell, env_json, detected_tools_json, python_venv_path, node_version, created_at, updated_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        environment.id,
        environment.projectId,
        environment.threadId ?? null,
        environment.worktreeId ?? null,
        environment.cwd,
        environment.shell,
        JSON.stringify(environment.envJson),
        JSON.stringify(environment.detectedTools),
        environment.pythonVenvPath ?? null,
        environment.nodeVersion ?? null,
        environment.createdAt,
        environment.updatedAt,
      );
    return environment;
  }

  listEnvironments(projectId?: string): EnvironmentRecord[] {
    const rows = projectId
      ? (this.db.prepare("SELECT * FROM environments WHERE project_id = ? ORDER BY created_at ASC").all(projectId) as Record<string, unknown>[])
      : (this.db.prepare("SELECT * FROM environments ORDER BY created_at ASC").all() as Record<string, unknown>[]);
    return rows.map((row) => this.mapEnvironment(row));
  }

  createExecutionContext(executionContext: ExecutionContextRecord): ExecutionContextRecord {
    this.db
      .prepare(
        "INSERT INTO execution_contexts(id, project_id, kind, thread_id, agent_id, worktree_id, environment_id, cwd, shell, env_json, detected_tools_json, created_at, updated_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        executionContext.id,
        executionContext.projectId,
        executionContext.kind,
        executionContext.threadId ?? null,
        executionContext.agentId ?? null,
        executionContext.worktreeId ?? null,
        executionContext.environmentId ?? null,
        executionContext.cwd,
        executionContext.shell,
        JSON.stringify(executionContext.envJson),
        JSON.stringify(executionContext.detectedTools),
        executionContext.createdAt,
        executionContext.updatedAt,
      );
    return executionContext;
  }

  updateExecutionContext(executionContext: ExecutionContextRecord): ExecutionContextRecord {
    this.db
      .prepare(
        "UPDATE execution_contexts SET project_id = ?, kind = ?, thread_id = ?, agent_id = ?, worktree_id = ?, environment_id = ?, cwd = ?, shell = ?, env_json = ?, detected_tools_json = ?, updated_at = ? WHERE id = ?",
      )
      .run(
        executionContext.projectId,
        executionContext.kind,
        executionContext.threadId ?? null,
        executionContext.agentId ?? null,
        executionContext.worktreeId ?? null,
        executionContext.environmentId ?? null,
        executionContext.cwd,
        executionContext.shell,
        JSON.stringify(executionContext.envJson),
        JSON.stringify(executionContext.detectedTools),
        executionContext.updatedAt,
        executionContext.id,
      );
    return executionContext;
  }

  getExecutionContext(executionContextId: string): ExecutionContextRecord | null {
    const row = this.db.prepare("SELECT * FROM execution_contexts WHERE id = ?").get(executionContextId) as Record<string, unknown> | undefined;
    return row ? this.mapExecutionContext(row) : null;
  }

  listExecutionContexts(projectId?: string): ExecutionContextRecord[] {
    const rows = projectId
      ? (this.db.prepare("SELECT * FROM execution_contexts WHERE project_id = ? ORDER BY created_at ASC").all(projectId) as Record<string, unknown>[])
      : (this.db.prepare("SELECT * FROM execution_contexts ORDER BY created_at ASC").all() as Record<string, unknown>[]);
    return rows.map((row) => this.mapExecutionContext(row));
  }

  upsertWorkflow(workflow: WorkflowRecord): WorkflowRecord {
    this.db
      .prepare(
        `INSERT INTO workflows(id, project_id, name, description, path, source, steps_json, created_at, updated_at)
         VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           project_id = excluded.project_id,
           name = excluded.name,
           description = excluded.description,
           path = excluded.path,
           source = excluded.source,
           steps_json = excluded.steps_json,
           updated_at = excluded.updated_at`,
      )
      .run(
        workflow.id,
        null,
        workflow.name,
        workflow.description,
        workflow.path,
        workflow.source,
        JSON.stringify(workflow.steps),
        workflow.createdAt,
        workflow.updatedAt,
      );
    return workflow;
  }

  listWorkflows(_projectId?: string): WorkflowRecord[] {
    const rows = this.db.prepare("SELECT * FROM workflows ORDER BY name ASC").all() as Record<string, unknown>[];
    return rows.map((row) => this.mapWorkflow(row));
  }

  getWorkflow(workflowId: string): WorkflowRecord | null {
    const row = this.db.prepare("SELECT * FROM workflows WHERE id = ?").get(workflowId) as Record<string, unknown> | undefined;
    return row ? this.mapWorkflow(row) : null;
  }

  createWorkflowRun(run: WorkflowRunRecord): WorkflowRunRecord {
    this.db
      .prepare(
        "INSERT INTO workflow_runs(id, workflow_id, project_id, thread_id, status, pending_step_ids_json, paused_step_ids_json, completed_step_ids_json, failed_step_ids_json, steps_json, pause_reason, created_at, updated_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        run.id,
        run.workflowId,
        run.projectId,
        run.threadId ?? null,
        run.status,
        JSON.stringify(run.pendingStepIds),
        JSON.stringify(run.pausedStepIds),
        JSON.stringify(run.completedStepIds),
        JSON.stringify(run.failedStepIds),
        JSON.stringify(run.steps),
        run.pauseReason ?? null,
        run.createdAt,
        run.updatedAt,
      );
    return run;
  }

  updateWorkflowRun(run: WorkflowRunRecord): WorkflowRunRecord {
    this.db
      .prepare(
        "UPDATE workflow_runs SET status = ?, pending_step_ids_json = ?, paused_step_ids_json = ?, completed_step_ids_json = ?, failed_step_ids_json = ?, steps_json = ?, pause_reason = ?, updated_at = ? WHERE id = ?",
      )
      .run(
        run.status,
        JSON.stringify(run.pendingStepIds),
        JSON.stringify(run.pausedStepIds),
        JSON.stringify(run.completedStepIds),
        JSON.stringify(run.failedStepIds),
        JSON.stringify(run.steps),
        run.pauseReason ?? null,
        run.updatedAt,
        run.id,
      );
    return run;
  }

  getWorkflowRun(runId: string): WorkflowRunRecord | null {
    const row = this.db.prepare("SELECT * FROM workflow_runs WHERE id = ?").get(runId) as Record<string, unknown> | undefined;
    return row ? this.mapWorkflowRun(row) : null;
  }

  listWorkflowRuns(workflowId?: string): WorkflowRunRecord[] {
    const rows = workflowId
      ? (this.db.prepare("SELECT * FROM workflow_runs WHERE workflow_id = ? ORDER BY created_at DESC").all(workflowId) as Record<string, unknown>[])
      : (this.db.prepare("SELECT * FROM workflow_runs ORDER BY created_at DESC").all() as Record<string, unknown>[]);
    return rows.map((row) => this.mapWorkflowRun(row));
  }

  upsertPlugin(plugin: PluginRecord): PluginRecord {
    this.db
      .prepare(
        `INSERT INTO plugins(id, name, version, path, source, enabled, capabilities_json, sandbox_mode, command, args_json, created_at, updated_at)
         VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name,
           version = excluded.version,
           path = excluded.path,
           source = excluded.source,
           enabled = excluded.enabled,
           capabilities_json = excluded.capabilities_json,
           sandbox_mode = excluded.sandbox_mode,
           command = excluded.command,
           args_json = excluded.args_json,
           updated_at = excluded.updated_at`,
      )
      .run(
        plugin.id,
        plugin.name,
        plugin.version,
        plugin.path,
        plugin.source,
        plugin.enabled ? 1 : 0,
        JSON.stringify(plugin.capabilities),
        plugin.sandboxMode ?? null,
        plugin.command ?? null,
        plugin.args ? JSON.stringify(plugin.args) : null,
        plugin.createdAt,
        plugin.updatedAt,
      );
    return plugin;
  }

  listPlugins(): PluginRecord[] {
    const rows = this.db.prepare("SELECT * FROM plugins ORDER BY name ASC").all() as Record<string, unknown>[];
    return rows.map((row) => this.mapPlugin(row));
  }

  upsertMcpMount(mount: McpMountRecord): McpMountRecord {
    this.db
      .prepare(
        `INSERT INTO mcp_mounts(id, name, transport, command, args_json, url, enabled, created_at, updated_at)
         VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name,
           transport = excluded.transport,
           command = excluded.command,
           args_json = excluded.args_json,
           url = excluded.url,
           enabled = excluded.enabled,
           updated_at = excluded.updated_at`,
      )
      .run(
        mount.id,
        mount.name,
        mount.transport,
        mount.command ?? null,
        mount.args ? JSON.stringify(mount.args) : null,
        mount.url ?? null,
        mount.enabled ? 1 : 0,
        mount.createdAt,
        mount.updatedAt,
      );
    return mount;
  }

  listMcpMounts(): McpMountRecord[] {
    const rows = this.db.prepare("SELECT * FROM mcp_mounts ORDER BY name ASC").all() as Record<string, unknown>[];
    return rows.map((row) => this.mapMcpMount(row));
  }

  upsertMcpSession(session: McpSessionRecord): McpSessionRecord {
    this.db
      .prepare(
        `INSERT INTO mcp_sessions(id, mount_id, status, transport, last_connected_at, updated_at)
         VALUES(?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           mount_id = excluded.mount_id,
           status = excluded.status,
           transport = excluded.transport,
           last_connected_at = excluded.last_connected_at,
           updated_at = excluded.updated_at`,
      )
      .run(session.id, session.mountId, session.status, session.transport, session.lastConnectedAt ?? null, session.updatedAt);
    return session;
  }

  listMcpSessions(): McpSessionRecord[] {
    const rows = this.db.prepare("SELECT * FROM mcp_sessions ORDER BY updated_at DESC").all() as Record<string, unknown>[];
    return rows.map((row) => this.mapMcpSession(row));
  }

  getMcpSessionByMountId(mountId: string): McpSessionRecord | null {
    const row = this.db.prepare("SELECT * FROM mcp_sessions WHERE mount_id = ? ORDER BY updated_at DESC LIMIT 1").get(mountId) as Record<string, unknown> | undefined;
    return row ? this.mapMcpSession(row) : null;
  }

  upsertMcpMountCache(params: {
    mountId: string;
    tools: McpToolRecord[];
    prompts: McpPromptRecord[];
    resources: McpResourceRecord[];
    updatedAt: string;
  }): void {
    this.db
      .prepare(
        `INSERT INTO mcp_mount_cache(mount_id, tools_json, prompts_json, resources_json, updated_at)
         VALUES(?, ?, ?, ?, ?)
         ON CONFLICT(mount_id) DO UPDATE SET
           tools_json = excluded.tools_json,
           prompts_json = excluded.prompts_json,
           resources_json = excluded.resources_json,
           updated_at = excluded.updated_at`,
      )
      .run(params.mountId, JSON.stringify(params.tools), JSON.stringify(params.prompts), JSON.stringify(params.resources), params.updatedAt);
  }

  getMcpMountCache(mountId: string): { tools: McpToolRecord[]; prompts: McpPromptRecord[]; resources: McpResourceRecord[]; updatedAt: string } | null {
    const row = this.db.prepare("SELECT * FROM mcp_mount_cache WHERE mount_id = ?").get(mountId) as Record<string, unknown> | undefined;
    if (!row) {
      return null;
    }
    return {
      tools: JSON.parse(String(row.tools_json)) as McpToolRecord[],
      prompts: JSON.parse(String(row.prompts_json)) as McpPromptRecord[],
      resources: JSON.parse(String(row.resources_json)) as McpResourceRecord[],
      updatedAt: String(row.updated_at),
    };
  }

  private mapThread(row: Record<string, unknown>): ThreadRecord {
    return {
      id: String(row.id),
      title: String(row.title),
      projectId: String(row.project_id ?? row.workspace_id),
      sandboxMode: (row.sandbox_mode as ThreadRecord["sandboxMode"]) ?? "workspace-write",
      hidden: Number(row.hidden ?? 0) === 1,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
      archivedAt: row.archived_at ? String(row.archived_at) : null,
    };
  }

  private mapProject(row: Record<string, unknown>): ProjectRecord {
    return {
      id: String(row.id),
      name: String(row.name),
      rootPath: String(row.root_path),
      shell: String(row.shell),
      sandboxMode: row.sandbox_mode as ProjectRecord["sandboxMode"],
      approvalPolicy: row.approval_policy as ProjectRecord["approvalPolicy"],
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }

  private mapTurn(row: Record<string, unknown>): TurnRecord {
    return {
      id: String(row.id),
      threadId: String(row.thread_id),
      status: row.status as TurnRecord["status"],
      input: String(row.input),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }

  private mapItem(row: Record<string, unknown>): ItemRecord {
    return {
      id: String(row.id),
      threadId: String(row.thread_id),
      turnId: String(row.turn_id),
      kind: row.kind as ItemRecord["kind"],
      status: row.status as ItemRecord["status"],
      title: String(row.title),
      body: String(row.body),
      metadata: row.metadata_json ? (JSON.parse(String(row.metadata_json)) as Record<string, unknown>) : {},
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }

  private mapReview(row: Record<string, unknown>): ReviewRecord {
    return {
      id: String(row.id),
      projectId: String(row.project_id),
      threadId: row.thread_id ? String(row.thread_id) : undefined,
      executionContextId: row.execution_context_id ? String(row.execution_context_id) : undefined,
      status: row.status as ReviewRecord["status"],
      source: JSON.parse(String(row.source_json)) as ReviewRecord["source"],
      instructions: row.instructions ? String(row.instructions) : undefined,
      summary: row.summary ? String(row.summary) : undefined,
      findings: JSON.parse(String(row.findings_json)) as ReviewRecord["findings"],
      error: row.error ? String(row.error) : undefined,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
      completedAt: row.completed_at ? String(row.completed_at) : undefined,
    };
  }

  private mapApproval(row: Record<string, unknown>): PendingApproval {
    return {
      id: String(row.id),
      threadId: String(row.thread_id),
      turnId: String(row.turn_id),
      toolName: String(row.tool_name),
      reason: String(row.reason),
      args: JSON.parse(String(row.args_json)) as Record<string, unknown>,
      scope: row.scope as PendingApproval["scope"],
      createdAt: String(row.created_at),
    };
  }

  private mapTerminalSession(row: Record<string, unknown>): TerminalSessionRecord {
    return {
      id: String(row.id),
      threadId: row.thread_id ? String(row.thread_id) : undefined,
      workspaceId: String(row.workspace_id),
      cwd: String(row.cwd),
      shell: String(row.shell),
      backend: (row.backend as TerminalSessionRecord["backend"]) ?? "pipe",
      status: row.status as TerminalSessionRecord["status"],
      cols: typeof row.cols === "number" ? row.cols : row.cols != null ? Number(row.cols) : undefined,
      rows: typeof row.rows === "number" ? row.rows : row.rows != null ? Number(row.rows) : undefined,
      pid: typeof row.pid === "number" ? row.pid : row.pid != null ? Number(row.pid) : undefined,
      exitCode: typeof row.exit_code === "number" ? row.exit_code : row.exit_code != null ? Number(row.exit_code) : undefined,
      failureReason: row.failure_reason ? String(row.failure_reason) : undefined,
      startedAt: row.started_at ? String(row.started_at) : String(row.created_at),
      lastActiveAt: row.last_active_at ? String(row.last_active_at) : String(row.updated_at),
      closedAt: row.closed_at ? String(row.closed_at) : undefined,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }

  private mapAgentTask(row: Record<string, unknown>): AgentTaskRecord {
    return {
      id: String(row.id),
      parentThreadId: String(row.parent_thread_id),
      parentTurnId: row.parent_turn_id ? String(row.parent_turn_id) : undefined,
      title: String(row.title),
      status: row.status as AgentTaskRecord["status"],
      finalOutput: row.final_output ? String(row.final_output) : undefined,
      childThreadId: row.child_thread_id ? String(row.child_thread_id) : undefined,
      lastTurnId: row.last_turn_id ? String(row.last_turn_id) : undefined,
      worktreeId: row.worktree_id ? String(row.worktree_id) : undefined,
      environmentId: row.environment_id ? String(row.environment_id) : undefined,
      executionContextId: row.execution_context_id ? String(row.execution_context_id) : undefined,
      summary: row.summary_json ? (JSON.parse(String(row.summary_json)) as AgentTaskRecord["summary"]) : undefined,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }

  private mapWorktree(row: Record<string, unknown>): WorktreeRecord {
    return {
      id: String(row.id),
      projectId: String(row.project_id),
      threadId: row.thread_id ? String(row.thread_id) : undefined,
      agentId: row.agent_id ? String(row.agent_id) : undefined,
      branch: String(row.branch),
      path: String(row.path),
      status: row.status as WorktreeRecord["status"],
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }

  private mapEnvironment(row: Record<string, unknown>): EnvironmentRecord {
    return {
      id: String(row.id),
      projectId: String(row.project_id),
      threadId: row.thread_id ? String(row.thread_id) : undefined,
      worktreeId: row.worktree_id ? String(row.worktree_id) : undefined,
      cwd: String(row.cwd),
      shell: String(row.shell),
      envJson: JSON.parse(String(row.env_json)) as Record<string, string>,
      detectedTools: JSON.parse(String(row.detected_tools_json)) as string[],
      pythonVenvPath: row.python_venv_path ? String(row.python_venv_path) : undefined,
      nodeVersion: row.node_version ? String(row.node_version) : undefined,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }

  private mapExecutionContext(row: Record<string, unknown>): ExecutionContextRecord {
    return {
      id: String(row.id),
      projectId: String(row.project_id),
      kind: row.kind as ExecutionContextRecord["kind"],
      threadId: row.thread_id ? String(row.thread_id) : undefined,
      agentId: row.agent_id ? String(row.agent_id) : undefined,
      worktreeId: row.worktree_id ? String(row.worktree_id) : undefined,
      environmentId: row.environment_id ? String(row.environment_id) : undefined,
      cwd: String(row.cwd),
      shell: String(row.shell),
      envJson: JSON.parse(String(row.env_json)) as Record<string, string>,
      detectedTools: JSON.parse(String(row.detected_tools_json)) as string[],
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }

  private mapWorkflow(row: Record<string, unknown>): WorkflowRecord {
    return {
      id: String(row.id),
      name: String(row.name),
      description: String(row.description),
      path: String(row.path),
      source: row.source as WorkflowRecord["source"],
      steps: JSON.parse(String(row.steps_json)) as WorkflowRecord["steps"],
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }

  private mapWorkflowRun(row: Record<string, unknown>): WorkflowRunRecord {
    return {
      id: String(row.id),
      workflowId: String(row.workflow_id),
      projectId: String(row.project_id),
      threadId: row.thread_id ? String(row.thread_id) : undefined,
      status: row.status as WorkflowRunRecord["status"],
      pendingStepIds: JSON.parse(String(row.pending_step_ids_json)) as string[],
      pausedStepIds: JSON.parse(String(row.paused_step_ids_json)) as string[],
      completedStepIds: JSON.parse(String(row.completed_step_ids_json)) as string[],
      failedStepIds: JSON.parse(String(row.failed_step_ids_json)) as string[],
      steps: JSON.parse(String(row.steps_json)) as WorkflowRunRecord["steps"],
      pauseReason: row.pause_reason ? String(row.pause_reason) : undefined,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }

  private mapPlugin(row: Record<string, unknown>): PluginRecord {
    return {
      id: String(row.id),
      name: String(row.name),
      version: String(row.version),
      path: String(row.path),
      source: row.source as PluginRecord["source"],
      enabled: Number(row.enabled) === 1,
      capabilities: JSON.parse(String(row.capabilities_json)) as string[],
      sandboxMode: row.sandbox_mode ? (String(row.sandbox_mode) as PluginRecord["sandboxMode"]) : undefined,
      command: row.command ? String(row.command) : undefined,
      args: row.args_json ? (JSON.parse(String(row.args_json)) as string[]) : undefined,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }

  private mapMcpMount(row: Record<string, unknown>): McpMountRecord {
    return {
      id: String(row.id),
      name: String(row.name),
      transport: row.transport as McpMountRecord["transport"],
      command: row.command ? String(row.command) : undefined,
      args: row.args_json ? (JSON.parse(String(row.args_json)) as string[]) : undefined,
      url: row.url ? String(row.url) : undefined,
      enabled: Number(row.enabled) === 1,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }

  private mapMcpSession(row: Record<string, unknown>): McpSessionRecord {
    return {
      id: String(row.id),
      mountId: String(row.mount_id),
      status: row.status as McpSessionRecord["status"],
      transport: row.transport as McpSessionRecord["transport"],
      lastConnectedAt: row.last_connected_at ? String(row.last_connected_at) : undefined,
      updatedAt: String(row.updated_at),
    };
  }

  private migrate(): void {
    if (!this.columnExists("threads", "project_id")) {
      this.db.exec("ALTER TABLE threads ADD COLUMN project_id TEXT");
    }

    if (!this.columnExists("threads", "sandbox_mode")) {
      this.db.exec("ALTER TABLE threads ADD COLUMN sandbox_mode TEXT");
    }

    if (!this.columnExists("threads", "hidden")) {
      this.db.exec("ALTER TABLE threads ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0");
    }

    if (!this.columnExists("agent_tasks", "worktree_id")) {
      this.db.exec("ALTER TABLE agent_tasks ADD COLUMN worktree_id TEXT");
    }

    if (!this.columnExists("agent_tasks", "environment_id")) {
      this.db.exec("ALTER TABLE agent_tasks ADD COLUMN environment_id TEXT");
    }

    if (!this.columnExists("agent_tasks", "child_thread_id")) {
      this.db.exec("ALTER TABLE agent_tasks ADD COLUMN child_thread_id TEXT");
    }

    if (!this.columnExists("agent_tasks", "last_turn_id")) {
      this.db.exec("ALTER TABLE agent_tasks ADD COLUMN last_turn_id TEXT");
    }

    if (!this.columnExists("agent_tasks", "execution_context_id")) {
      this.db.exec("ALTER TABLE agent_tasks ADD COLUMN execution_context_id TEXT");
    }

    if (!this.columnExists("agent_tasks", "summary_json")) {
      this.db.exec("ALTER TABLE agent_tasks ADD COLUMN summary_json TEXT");
    }

    if (!this.columnExists("plugins", "sandbox_mode")) {
      this.db.exec("ALTER TABLE plugins ADD COLUMN sandbox_mode TEXT");
    }

    if (!this.columnExists("plugins", "command")) {
      this.db.exec("ALTER TABLE plugins ADD COLUMN command TEXT");
    }

    if (!this.columnExists("plugins", "args_json")) {
      this.db.exec("ALTER TABLE plugins ADD COLUMN args_json TEXT");
    }

    if (!this.tableExists("workflow_runs")) {
      this.db.exec(`
        CREATE TABLE workflow_runs (
          id TEXT PRIMARY KEY,
          workflow_id TEXT NOT NULL,
          project_id TEXT NOT NULL,
          thread_id TEXT,
          status TEXT NOT NULL,
          pending_step_ids_json TEXT NOT NULL,
          paused_step_ids_json TEXT NOT NULL,
          completed_step_ids_json TEXT NOT NULL,
          failed_step_ids_json TEXT NOT NULL,
          steps_json TEXT NOT NULL,
          pause_reason TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        )
      `);
    }

    if (!this.columnExists("workflow_runs", "paused_step_ids_json")) {
      this.db.exec("ALTER TABLE workflow_runs ADD COLUMN paused_step_ids_json TEXT NOT NULL DEFAULT '[]'");
    }

    if (!this.columnExists("workflow_runs", "pause_reason")) {
      this.db.exec("ALTER TABLE workflow_runs ADD COLUMN pause_reason TEXT");
    }

    if (!this.tableExists("mcp_sessions")) {
      this.db.exec(`
        CREATE TABLE mcp_sessions (
          id TEXT PRIMARY KEY,
          mount_id TEXT NOT NULL,
          status TEXT NOT NULL,
          transport TEXT NOT NULL,
          last_connected_at TEXT,
          updated_at TEXT NOT NULL
        )
      `);
    }

    if (!this.tableExists("mcp_mount_cache")) {
      this.db.exec(`
        CREATE TABLE mcp_mount_cache (
          mount_id TEXT PRIMARY KEY,
          tools_json TEXT NOT NULL,
          prompts_json TEXT NOT NULL,
          resources_json TEXT NOT NULL,
          updated_at TEXT NOT NULL
        )
      `);
    }

    if (!this.tableExists("execution_contexts")) {
      this.db.exec(`
        CREATE TABLE execution_contexts (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL,
          kind TEXT NOT NULL,
          thread_id TEXT,
          agent_id TEXT,
          worktree_id TEXT,
          environment_id TEXT,
          cwd TEXT NOT NULL,
          shell TEXT NOT NULL,
          env_json TEXT NOT NULL,
          detected_tools_json TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        )
      `);
    }

    if (!this.columnExists("terminal_sessions", "backend")) {
      this.db.exec("ALTER TABLE terminal_sessions ADD COLUMN backend TEXT NOT NULL DEFAULT 'pipe'");
    }

    if (!this.columnExists("terminal_sessions", "cols")) {
      this.db.exec("ALTER TABLE terminal_sessions ADD COLUMN cols INTEGER");
    }

    if (!this.columnExists("terminal_sessions", "rows")) {
      this.db.exec("ALTER TABLE terminal_sessions ADD COLUMN rows INTEGER");
    }

    if (!this.columnExists("terminal_sessions", "pid")) {
      this.db.exec("ALTER TABLE terminal_sessions ADD COLUMN pid INTEGER");
    }

    if (!this.columnExists("terminal_sessions", "exit_code")) {
      this.db.exec("ALTER TABLE terminal_sessions ADD COLUMN exit_code INTEGER");
    }

    if (!this.columnExists("terminal_sessions", "failure_reason")) {
      this.db.exec("ALTER TABLE terminal_sessions ADD COLUMN failure_reason TEXT");
    }

    if (!this.columnExists("terminal_sessions", "started_at")) {
      this.db.exec("ALTER TABLE terminal_sessions ADD COLUMN started_at TEXT");
    }

    if (!this.columnExists("terminal_sessions", "last_active_at")) {
      this.db.exec("ALTER TABLE terminal_sessions ADD COLUMN last_active_at TEXT");
    }

    if (!this.columnExists("terminal_sessions", "closed_at")) {
      this.db.exec("ALTER TABLE terminal_sessions ADD COLUMN closed_at TEXT");
    }

    if (!this.tableExists("reviews")) {
      this.db.exec(`
        CREATE TABLE reviews (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL,
          thread_id TEXT,
          execution_context_id TEXT,
          status TEXT NOT NULL,
          source_json TEXT NOT NULL,
          instructions TEXT,
          summary TEXT,
          findings_json TEXT NOT NULL,
          error TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          completed_at TEXT
        )
      `);
    }

    const config = this.getConfig();
    let projects = this.listProjects();

    if (projects.length === 0) {
      const now = new Date().toISOString();
      this.createProject({
        id: config.selectedProjectId ?? config.workspace.id,
        name: config.workspace.name,
        rootPath: config.workspace.rootPath,
        shell: config.workspace.shell,
        sandboxMode: config.workspace.sandboxMode,
        approvalPolicy: config.workspace.approvalPolicy,
        createdAt: now,
        updatedAt: now,
      });
      projects = this.listProjects();
    }

    const fallbackProject = projects[0]!;
    this.db
      .prepare("UPDATE threads SET project_id = COALESCE(project_id, workspace_id, ?) WHERE project_id IS NULL OR project_id = ''")
      .run(fallbackProject.id);

    this.db
      .prepare(
        `
          UPDATE threads
          SET sandbox_mode = COALESCE(
            sandbox_mode,
            (SELECT sandbox_mode FROM projects WHERE projects.id = threads.project_id),
            ?
          )
          WHERE sandbox_mode IS NULL OR sandbox_mode = ''
        `,
      )
      .run(config.workspace.sandboxMode);

    const selectedProjectId =
      config.selectedProjectId && this.getProject(config.selectedProjectId) ? config.selectedProjectId : fallbackProject.id;

    if (selectedProjectId !== config.selectedProjectId) {
      this.writeConfig({
        ...config,
        selectedProjectId,
      });
    }
  }

  private columnExists(tableName: string, columnName: string): boolean {
    const rows = this.db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
    return rows.some((row) => row.name === columnName);
  }

  private tableExists(tableName: string): boolean {
    const row = this.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(tableName) as { name?: string } | undefined;
    return Boolean(row?.name);
  }

  private normalizeThread(thread: ThreadWriteRecord): ThreadRecord {
    const project = this.getProject(thread.projectId);
    const fallbackSandboxMode = project?.sandboxMode ?? this.getConfig().workspace.sandboxMode;

    return {
      ...thread,
      sandboxMode: thread.sandboxMode ?? fallbackSandboxMode,
      hidden: thread.hidden ?? false,
      archivedAt: thread.archivedAt ?? null,
    };
  }
}

export function getDefaultDatabasePath(homeDir: string): string {
  return join(homeDir, "state", "app.db");
}
