import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

const styleModuleNames = [
  "tokens.css",
  "shell.css",
  "sidebar.css",
  "workspace.css",
  "composer.css",
  "panels.css",
  "dialogs.css",
  "responsive.css",
] as const;
const stylesPath = join(dirname(fileURLToPath(import.meta.url)), "styles.css");
const styles = readFileSync(stylesPath, "utf8");
const stylesDir = join(dirname(fileURLToPath(import.meta.url)), "styles");
const combinedStyles = [
  styles,
  ...styleModuleNames.map((moduleName) => {
    const modulePath = join(stylesDir, moduleName);
    return existsSync(modulePath) ? readFileSync(modulePath, "utf8") : "";
  }),
].join("\n");

describe("Codex-inspired desktop shell styling", () => {
  it("uses styles.css as a compact module entrypoint", () => {
    expect(styles).toContain('@import "./styles/tokens.css";');
    expect(styles).toContain('@import "./styles/shell.css";');
    expect(styles).toContain('@import "./styles/sidebar.css";');
    expect(styles).toContain('@import "./styles/workspace.css";');
    expect(styles).toContain('@import "./styles/composer.css";');
    expect(styles).toContain('@import "./styles/panels.css";');
    expect(styles).toContain('@import "./styles/dialogs.css";');
    expect(styles).toContain('@import "./styles/responsive.css";');
  });

  it("uses a calm neutral workspace palette", () => {
    expect(combinedStyles).toContain("--page-bg: #f8f8f6;");
    expect(combinedStyles).toContain("--sidebar-bg: #f3f3f1;");
    expect(combinedStyles).toContain("--accent: #10a37f;");
    expect(combinedStyles).toContain("--radius-md: 8px;");
    expect(combinedStyles).toContain("body::before,\nbody::after {\n  content: none;");
  });

  it("keeps the primary navigation text visible like the reference shell", () => {
    expect(combinedStyles).toContain(".nav-button__label");
    expect(combinedStyles).toContain("width: 100%;");
    expect(combinedStyles).toContain(".app-toolbar__menu-button");
  });

  it("centers the empty conversation composer on a white canvas", () => {
    expect(combinedStyles).toContain(".main-content {\n  background: var(--main-bg);");
    expect(combinedStyles).toContain(".message-area:has(.empty-state)");
    expect(combinedStyles).toContain("flex: 0 0 clamp(300px, 40vh, 410px);");
    expect(combinedStyles).toContain("justify-content: flex-end;");
    expect(combinedStyles).toContain(".composer-bar {\n  width: min(1012px, calc(100% - 56px));");
    expect(combinedStyles).toContain(".main-content:has(.empty-state) .composer-bar");
    expect(combinedStyles).toContain(".composer-main {\n  min-height: 128px;");
  });

  it("keeps the review source dropdown above message content with a solid shell", () => {
    expect(combinedStyles).toMatch(/\.main-header\s*\{[^}]*z-index:\s*40;/s);
    expect(combinedStyles).toMatch(/\.review-popover-anchor\s*\{[^}]*z-index:\s*45;/s);
    expect(combinedStyles).toMatch(/\.review-popover\s*\{[^}]*z-index:\s*80;[^}]*background:\s*var\(--surface-strong\);/s);
    expect(combinedStyles).toMatch(/\.review-popover__option\s*\{[^}]*background:\s*transparent;/s);
  });

  it("keeps the theme toggle visible in the toolbar", () => {
    expect(combinedStyles).not.toContain(".app-toolbar__theme-toggle {\n  display: none;");
    expect(combinedStyles).toMatch(/\.app-toolbar__theme-toggle\s*\{[^}]*display:\s*grid;/s);
  });

  it("keeps header controls and composer surfaces dark in dark mode", () => {
    expect(combinedStyles).toMatch(/html\[data-theme="dark"\]\s+\.workspace-toggle\s*\{[^}]*background:\s*#242424;/s);
    expect(combinedStyles).toMatch(/html\[data-theme="dark"\]\s+\.workspace-toggle__button--active,[^{]*\{[^}]*background:\s*#303030;/s);
    expect(combinedStyles).toMatch(/html\[data-theme="dark"\]\s+\.composer-main\s*\{[^}]*background:\s*#242424;/s);
    expect(combinedStyles).toMatch(/html\[data-theme="dark"\]\s+\.composer-footer\s*\{[^}]*background:\s*#1f1f1f;/s);
    expect(combinedStyles).toMatch(/html\[data-theme="dark"\]\s+\.composer-input\s*\{[^}]*color:\s*var\(--text\);/s);
  });

  it("removes legacy decorative theme fragments and corrupted comments", () => {
    expect(combinedStyles).not.toContain("Codex reference shell refresh");
    expect(combinedStyles).not.toContain("Fraunces");
    expect(combinedStyles).not.toMatch(/[闂缂绗婵濡炲倸]/);
  });
});
