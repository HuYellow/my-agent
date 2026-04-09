import {
  type RequirementManualMemoryRecord,
  type RequirementMemoryRecord,
  type RequirementRecord,
  type RequirementStatus,
  type ThreadRecord,
} from "@my-agent/protocol";
import { HarnessDatabase } from "../store/database.js";
import { createId } from "../utils/ids.js";
import { RequirementMemoryManager } from "./requirement-memory-manager.js";

export class RequirementService {
  constructor(
    private readonly database: HarnessDatabase,
    private readonly memoryManager: RequirementMemoryManager,
    private readonly emitRequirement: (requirement: RequirementRecord) => void,
  ) {}

  list(projectId?: string): RequirementRecord[] {
    return this.database.listRequirements(projectId);
  }

  listMemories(): RequirementMemoryRecord[] {
    return this.memoryManager.list();
  }

  get(requirementId: string): RequirementRecord | null {
    return this.database.getRequirement(requirementId);
  }

  getWithMemory(requirementId: string): { requirement: RequirementRecord; memory: RequirementMemoryRecord } {
    const requirement = this.requireRequirement(requirementId);
    return {
      requirement,
      memory: this.memoryManager.get(requirementId),
    };
  }

  create(params: {
    title: string;
    primaryProjectId: string;
    relatedProjectIds?: string[];
    status?: RequirementStatus;
    memory?: Partial<RequirementManualMemoryRecord>;
  }): { requirement: RequirementRecord; memory: RequirementMemoryRecord } {
    this.requireProject(params.primaryProjectId);
    const now = new Date().toISOString();
    const requirement: RequirementRecord = {
      id: createId("requirement"),
      title: params.title.trim() || "New Requirement",
      status: params.status ?? "active",
      primaryProjectId: params.primaryProjectId,
      relatedProjectIds: normalizeRelatedProjectIds(params.primaryProjectId, params.relatedProjectIds),
      createdAt: now,
      updatedAt: now,
      archivedAt: null,
    };

    this.database.createRequirement(requirement);
    this.emitRequirement(requirement);
    if (params.memory) {
      this.memoryManager.updateManualMemory(requirement.id, params.memory);
    }
    const memory = this.memoryManager.rebuild(requirement.id);
    return { requirement, memory };
  }

  update(params: {
    requirementId: string;
    patch: Partial<Pick<RequirementRecord, "title" | "status" | "primaryProjectId" | "relatedProjectIds" | "archivedAt">> & {
      memory?: Partial<RequirementManualMemoryRecord>;
    };
  }): { requirement: RequirementRecord; memory: RequirementMemoryRecord } {
    const current = this.requireRequirement(params.requirementId);
    const nextPrimaryProjectId = params.patch.primaryProjectId ?? current.primaryProjectId;
    this.requireProject(nextPrimaryProjectId);
    const updated: RequirementRecord = {
      ...current,
      ...params.patch,
      primaryProjectId: nextPrimaryProjectId,
      title: params.patch.title?.trim() || current.title,
      relatedProjectIds: normalizeRelatedProjectIds(nextPrimaryProjectId, params.patch.relatedProjectIds ?? current.relatedProjectIds),
      updatedAt: new Date().toISOString(),
      archivedAt: params.patch.archivedAt ?? current.archivedAt ?? null,
    };

    this.database.updateRequirement(updated);
    this.emitRequirement(updated);

    if (params.patch.memory) {
      this.memoryManager.updateManualMemory(updated.id, params.patch.memory);
    }

    const memory = this.memoryManager.rebuild(updated.id);
    return { requirement: updated, memory };
  }

  assignThread(requirementId: string, threadId: string): { requirement: RequirementRecord; memory: RequirementMemoryRecord; thread: ThreadRecord } {
    const requirement = this.requireRequirement(requirementId);
    const thread = this.requireThread(threadId);
    const now = new Date().toISOString();
    let nextRequirement = requirement;

    if (thread.projectId !== requirement.primaryProjectId && !requirement.relatedProjectIds.includes(thread.projectId)) {
      nextRequirement = this.database.updateRequirement({
        ...requirement,
        relatedProjectIds: normalizeRelatedProjectIds(requirement.primaryProjectId, [...requirement.relatedProjectIds, thread.projectId]),
        updatedAt: now,
      });
      this.emitRequirement(nextRequirement);
    }

    const updatedThread = this.database.updateThread({
      ...thread,
      requirementId,
      updatedAt: now,
    });
    const memory = this.memoryManager.rebuild(nextRequirement.id);
    return {
      requirement: nextRequirement,
      memory,
      thread: updatedThread,
    };
  }

  unassignThread(threadId: string): ThreadRecord {
    const thread = this.requireThread(threadId);
    const updated = this.database.updateThread({
      ...thread,
      requirementId: undefined,
      updatedAt: new Date().toISOString(),
    });

    if (thread.requirementId) {
      this.memoryManager.rebuild(thread.requirementId);
    }

    return updated;
  }

  rebuildMemory(requirementId: string): RequirementMemoryRecord {
    return this.memoryManager.rebuild(requirementId);
  }

  buildPromptContextSection(requirementId?: string): string | undefined {
    return this.memoryManager.buildPromptContextSection(requirementId);
  }

  private requireRequirement(requirementId: string): RequirementRecord {
    const requirement = this.database.getRequirement(requirementId);

    if (!requirement) {
      throw new Error(`Requirement not found: ${requirementId}`);
    }

    return requirement;
  }

  private requireThread(threadId: string): ThreadRecord {
    const thread = this.database.getThread(threadId);

    if (!thread) {
      throw new Error(`Thread not found: ${threadId}`);
    }

    return thread;
  }

  private requireProject(projectId: string): void {
    if (!this.database.getProject(projectId)) {
      throw new Error(`Project not found: ${projectId}`);
    }
  }
}

function normalizeRelatedProjectIds(primaryProjectId: string, relatedProjectIds?: string[]): string[] {
  return [...new Set((relatedProjectIds ?? []).filter((projectId) => Boolean(projectId) && projectId !== primaryProjectId))];
}
