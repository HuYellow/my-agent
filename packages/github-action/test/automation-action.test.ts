import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("github-action automation support", () => {
  it("supports running automations by id before workflow and prompt fallbacks", () => {
    const source = readFileSync(join(process.cwd(), "src", "index.ts"), "utf8");
    const manifest = readFileSync(join(process.cwd(), "action.yml"), "utf8");

    expect(source).toContain("MY_AGENT_AUTOMATION_ID");
    expect(source).toContain('method: "automation/run"');
    expect(source).toContain('mode: "automation"');
    expect(manifest).toContain("automation_id:");
  });
});
