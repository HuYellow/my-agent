import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

const stylesPath = join(dirname(fileURLToPath(import.meta.url)), "styles.css");
const styles = readFileSync(stylesPath, "utf8");

describe("Codex-inspired desktop shell styling", () => {
  it("uses a calm neutral workspace palette", () => {
    expect(styles).toContain("--page-bg: #ffffff;");
    expect(styles).toContain("--sidebar-bg: #f7f7f7;");
    expect(styles).toContain("--accent: #10a37f;");
    expect(styles).toContain("body::before,\nbody::after {\n  content: none;");
  });

  it("keeps the primary navigation text visible like the reference shell", () => {
    expect(styles).toContain(".nav-button__label");
    expect(styles).toContain("width: 100%;");
    expect(styles).toContain(".app-toolbar__menu-button");
  });

  it("centers the empty conversation composer on a white canvas", () => {
    expect(styles).toContain(".main-content {\n  background: #ffffff;");
    expect(styles).toContain(".message-area:has(.empty-state)");
    expect(styles).toContain("flex: 0 0 clamp(300px, 40vh, 410px);");
    expect(styles).toContain("justify-content: flex-end;");
    expect(styles).toContain(".composer-bar {\n  width: min(1012px, calc(100% - 56px));");
    expect(styles).toContain(".main-content:has(.empty-state) .composer-bar");
    expect(styles).toContain(".composer-main {\n  min-height: 134px;");
  });

  it("keeps the review source dropdown above message content with a solid shell", () => {
    expect(styles).toMatch(/\.main-header\s*\{[^}]*z-index:\s*40;/s);
    expect(styles).toMatch(/\.review-popover-anchor\s*\{[^}]*z-index:\s*45;/s);
    expect(styles).toMatch(/\.review-popover\s*\{[^}]*z-index:\s*80;[^}]*background:\s*#ffffff;/s);
    expect(styles).toMatch(/\.review-popover__option\s*\{[^}]*background:\s*#ffffff;/s);
  });
});
