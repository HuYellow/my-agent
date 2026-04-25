import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export function findUp(start: string, filename: string): string | null {
  let current = resolve(start);

  while (true) {
    const candidate = join(current, filename);

    if (existsSync(candidate)) {
      return candidate;
    }

    const parent = dirname(current);

    if (parent === current) {
      return null;
    }

    current = parent;
  }
}

export function findGitRoot(start: string): string | null {
  return findUp(start, ".git")?.replace(/[\\/]\.git$/, "") ?? null;
}

export function findAgentDocuments(start: string): string[] {
  const documents: string[] = [];
  let current = resolve(start);

  while (true) {
    const candidate = join(current, "AGENTS.md");

    if (existsSync(candidate)) {
      documents.push(candidate);
    }

    const parent = dirname(current);

    if (parent === current) {
      break;
    }

    current = parent;
  }

  return documents.reverse();
}

export function isPathInside(parent: string, candidate: string): boolean {
  const normalizedParent = resolve(parent);
  const normalizedCandidate = resolve(candidate);
  return normalizedCandidate === normalizedParent || normalizedCandidate.startsWith(`${normalizedParent}\\`) || normalizedCandidate.startsWith(`${normalizedParent}/`);
}

export function readTextIfExists(path: string): string | null {
  if (!existsSync(path)) {
    return null;
  }

  return readFileSync(path, "utf8");
}
