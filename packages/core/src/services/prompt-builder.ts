import { type SkillDescriptor, type WorkspaceProfile } from "@my-agent/protocol";
import { readFileSync } from "node:fs";
import { findAgentDocuments } from "../utils/path-utils.js";
import { SkillService } from "./skill-service.js";

interface BuildPromptInput {
  cwd: string;
  workspace: WorkspaceProfile;
  globalInstructions: string;
  userInput: string;
  selectedSkills: SkillDescriptor[];
  discoveredSkills: SkillDescriptor[];
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

  const blocks = docs.map((path) => `## ${path}\n${readFileSync(path, "utf8")}`);
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
  const blocks = skills.map((skill) => `## ${skill.name}\nPath: ${skill.path}\n\n${skillService.getSkillBody(skill.path)}`);
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
