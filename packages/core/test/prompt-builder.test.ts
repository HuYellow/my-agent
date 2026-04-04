import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PromptBuilder } from "../src/services/prompt-builder.js";
import { SkillService } from "../src/services/skill-service.js";

describe("PromptBuilder", () => {
  it("includes AGENTS and activated skill bodies", () => {
    const root = mkdtempSync(join(tmpdir(), "my-agent-prompt-"));
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
      selectedSkills: discoveredSkills,
      discoveredSkills,
    });

    expect(built.systemPrompt).toContain("Project rule: be careful.");
    expect(built.systemPrompt).toContain("Detailed workflow.");
    expect(built.userMessage).toBe("explain the app");
  });
});
