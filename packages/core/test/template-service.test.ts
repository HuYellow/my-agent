import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { TemplateService } from "../src/services/template-service.js";

describe("TemplateService", () => {
  it("lists built-in templates and scaffolds a repo skill", () => {
    const homeDir = mkdtempSync(join(tmpdir(), "my-agent-home-"));
    const projectRoot = mkdtempSync(join(tmpdir(), "my-agent-project-"));
    const service = new TemplateService(homeDir);

    const templates = service.listTemplates();
    expect(templates.map((entry) => entry.id)).toEqual(expect.arrayContaining(["skill-basic", "workflow-review", "plugin-tool"]));

    const result = service.scaffold({
      templateId: "skill-basic",
      target: "repo",
      projectRoot,
      name: "Release Notes",
      directoryName: "release-notes",
    });

    expect(result.createdPaths).toEqual(
      expect.arrayContaining([
        join(projectRoot, ".agents", "skills", "release-notes", "SKILL.md"),
        join(projectRoot, ".agents", "skills", "release-notes", "agents", "openai.yaml"),
      ]),
    );
    expect(readFileSync(join(projectRoot, ".agents", "skills", "release-notes", "SKILL.md"), "utf8")).toContain("# Release Notes");
  });

  it("scaffolds catalog plugins with runnable manifest metadata", () => {
    const homeDir = mkdtempSync(join(tmpdir(), "my-agent-home-"));
    const service = new TemplateService(homeDir);

    const result = service.scaffold({
      templateId: "plugin-tool",
      target: "catalog",
      name: "Changelog Plugin",
      directoryName: "changelog-plugin",
    });

    const manifestPath = join(homeDir, "catalogs", "plugins", "changelog-plugin", ".codex-plugin", "plugin.json");
    expect(result.createdPaths).toContain(manifestPath);
    expect(readFileSync(manifestPath, "utf8")).toContain("\"schemaVersion\": \"1.0\"");
    expect(readFileSync(manifestPath, "utf8")).toContain("\"protocolVersion\": \"0.1.0\"");
  });
});
