import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const appSource = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "App.tsx"), "utf8");

describe("Codex-inspired shell composition", () => {
  it("uses the reference sidebar width by default", () => {
    expect(appSource).toContain('const SIDEBAR_WIDTH_STORAGE_KEY = "my-agent-sidebar-width-ratio-v2";');
    expect(appSource).toContain("const SIDEBAR_DEFAULT_RATIO = 0.20;");
  });

  it("does not render an empty terminal card on a fresh thread", () => {
    expect(appSource).toContain("showingThreadWorkspace && activeThreadId && threadTerminals.length > 0");
  });

  it("hides the requirements group when there are no matching requirements", () => {
    expect(appSource).toContain("{(filteredRequirements.length > 0 || searchTerm) && (");
  });
});
