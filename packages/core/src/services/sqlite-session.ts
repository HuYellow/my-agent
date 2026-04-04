import { type AgentInputItem, type Session } from "@openai/agents";
import { HarnessDatabase } from "../store/database.js";

export class SqliteSession implements Session {
  constructor(
    private readonly database: HarnessDatabase,
    private readonly sessionId: string,
  ) {}

  async getSessionId(): Promise<string> {
    return this.sessionId;
  }

  async getItems(limit?: number): Promise<AgentInputItem[]> {
    return this.database.listSessionItems(this.sessionId, limit);
  }

  async addItems(items: AgentInputItem[]): Promise<void> {
    if (items.length === 0) {
      return;
    }

    this.database.appendSessionItems(this.sessionId, items);
  }

  async popItem(): Promise<AgentInputItem | undefined> {
    return this.database.popSessionItem(this.sessionId);
  }

  async clearSession(): Promise<void> {
    this.database.clearSession(this.sessionId);
  }
}
