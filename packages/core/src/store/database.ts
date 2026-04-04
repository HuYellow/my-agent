import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { type AgentInputItem } from "@openai/agents";
import {
  type AppConfig,
  type ItemRecord,
  type PendingApproval,
  type ProjectRecord,
  type ThreadRecord,
  type TurnRecord,
  type WorkspaceProfile,
} from "@my-agent/protocol";

const DEFAULT_PROVIDER = {
  id: "default-provider",
  name: "Default Provider",
  baseUrl: "",
  apiKey: "",
  model: "",
  apiFlavor: "chat_completions" as const,
};

const DEFAULT_WORKSPACE: WorkspaceProfile = {
  id: "default-workspace",
  name: "Current Workspace",
  rootPath: process.cwd(),
  shell: process.platform === "win32" ? "powershell" : "bash",
  sandboxMode: "workspace-write",
  approvalPolicy: "on-request",
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
    `);
    this.migrate();
  }

  getDefaultConfig(): AppConfig {
    return {
      globalInstructions: "You are a local coding agent. Be accurate, cautious with changes, and explicit about approvals.",
      provider: DEFAULT_PROVIDER,
      workspace: DEFAULT_WORKSPACE,
      disabledSkillIds: [],
    };
  }

  getConfig(): AppConfig {
    const row = this.db.prepare("SELECT value FROM config WHERE key = ?").get("app_config") as { value?: string } | undefined;

    if (!row?.value) {
      const defaults = this.getDefaultConfig();
      this.writeConfig(defaults);
      return defaults;
    }

    const parsed = JSON.parse(row.value) as AppConfig;
    return {
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
    };
  }

  writeConfig(config: AppConfig): AppConfig {
    this.db
      .prepare("INSERT INTO config(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .run("app_config", JSON.stringify(config));
    return config;
  }

  listThreads(): ThreadRecord[] {
    return this.db
      .prepare("SELECT * FROM threads ORDER BY updated_at DESC")
      .all()
      .map((row) => this.mapThread(row as Record<string, unknown>));
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

  createThread(thread: ThreadRecord): ThreadRecord {
    if (this.columnExists("threads", "project_id")) {
      this.db
        .prepare("INSERT INTO threads(id, title, workspace_id, project_id, created_at, updated_at, archived_at) VALUES(?, ?, ?, ?, ?, ?, ?)")
        .run(thread.id, thread.title, thread.projectId, thread.projectId, thread.createdAt, thread.updatedAt, thread.archivedAt ?? null);
      return thread;
    }

    this.db
      .prepare("INSERT INTO threads(id, title, workspace_id, created_at, updated_at, archived_at) VALUES(?, ?, ?, ?, ?, ?)")
      .run(thread.id, thread.title, thread.projectId, thread.createdAt, thread.updatedAt, thread.archivedAt ?? null);
    return thread;
  }

  updateThread(thread: ThreadRecord): ThreadRecord {
    if (this.columnExists("threads", "project_id")) {
      this.db
        .prepare("UPDATE threads SET title = ?, workspace_id = ?, project_id = ?, updated_at = ?, archived_at = ? WHERE id = ?")
        .run(thread.title, thread.projectId, thread.projectId, thread.updatedAt, thread.archivedAt ?? null, thread.id);
      return thread;
    }

    this.db
      .prepare("UPDATE threads SET title = ?, workspace_id = ?, updated_at = ?, archived_at = ? WHERE id = ?")
      .run(thread.title, thread.projectId, thread.updatedAt, thread.archivedAt ?? null, thread.id);
    return thread;
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

  private mapThread(row: Record<string, unknown>): ThreadRecord {
    return {
      id: String(row.id),
      title: String(row.title),
      projectId: String(row.project_id ?? row.workspace_id),
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

  private migrate(): void {
    if (!this.columnExists("threads", "project_id")) {
      this.db.exec("ALTER TABLE threads ADD COLUMN project_id TEXT");
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
}

export function getDefaultDatabasePath(homeDir: string): string {
  return join(homeDir, "state", "app.db");
}
