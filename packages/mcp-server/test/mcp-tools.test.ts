import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("mcp-server tool compatibility", () => {
  it("exposes steer and review tools that map to the new core RPC methods", () => {
    const source = readFileSync(join(process.cwd(), "src", "index.ts"), "utf8");

    expect(source).toContain('name: "steer_turn"');
    expect(source).toContain('method: "turn/steer"');
    expect(source).toContain('name: "start_review"');
    expect(source).toContain('method: "review/start"');
    expect(source).toContain('name: "list_reviews"');
    expect(source).toContain('method: "review/list"');
  });
});
