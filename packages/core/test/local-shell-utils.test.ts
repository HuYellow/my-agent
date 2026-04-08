import { describe, expect, it } from "vitest";
import { buildShellAnalysis } from "../src/tools/local-shell-utils.js";

describe("buildShellAnalysis", () => {
  it("classifies privileged, network, interactive, and safe read commands", () => {
    const root = process.cwd();

    expect(buildShellAnalysis("git status", root, root).riskLevel).toBe("safe_read");
    expect(buildShellAnalysis("npm install", root, root).riskLevel).toBe("network");
    expect(buildShellAnalysis("vim README.md", root, root).riskLevel).toBe("interactive");
    expect(buildShellAnalysis("sudo rm -rf build", root, root).riskLevel).toBe("privileged");
  });
});
