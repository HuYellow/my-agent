import { describe, expect, it } from "vitest";
import { applyPatchToText, executePatchDocument, parsePatchDocument } from "../src/tools/patch-apply.js";

describe("patch-apply helpers", () => {
  it("parses and executes add, update, move, and delete operations", () => {
    const patch = [
      "*** Begin Patch",
      "*** Update File: src/app.ts",
      "@@",
      "-const value = 1;",
      "+const value = 2;",
      "*** Update File: src/old.ts",
      "*** Move to: src/new.ts",
      "@@",
      "-export const renamed = true;",
      "+export const renamed = false;",
      "*** Add File: src/added.ts",
      "+export const added = true;",
      "*** Delete File: src/deleted.ts",
      "*** End Patch",
    ].join("\n");

    const parsed = parsePatchDocument(patch);
    const result = executePatchDocument(patch, {
      readFile: (path) =>
        ({
          "src/app.ts": "const value = 1;\n",
          "src/old.ts": "export const renamed = true;\n",
          "src/deleted.ts": "obsolete\n",
        })[path] ?? "",
      fileExists: (path) => ["src/app.ts", "src/old.ts", "src/deleted.ts"].includes(path),
    });

    expect(parsed.files.map((file) => file.type)).toEqual(["update", "update", "add", "delete"]);
    expect(result).toEqual([
      {
        path: "src/app.ts",
        action: "update",
        content: "const value = 2;\n",
      },
      {
        path: "src/old.ts",
        action: "move",
        moveTo: "src/new.ts",
        content: "export const renamed = false;\n",
      },
      {
        path: "src/added.ts",
        action: "add",
        content: "export const added = true;\n",
      },
      {
        path: "src/deleted.ts",
        action: "delete",
      },
    ]);
  });

  it("rejects malformed patches and unmatched hunks", () => {
    expect(() => parsePatchDocument("not a patch")).toThrow('Patch must start with "*** Begin Patch".');
    expect(() =>
      executePatchDocument(
        [
          "*** Begin Patch",
          "*** Update File: src/app.ts",
          "@@",
          "-const value = 3;",
          "+const value = 4;",
          "*** End Patch",
        ].join("\n"),
        {
          readFile: () => "const value = 1;\n",
          fileExists: () => true,
        },
      ),
    ).toThrow("Patch hunk did not match");
    expect(applyPatchToText("line 1\nline 2\n", [{ lines: [" line 1", "-line 2", "+line 3"] }])).toBe("line 1\nline 3\n");
  });
});
