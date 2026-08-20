import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PromptBuilder } from "../src/services/prompt-builder.js";
import { SkillService } from "../src/services/skill-service.js";

describe("PromptBuilder", () => {
  it("includes AGENTS and activated skill bodies", () => {
    const root = mkdtempSync(join(tmpdir(), "yellow-flow-prompt-"));
    const systemRoot = join(root, "system");
    const homeRoot = join(root, "home");
    const workspace = join(root, "workspace");
    const skillRoot = join(systemRoot, "repo-qa");

    mkdirSync(join(skillRoot, "agents"), { recursive: true });
    mkdirSync(workspace, { recursive: true });
    writeFileSync(join(workspace, "AGENTS.md"), "Project rule: be careful.", "utf8");
    writeFileSync(
      join(skillRoot, "SKILL.md"),
      `---\nname: repo-qa\ndescription: Explain repo layout.\n---\n\n# Repo QA\nDetailed workflow.\n`,
      "utf8",
    );

    const service = new SkillService(systemRoot, homeRoot, () => undefined);
    const builder = new PromptBuilder(service);
    const discoveredSkills = service.listSkills(workspace, []);
    const built = builder.build({
      cwd: workspace,
      workspace: {
        id: "workspace",
        name: "Workspace",
        rootPath: workspace,
        shell: "powershell",
        sandboxMode: "workspace-write",
        approvalPolicy: "on-request",
      },
      globalInstructions: "Always explain tradeoffs.",
      userInput: "$repo-qa explain the app",
      attachments: [],
      selectedSkills: discoveredSkills,
      discoveredSkills,
      requirementContext: "# Requirement Context\nRequirement: Build repo QA flow",
    });

    expect(built.systemPrompt).toContain("Project rule: be careful.");
    expect(built.systemPrompt).toContain("Requirement: Build repo QA flow");
    expect(built.systemPrompt).toContain("Detailed workflow.");
    expect(built.systemPrompt).toContain("# Run Completion Rules");
    expect(built.systemPrompt).toContain("Do not repeat the same tool call");
    expect(built.userMessage).toBe("explain the app");
    expect(built.contextSections).toContainEqual(
      expect.objectContaining({
        key: "requirement_context",
        included: true,
      }),
    );
  });

  it("renders AGENTS from repo root to the deepest matching directory", () => {
    const root = mkdtempSync(join(tmpdir(), "yellow-flow-prompt-order-"));
    const systemRoot = join(root, "system");
    const homeRoot = join(root, "home");
    const workspace = join(root, "workspace");
    const nested = join(workspace, "services", "payments");

    mkdirSync(nested, { recursive: true });
    writeFileSync(join(workspace, "AGENTS.md"), "Root rule: broad guidance.", "utf8");
    writeFileSync(join(nested, "AGENTS.md"), "Nested rule: local override.", "utf8");

    const service = new SkillService(systemRoot, homeRoot, () => undefined);
    const builder = new PromptBuilder(service);
    const built = builder.build({
      cwd: nested,
      workspace: {
        id: "workspace",
        name: "Workspace",
        rootPath: workspace,
        shell: "powershell",
        sandboxMode: "workspace-write",
        approvalPolicy: "on-request",
      },
      globalInstructions: "",
      userInput: "explain the rules",
      attachments: [],
      selectedSkills: [],
      discoveredSkills: [],
    });

    expect(built.systemPrompt.indexOf("Root rule: broad guidance.")).toBeLessThan(
      built.systemPrompt.indexOf("Nested rule: local override."),
    );
    expect(built.contextSections).toContainEqual(
      expect.objectContaining({
        key: "requirement_context",
        included: false,
        summary: "Requirement Context not included",
      }),
    );
  });
});
