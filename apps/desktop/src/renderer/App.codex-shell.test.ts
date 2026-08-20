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
    expect(appSource).toContain('const SIDEBAR_WIDTH_STORAGE_KEY = "yellow-flow-sidebar-width-ratio-v2";');
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

  it("gives the plugin runtime page a dedicated presentation shell", () => {
    expect(appSource).toContain('className="skills-page runtime-page"');
    expect(appSource).toContain('className="runtime-page__summary"');
    expect(appSource).toContain('className="skills-grid runtime-page__grid"');
    expect(appSource).toContain("插件与 Runtime");
    expect(appSource).toContain("工具目录");
  });

  it("moves Context window copy into an accessible hover tooltip", () => {
    expect(appSource).toContain('aria-describedby="composer-context-tooltip"');
    expect(appSource).toContain('id="composer-context-tooltip"');
    expect(appSource).toContain('role="tooltip"');
    expect(appSource).toContain("Context window");
    expect(appSource).not.toContain('role="status">\n              <strong>Context window</strong>');
  });

  it("toggles unassigned project groups from the project name instead of revealing folders", () => {
    expect(appSource).toContain("const [expandedUnassignedProjectIds");
    expect(appSource).toContain("const toggleUnassignedProject = (projectGroupId: string) => {");
    expect(appSource).toContain('onClick={() => toggleUnassignedProject(projectGroupId)}');
    expect(appSource).not.toContain('className="project-item" onClick={() => project && void onRevealProject(project.rootPath)}');
  });

  it("renders project expand affordances inside the project name buttons", () => {
    expect(appSource).toContain('className={`project-item project-item--with-toggle ${isActiveProject ? "project-item--active" : ""}`}');
    expect(appSource).toContain('className="project-item project-item--with-toggle"');
    expect(appSource).toContain("project-item__chevron");
    expect(appSource).not.toContain('className={`project-tree__toggle ${expanded ? "project-tree__toggle--open" : ""}`');
  });

  it("does not keep mojibake comments in the renderer shell", () => {
    expect(appSource).not.toMatch(/[闂缂绗婵濡炲倸]/);
  });
});
