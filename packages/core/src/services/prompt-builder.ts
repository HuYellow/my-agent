import {
  type McpMountRecord,
  type McpPromptRecord,
  type McpResourceRecord,
  type SkillDescriptor,
  type TurnInputAttachment,
  type WorkspaceProfile,
} from "@my-agent/protocol";
import { readFileSync } from "node:fs";
import { findAgentDocuments } from "../utils/path-utils.js";
import { SkillService } from "./skill-service.js";

interface BuildPromptInput {
  cwd: string;
  workspace: WorkspaceProfile;
  globalInstructions: string;
  userInput: string;
  attachments: TurnInputAttachment[];
  selectedSkills: SkillDescriptor[];
  discoveredSkills: SkillDescriptor[];
  mcpContext?: Array<{
    mount: McpMountRecord;
    prompts: McpPromptRecord[];
    resources: McpResourceRecord[];
    resolvedPrompts?: Array<{ name: string; content: string }>;
    resolvedResources?: Array<{ uri: string; content: string }>;
  }>;
  requirementContext?: string;
  ideContext?: {
    projectName: string;
    workspaceRoot: string;
    threadTitle: string;
    model: string;
    reasoningEffort: string;
    enabledSkills: string[];
  };
}

export interface BuiltPrompt {
  systemPrompt: string;
  userMessage: string;
}

export class PromptBuilder {
  constructor(private readonly skillService: SkillService) {}

  build(input: BuildPromptInput): BuiltPrompt {
    const sections: string[] = [
      renderPermissions(input.workspace),
      renderRunCompletionRules(),
      `# User Global Instructions\n${input.globalInstructions}`,
      renderProjectDocuments(input.cwd),
      renderSkillMetadata(input.discoveredSkills),
      renderEnvironmentContext(input.cwd, input.workspace.shell),
    ];

    if (input.requirementContext) {
      sections.push(input.requirementContext);
    }

    if (input.ideContext) {
      sections.push(renderIdeContext(input.ideContext));
    }

    if (input.attachments.length > 0) {
      sections.push(renderAttachmentContext(input.attachments));
    }

    if (input.mcpContext && input.mcpContext.length > 0) {
      sections.push(renderMcpContext(input.mcpContext));
    }

    if (input.selectedSkills.length > 0) {
      sections.push(renderActivatedSkills(input.selectedSkills, this.skillService));
    }

    return {
      systemPrompt: sections.filter(Boolean).join("\n\n"),
      userMessage: this.skillService.stripExplicitSkills(input.userInput),
    };
  }
}

function renderPermissions(workspace: WorkspaceProfile): string {
  return [
    "# Permissions Instructions",
    `Sandbox mode: ${workspace.sandboxMode}`,
    `Approval policy: ${workspace.approvalPolicy}`,
    `Workspace root: ${workspace.rootPath}`,
    "High-risk operations must respect approval rules and stay inside the selected workspace unless the policy explicitly allows otherwise.",
  ].join("\n");
}

function renderRunCompletionRules(): string {
  return [
    "# Run Completion Rules",
    "Work in short, convergent loops.",
    "If you already have enough information to answer, stop and answer instead of calling another tool.",
    "Do not repeat the same tool call with materially identical arguments unless something in the workspace changed.",
    "If a tool fails or returns no new information, change strategy instead of retrying blindly.",
    "When information is missing, explain the gap and propose the next best step instead of looping.",
    "Prefer a partial but useful result over exhausting the run budget.",
  ].join("\n");
}

function renderProjectDocuments(cwd: string): string {
  const docs = findAgentDocuments(cwd);

  if (docs.length === 0) {
    return "# Project Instructions\nNo AGENTS.md file discovered in the current path ancestry.";
  }

  const blocks = docs.map((path) => `## ${path}\n${truncatePromptSection(readFileSync(path, "utf8"), 4_000)}`);
  return `# Project Instructions\n${blocks.join("\n\n")}`;
}

function renderSkillMetadata(skills: SkillDescriptor[]): string {
  if (skills.length === 0) {
    return "# Skills Metadata\nNo skills are currently available.";
  }

  const lines = skills.map(
    (skill) =>
      `- ${skill.name} [${skill.scope}]${skill.enabled ? "" : " (disabled)"}: ${skill.description}${skill.metadata.allowImplicitInvocation ? " [implicit-ok]" : ""}`,
  );

  return `# Skills Metadata\n${lines.join("\n")}`;
}

