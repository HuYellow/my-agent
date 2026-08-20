import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SkillService } from "../src/services/skill-service.js";

describe("SkillService", () => {
  it("discovers system skills and can resolve explicit activation", () => {
    const root = mkdtempSync(join(tmpdir(), "yellow-flow-skills-"));
    const systemRoot = join(root, "system");
    const homeRoot = join(root, "home");
    const skillRoot = join(systemRoot, "sample-skill");

    mkdirSync(join(skillRoot, "agents"), { recursive: true });
    writeFileSync(
      join(skillRoot, "SKILL.md"),
      `---\nname: sample-skill\ndescription: Use for testing.\n---\n\n# Sample\n`,
      "utf8",
    );
    writeFileSync(join(skillRoot, "agents", "openai.yaml"), "policy:\n  allow_implicit_invocation: true\n", "utf8");

    const service = new SkillService(systemRoot, homeRoot, () => undefined);
    const skills = service.listSkills(root, []);

    expect(skills).toHaveLength(1);
    expect(service.resolveSelectedSkills("$sample-skill hello", undefined, skills)[0]?.name).toBe("sample-skill");
  });
});
