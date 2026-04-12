import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { ProjectRecord } from "@my-agent/protocol";
import { RequirementMemoryManager } from "../src/services/requirement-memory-manager.js";
import { RequirementService } from "../src/services/requirement-service.js";
import { HarnessDatabase } from "../src/store/database.js";

describe("RequirementService", () => {
  it("creates and updates requirements with normalized related projects and manual memory", () => {
    const root = mkdtempSync(join(tmpdir(), "my-agent-requirement-service-"));
    const database = new HarnessDatabase(join(root, "app.db"));
    const primaryProject = createProject(database, "project-primary", root);
    const relatedProject = createProject(database, "project-related", join(root, "related"));
    const emitRequirement = vi.fn();
    const service = new RequirementService(database, new RequirementMemoryManager(database, () => undefined), emitRequirement);

    const created = service.create({
      title: "  Ship structured memory  ",
      primaryProjectId: primaryProject.id,
      relatedProjectIds: [primaryProject.id, relatedProject.id, relatedProject.id],
      memory: {
        brief: "  Keep project state coherent. ",
        goals: ["Ship tests", "Ship tests"],
      },
    });

    expect(created.requirement.title).toBe("Ship structured memory");
    expect(created.requirement.relatedProjectIds).toEqual([relatedProject.id]);
    expect(created.memory.manual.brief).toBe("Keep project state coherent.");
    expect(created.memory.manual.goals).toEqual(["Ship tests"]);

    const updated = service.update({
      requirementId: created.requirement.id,
      patch: {
        title: "  Refine memory model  ",
        primaryProjectId: relatedProject.id,
        relatedProjectIds: [primaryProject.id, relatedProject.id],
        memory: {
          decisions: ["Keep sqlite state", "Keep sqlite state"],
        },
      },
    });

    expect(updated.requirement.title).toBe("Refine memory model");
    expect(updated.requirement.primaryProjectId).toBe(relatedProject.id);
    expect(updated.requirement.relatedProjectIds).toEqual([primaryProject.id]);
    expect(updated.memory.manual.decisions).toEqual(["Keep sqlite state"]);
    expect(emitRequirement).toHaveBeenCalledTimes(2);
  });

  it("assigns threads across projects and rebuilds memory when unassigning", () => {
    const root = mkdtempSync(join(tmpdir(), "my-agent-requirement-service-"));
    const database = new HarnessDatabase(join(root, "app.db"));
    const primaryProject = createProject(database, "project-primary", root);
    const relatedProject = createProject(database, "project-related", join(root, "related"));
    const memoryManager = new RequirementMemoryManager(database, () => undefined);
    const emitRequirement = vi.fn();
    const service = new RequirementService(database, memoryManager, emitRequirement);
    const requirement = service.create({
      title: "Cross-project requirement",
      primaryProjectId: primaryProject.id,
    }).requirement;
    const now = new Date().toISOString();

    database.createThread({
      id: "thread-1",
      title: "Related project thread",
      projectId: relatedProject.id,
      hidden: false,
      createdAt: now,
      updatedAt: now,
      archivedAt: null,
    });

    const assigned = service.assignThread(requirement.id, "thread-1");

    expect(assigned.requirement.relatedProjectIds).toEqual([relatedProject.id]);
    expect(assigned.thread.requirementId).toBe(requirement.id);
    expect(emitRequirement).toHaveBeenCalledWith(
      expect.objectContaining({
        id: requirement.id,
        relatedProjectIds: [relatedProject.id],
      }),
    );

    const unassignedThread = service.unassignThread("thread-1");
    const rebuiltMemory = memoryManager.get(requirement.id);

    expect(unassignedThread.requirementId).toBeUndefined();
    expect(rebuiltMemory.derived.linkedThreads).toEqual([]);
  });
});

function createProject(database: HarnessDatabase, id: string, rootPath: string): ProjectRecord {
  const now = new Date().toISOString();
  return database.createProject({
    id,
    name: id,
    rootPath,
    shell: process.platform === "win32" ? "powershell" : "bash",
    sandboxMode: "workspace-write",
    approvalPolicy: "on-request",
    createdAt: now,
    updatedAt: now,
  });
}