function renderActivatedSkills(skills: SkillDescriptor[], skillService: SkillService): string {
  const blocks = skills.map((skill) => `## ${skill.name}\nPath: ${skill.path}\n\n${truncatePromptSection(skillService.getSkillBody(skill.path), 6_000)}`);
  return `# Activated Skills\n${blocks.join("\n\n")}`;
}

function renderEnvironmentContext(cwd: string, shell: string): string {
  return [
    "# Environment Context",
    `cwd: ${cwd}`,
    `platform: ${process.platform}`,
    `date: ${new Date().toISOString()}`,
    `shell: ${shell}`,
  ].join("\n");
}

function renderIdeContext(input: NonNullable<BuildPromptInput["ideContext"]>): string {
  return [
    "# IDE Context",
    "This context is provided implicitly by the app. Use it as background context and do not quote or restate it unless it is relevant to the answer.",
    `Project: ${input.projectName}`,
    `Workspace root: ${input.workspaceRoot}`,
    `Thread: ${input.threadTitle}`,
    `Model: ${input.model}`,
    `Reasoning effort: ${input.reasoningEffort}`,
    `Enabled skills: ${input.enabledSkills.length > 0 ? input.enabledSkills.join(", ") : "None"}`,
  ].join("\n");
}

function renderAttachmentContext(attachments: TurnInputAttachment[]): string {
  const blocks = attachments.map((attachment) => {
    const lines = [
      `## ${attachment.name}`,
      `Kind: ${attachment.kind}`,
      attachment.path ? `Path: ${attachment.path}` : undefined,
      attachment.mediaType ? `Media type: ${attachment.mediaType}` : undefined,
      attachment.sizeBytes ? `Size: ${attachment.sizeBytes} bytes` : undefined,
      attachment.kind === "image" ? "Image data is attached separately as multimodal input." : undefined,
      attachment.truncated ? "Note: inline attachment content was truncated before being passed to the model." : undefined,
    ].filter(Boolean) as string[];

    if (attachment.kind !== "image" && attachment.textContent) {
      lines.push("", attachment.textContent);
    }

    return lines.join("\n");
  });

  return [
    "# Attachment Context",
    "These attachments are provided implicitly by the app. Treat them as supporting context rather than user-authored message text.",
    ...blocks,
  ].join("\n\n");
}

function renderMcpContext(
  mounts: Array<{
    mount: McpMountRecord;
    prompts: McpPromptRecord[];
    resources: McpResourceRecord[];
    resolvedPrompts?: Array<{ name: string; content: string }>;
    resolvedResources?: Array<{ uri: string; content: string }>;
  }>,
): string {
  const blocks = mounts.map(({ mount, prompts, resources, resolvedPrompts, resolvedResources }) => {
    const lines = [
      `## ${mount.name}`,
      `Transport: ${mount.transport}`,
      mount.url ? `URL: ${mount.url}` : undefined,
      mount.command ? `Command: ${mount.command}` : undefined,
      prompts.length > 0 ? `Prompts: ${prompts.map((prompt) => prompt.name).join(", ")}` : "Prompts: none",
      resources.length > 0 ? `Resources: ${resources.map((resource) => resource.uri).join(", ")}` : "Resources: none",
    ].filter(Boolean) as string[];

    if (prompts.length > 0) {
      lines.push("", ...prompts.map((prompt) => `Prompt ${prompt.name}: ${prompt.description ?? "No description"}`));
    }

    if ((resolvedPrompts?.length ?? 0) > 0) {
      lines.push("", ...resolvedPrompts!.map((prompt) => `Resolved prompt ${prompt.name}:\n${truncatePromptSection(prompt.content, 2_000)}`));
    }

    if (resources.length > 0) {
      lines.push("", ...resources.map((resource) => `Resource ${resource.uri}: ${resource.description ?? resource.name ?? "No description"}`));
    }

    if ((resolvedResources?.length ?? 0) > 0) {
      lines.push("", ...resolvedResources!.map((resource) => `Resolved resource ${resource.uri}:\n${truncatePromptSection(resource.content, 2_000)}`));
    }

    return lines.join("\n");
  });

  return [
    "# MCP Context",
    "The following MCP mounts are available. Use them when they materially improve the answer.",
    ...blocks,
  ].join("\n\n");
}

function truncatePromptSection(value: string, limit: number): string {
  if (value.length <= limit) {
    return value;
  }

  return `${value.slice(0, limit)}\n\n[truncated ${value.length - limit} chars]`;
}
