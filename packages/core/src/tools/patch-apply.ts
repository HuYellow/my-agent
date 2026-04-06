export interface PatchFileResult {
  path: string;
  action: "add" | "update" | "delete" | "move";
  content?: string;
  moveTo?: string;
}

interface ParsedPatch {
  files: PatchOperation[];
}

type PatchOperation =
  | { type: "add"; path: string; lines: string[] }
  | { type: "delete"; path: string }
  | { type: "update"; path: string; moveTo?: string; hunks: PatchHunk[] };

interface PatchHunk {
  lines: string[];
}

export function parsePatchDocument(input: string): ParsedPatch {
  const lines = input.replace(/\r\n/g, "\n").split("\n");

  if (lines[0] !== "*** Begin Patch") {
    throw new Error('Patch must start with "*** Begin Patch".');
  }

  const files: PatchOperation[] = [];
  let index = 1;

  while (index < lines.length) {
    const line = lines[index] ?? "";

    if (line === "*** End Patch") {
      return { files };
    }

    if (line.startsWith("*** Add File: ")) {
      const path = line.slice("*** Add File: ".length).trim();
      index += 1;
      const content: string[] = [];

      while (index < lines.length) {
        const next = lines[index] ?? "";

        if (next.startsWith("*** ")) {
          break;
        }

        if (!next.startsWith("+")) {
          throw new Error(`Added file ${path} contains a non-add line: ${next}`);
        }

        content.push(next.slice(1));
        index += 1;
      }

      files.push({ type: "add", path, lines: content });
      continue;
    }

    if (line.startsWith("*** Delete File: ")) {
      files.push({
        type: "delete",
        path: line.slice("*** Delete File: ".length).trim(),
      });
      index += 1;
      continue;
    }

    if (line.startsWith("*** Update File: ")) {
      const path = line.slice("*** Update File: ".length).trim();
      index += 1;
      let moveTo: string | undefined;

      if ((lines[index] ?? "").startsWith("*** Move to: ")) {
        moveTo = (lines[index] ?? "").slice("*** Move to: ".length).trim();
        index += 1;
      }

      const hunks: PatchHunk[] = [];
      let currentHunk: PatchHunk | undefined;

      while (index < lines.length) {
        const next = lines[index] ?? "";

        if (next.startsWith("*** ")) {
          break;
        }

        if (next === "@@" || next.startsWith("@@ ")) {
          currentHunk = { lines: [] };
          hunks.push(currentHunk);
          index += 1;
          continue;
        }

        if (!currentHunk) {
          currentHunk = { lines: [] };
          hunks.push(currentHunk);
        }

        if (next === "*** End of File") {
          index += 1;
          continue;
        }

        if (![" ", "+", "-"].includes(next[0] ?? "")) {
          throw new Error(`Update for ${path} contains an invalid patch line: ${next}`);
        }

        currentHunk.lines.push(next);
        index += 1;
      }

      files.push({ type: "update", path, moveTo, hunks });
      continue;
    }

    throw new Error(`Unknown patch directive: ${line}`);
  }

  throw new Error('Patch must end with "*** End Patch".');
}

export function applyPatchToText(original: string, hunks: PatchHunk[]): string {
  let lines = original.replace(/\r\n/g, "\n").split("\n");
  let cursor = 0;

  for (const hunk of hunks) {
    const expected = hunk.lines
      .filter((line) => {
        const prefix = line[0] ?? "";
        return prefix === " " || prefix === "-";
      })
      .map((line) => line.slice(1));
    const replacement = hunk.lines
      .filter((line) => {
        const prefix = line[0] ?? "";
        return prefix === " " || prefix === "+";
      })
      .map((line) => line.slice(1));

    const position = findSequence(lines, expected, cursor);

    if (position === -1) {
      const fallback = findSequence(lines, expected, 0);

      if (fallback === -1) {
        throw new Error("Patch hunk did not match the current file content.");
      }

      cursor = fallback;
    } else {
      cursor = position;
    }

    const deleteCount = expected.length;
    lines = [...lines.slice(0, cursor), ...replacement, ...lines.slice(cursor + deleteCount)];
    cursor += replacement.length;
  }

  return lines.join("\n");
}

export function executePatchDocument(
  patch: string,
  handlers: {
    readFile: (path: string) => string;
    fileExists: (path: string) => boolean;
  },
): PatchFileResult[] {
  const document = parsePatchDocument(patch);

  return document.files.map((operation) => {
    if (operation.type === "add") {
      return {
        path: operation.path,
        action: "add",
        content: `${operation.lines.join("\n")}${operation.lines.length > 0 ? "\n" : ""}`,
      };
    }

    if (operation.type === "delete") {
      return {
        path: operation.path,
        action: "delete",
      };
    }

    if (!handlers.fileExists(operation.path)) {
      throw new Error(`Cannot update missing file: ${operation.path}`);
    }

    return {
      path: operation.path,
      action: operation.moveTo ? "move" : "update",
      moveTo: operation.moveTo,
      content: applyPatchToText(handlers.readFile(operation.path), operation.hunks),
    };
  });
}

function findSequence(source: string[], expected: string[], fromIndex: number): number {
  if (expected.length === 0) {
    return fromIndex;
  }

  for (let index = fromIndex; index <= source.length - expected.length; index += 1) {
    let matches = true;

    for (let offset = 0; offset < expected.length; offset += 1) {
      if (source[index + offset] !== expected[offset]) {
        matches = false;
        break;
      }
    }

    if (matches) {
      return index;
    }
  }

  return -1;
}
