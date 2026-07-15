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
    expect(combinedStyles).toMatch(/body::before,\s*body::after\s*\{\s*content:\s*none;/s);
  });

  it("keeps the primary navigation text visible like the reference shell", () => {
    expect(combinedStyles).toContain(".nav-button__label");
    expect(combinedStyles).toContain("width: 100%;");
    expect(combinedStyles).toContain(".app-toolbar__menu-button");
  });

  it("combines project expand controls into the project name row", () => {
    expect(combinedStyles).toMatch(/\.project-tree__project\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+auto;/s);
    expect(combinedStyles).toMatch(/\.project-item--with-toggle\s*\{[^}]*grid-template-columns:\s*auto minmax\(0,\s*1fr\);/s);
    expect(combinedStyles).toMatch(/\.project-item__chevron--open\s*\{[^}]*transform:\s*rotate\(90deg\);/s);
  });

  it("centers the empty conversation composer on a white canvas", () => {
    expect(combinedStyles).toMatch(/\.main-content\s*\{[^}]*background:\s*var\(--main-bg\);/s);
    expect(combinedStyles).toContain(".message-area:has(.empty-state)");
    expect(combinedStyles).toContain("flex: 0 0 clamp(300px, 40vh, 410px);");
    expect(combinedStyles).toContain("justify-content: flex-end;");
    expect(combinedStyles).toMatch(/\.composer-bar\s*\{[^}]*width:\s*min\(820px, calc\(100% - 56px\)\);/s);
    expect(combinedStyles).toContain(".main-content:has(.empty-state) .composer-bar");
    expect(combinedStyles).toMatch(/\.composer-main\s*\{[^}]*min-height:\s*108px;/s);
    expect(combinedStyles).toMatch(/\.conversation-feed[^{]*\{[^}]*max-width:\s*820px;/s);
    expect(combinedStyles).toMatch(/\.thought-group,\s*\.answer-group,\s*\.system-note\s*\{[^}]*background:\s*transparent;/s);
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
    expect(combinedStyles).toMatch(/html\[data-theme="dark"\]\s+\.composer-input\s*\{[^}]*color:\s*var\(--text\);/s);
  });

  it("keeps the composer footer row unfilled and unframed", () => {
    expect(combinedStyles).toMatch(/\.composer-footer\s*\{[^}]*border:\s*none;[^}]*background:\s*transparent;/s);
    expect(combinedStyles).not.toMatch(/\.composer-footer\s*\{[^}]*border-top:/s);
    expect(combinedStyles).toMatch(/html\[data-theme="dark"\]\s+\.composer-footer\s*\{[^}]*border:\s*none;[^}]*background:\s*transparent;/s);
    expect(combinedStyles).not.toMatch(/html\[data-theme="dark"\]\s+\.composer-footer\s*\{[^}]*border-top:/s);
    expect(combinedStyles).toMatch(/\.composer-context-card__pie::after\s*\{[^}]*background:\s*var\(--main-bg\);/s);
  });

  it("shows Context window details only on hover or keyboard focus", () => {
    expect(combinedStyles).toMatch(/\.composer-context-card\s*\{[^}]*position:\s*relative;/s);
    expect(combinedStyles).toMatch(/\.composer-context-card__tooltip\s*\{[^}]*position:\s*absolute;[^}]*opacity:\s*0;[^}]*visibility:\s*hidden;[^}]*pointer-events:\s*none;/s);
    expect(combinedStyles).toMatch(/\.composer-context-card:hover\s+\.composer-context-card__tooltip,[^{]*\.composer-context-card:focus-within\s+\.composer-context-card__tooltip\s*\{[^}]*opacity:\s*1;[^}]*visibility:\s*visible;/s);
  });

  it("keeps plugin runtime cards contained and readable", () => {
    expect(combinedStyles).toMatch(/\.runtime-page__grid\s*\{[^}]*grid-template-columns:\s*repeat\(auto-fit, minmax\(min\(100%, 360px\), 1fr\)\);/s);
    expect(combinedStyles).toMatch(/\.runtime-page\s+\.skill-card\s*\{[^}]*inline-size:\s*100%;[^}]*max-inline-size:\s*100%;[^}]*overflow:\s*hidden;[^}]*contain:\s*inline-size;/s);
    expect(combinedStyles).toMatch(/\.runtime-page\s+\.skill-card\s+>\s+\*\s*\{[^}]*min-width:\s*0;[^}]*max-width:\s*100%;/s);
    expect(combinedStyles).toMatch(/\.runtime-page\s+\.skill-card__header,[^{]*\.runtime-page\s+\.skill-card__header\s+>\s+div\s*\{[^}]*min-width:\s*0;/s);
    expect(combinedStyles).toMatch(/\.runtime-page\s+\.skill-card pre,[^{]*\.runtime-page\s+\.runtime-terminal-meta__command\s*\{[^}]*width:\s*100%;[^}]*max-width:\s*100%;[^}]*box-sizing:\s*border-box;[^}]*white-space:\s*pre-wrap;[^}]*overflow-wrap:\s*anywhere;[^}]*word-break:\s*break-word;/s);
    expect(combinedStyles).toMatch(/\.runtime-page\s+\.skill-card p,[^{]*\.runtime-page\s+\.skill-card small,[^{]*\.runtime-page\s+\.skill-card h3,[^{]*\.runtime-page\s+\.skill-card span\s*\{[^}]*overflow-wrap:\s*anywhere;/s);
    expect(combinedStyles).toMatch(/\.runtime-tool-row\s*\{[^}]*display:\s*grid;[^}]*min-width:\s*0;/s);
    expect(combinedStyles).toMatch(/\.runtime-tool-catalog\s*\{[^}]*max-height:\s*360px;[^}]*overflow:\s*auto;/s);
  });

  it("removes legacy decorative theme fragments and corrupted comments", () => {
    expect(combinedStyles).not.toContain("Codex reference shell refresh");
    expect(combinedStyles).not.toContain("Fraunces");
    expect(combinedStyles).not.toMatch(/[闂缂绗婵濡炲倸]/);
  });
});
