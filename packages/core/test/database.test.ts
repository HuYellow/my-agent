import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { HarnessDatabase } from "../src/store/database.js";

describe("HarnessDatabase projects", () => {
  it("seeds a default project and stores threads by projectId", () => {
    const root = mkdtempSync(join(tmpdir(), "my-agent-db-"));
    const database = new HarnessDatabase(join(root, "app.db"));
    const projects = database.listProjects();

    expect(projects.length).toBeGreaterThan(0);
    expect(database.getConfig().selectedProjectId).toBe(projects[0]?.id);

    const thread = database.createThread({
      id: "thread-1",
      title: "Project thread",
      projectId: projects[0]!.id,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      archivedAt: null,
    });

    expect(database.getThread(thread.id)).toMatchObject({
      id: "thread-1",
      projectId: projects[0]!.id,
    });
  });
});
