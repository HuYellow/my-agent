import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const appSource = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "App.tsx"), "utf8");

describe("Codex-inspired shell composition", () => {
  it("moves reusable presentation pieces into renderer components", () => {
    expect(appSource).toContain('from "./components/shell"');
    expect(appSource).toContain('from "./components/sidebar"');
    expect(appSource).toContain('from "./components/settings"');
  });

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

  it("keeps the rabbit brand mark and theme toggle in the title bar", () => {
    expect(appSource).toContain("Rabbit,");
    expect(appSource).toContain('<Rabbit className="app-toolbar__logo"');
    expect(appSource).toContain('className="app-toolbar__theme-toggle"');
    expect(appSource).toContain('setThemeMode((current) => (current === "light" ? "dark" : "light"))');
  });

  it("uses Chinese-first copy for the primary workspace", () => {
    expect(appSource).toContain('label="技能"');
    expect(appSource).toContain("<span>对话</span>");
    expect(appSource).toContain("<span>评审</span>");
    expect(appSource).toContain("<span>安装插件</span>");
    expect(appSource).toContain("API 配置");
  });

  it("does not keep mojibake comments in the renderer shell", () => {
    expect(appSource).not.toMatch(/[闂缂绗婵濡炲倸]/);
  });
});
