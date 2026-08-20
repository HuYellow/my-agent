import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, watch, type FSWatcher } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { type SkillDescriptor } from "@yellow-flow/protocol";
import YAML from "yaml";
import { HarnessDatabase } from "../store/database.js";
import { findGitRoot, readTextIfExists } from "../utils/path-utils.js";
import { resolvePluginSkillRoots } from "./plugin-registry.js";

interface SkillFrontmatter {
  name?: string;
  description?: string;
}

interface SkillRuntimeMetadata {
  display_name?: string;
  short_description?: string;
  brand_color?: string;
  allow_implicit_invocation?: boolean;
}

interface OpenAiYaml {
  interface?: SkillRuntimeMetadata;
  policy?: {
    allow_implicit_invocation?: boolean;
  };
  template_version?: string;
}

export class SkillService {
  private watchers: FSWatcher[] = [];

  constructor(
    private readonly systemSkillsRoot: string,
    private readonly homeDir: string,
    private readonly onChange: (skills: SkillDescriptor[]) => void,
    private readonly database?: HarnessDatabase,
  ) {}

  dispose(): void {
    for (const watcher of this.watchers) {
      watcher.close();
    }

    this.watchers = [];
  }

  listSkills(cwd: string, disabledSkillIds: string[]): SkillDescriptor[] {
    return this.scanSkillRoots(this.getRoots(cwd), disabledSkillIds);
  }

  startWatching(cwd: string, disabledSkillIds: string[]): void {
    this.dispose();

    for (const root of this.getRoots(cwd)) {
      if (!existsSync(root.path)) {
        continue;
      }

      try {
        const watcher = watch(root.path, { recursive: true }, () => {
          this.onChange(this.scanSkillRoots(this.getRoots(cwd), disabledSkillIds));
        });
        this.watchers.push(watcher);
      } catch {
        const watcher = watch(root.path, () => {
          this.onChange(this.scanSkillRoots(this.getRoots(cwd), disabledSkillIds));
        });
        this.watchers.push(watcher);
      }
    }
  }

  getSkillBody(path: string): string {
    return readFileSync(join(path, "SKILL.md"), "utf8");
  }

  parseExplicitSkillNames(input: string): string[] {
    const matches = input.matchAll(/(?:^|\s)\$([a-z0-9][a-z0-9-]*)/gi);
    return [...matches].map((match) => match[1]!.toLowerCase());
  }

  stripExplicitSkills(input: string): string {
    return input.replace(/(?:^|\s)\$([a-z0-9][a-z0-9-]*)/gi, " ").replace(/\s+/g, " ").trim();
  }

  resolveSelectedSkills(input: string, selectedSkillIds: string[] | undefined, discoveredSkills: SkillDescriptor[]): SkillDescriptor[] {
    const explicitNames = new Set(this.parseExplicitSkillNames(input));
    const explicitByName = discoveredSkills.filter((skill) => explicitNames.has(skill.name.toLowerCase()));
    const explicitById = discoveredSkills.filter((skill) => selectedSkillIds?.includes(skill.id));
    const explicit = [...new Map([...explicitByName, ...explicitById].map((skill) => [skill.id, skill])).values()];

    if (explicit.length > 0) {
      return explicit;
    }

    const implicit = this.matchImplicitSkill(input, discoveredSkills);
    return implicit ? [implicit] : [];
  }

  private matchImplicitSkill(input: string, skills: SkillDescriptor[]): SkillDescriptor | null {
    const inputTokens = tokenize(input);
    let best: { skill: SkillDescriptor; score: number } | null = null;

    for (const skill of skills) {
      if (!skill.metadata.allowImplicitInvocation || !skill.enabled) {
        continue;
      }

      const skillTokens = tokenize(`${skill.name} ${skill.description} ${skill.metadata.shortDescription ?? ""}`);
      const overlap = [...skillTokens].filter((token) => inputTokens.has(token)).length;
      const score = overlap / Math.max(skillTokens.size, 1);

      if (score >= 0.22 && (!best || score > best.score)) {
        best = { skill, score };
      }
    }

    return best?.skill ?? null;
  }

  private getRoots(cwd: string): Array<{ scope: SkillDescriptor["scope"]; path: string }> {
    const repoRoot = findGitRoot(cwd);
    const roots: Array<{ scope: SkillDescriptor["scope"]; path: string }> = [
      { scope: "SYSTEM", path: this.systemSkillsRoot },
      { scope: "USER", path: join(this.homeDir, "skills") },
      { scope: "CATALOG", path: join(this.homeDir, "catalogs", "skills") },
    ];

    if (repoRoot) {
      roots.push({ scope: "REPO", path: join(repoRoot, ".agents", "skills") });
    }

    for (const plugin of this.database?.listPlugins() ?? []) {
      for (const root of resolvePluginSkillRoots(plugin)) {
        roots.push({ scope: "PLUGIN", path: root });
      }
    }

    return roots;
  }

  private scanSkillRoots(roots: Array<{ scope: SkillDescriptor["scope"]; path: string }>, disabledSkillIds: string[]): SkillDescriptor[] {
    const skills: SkillDescriptor[] = [];

    for (const root of roots) {
      if (!existsSync(root.path)) {
        continue;
      }

      for (const entry of readdirSync(root.path, { withFileTypes: true })) {
        if (!entry.isDirectory()) {
          continue;
        }

        const skillPath = join(root.path, entry.name);
        const skillFile = join(skillPath, "SKILL.md");

        if (!existsSync(skillFile)) {
          continue;
        }

        const parsed = this.parseSkill(root.scope, skillPath);

        if (parsed) {
          parsed.enabled = !disabledSkillIds.includes(parsed.id);
          skills.push(parsed);
        }
      }
    }

    return skills.sort((left, right) => left.name.localeCompare(right.name));
  }

  private parseSkill(scope: SkillDescriptor["scope"], skillPath: string): SkillDescriptor | null {
    const markdown = readFileSync(join(skillPath, "SKILL.md"), "utf8");
    const frontmatter = parseFrontmatter(markdown);
    const yamlText = readTextIfExists(join(skillPath, "agents", "openai.yaml"));
    const openaiYaml = yamlText ? (YAML.parse(yamlText) as OpenAiYaml) : {};
    const name = frontmatter.name ?? basenameLike(skillPath);
    const description = frontmatter.description ?? summarizeMarkdown(markdown);

    if (!name || !description) {
      return null;
    }

    const idSource = `${scope}:${resolve(skillPath)}`;
    const id = createHash("sha1").update(idSource).digest("hex").slice(0, 12);

    return {
      id,
      name,
      description,
      scope,
      path: skillPath,
      enabled: true,
      metadata: {
        displayName: openaiYaml.interface?.display_name,
        shortDescription: openaiYaml.interface?.short_description,
        brandColor: openaiYaml.interface?.brand_color,
        allowImplicitInvocation: openaiYaml.policy?.allow_implicit_invocation ?? openaiYaml.interface?.allow_implicit_invocation ?? scope === "SYSTEM",
        templateVersion: typeof openaiYaml.template_version === "string" ? openaiYaml.template_version : undefined,
      },
    };
  }
}

function parseFrontmatter(markdown: string): SkillFrontmatter {
  if (!markdown.startsWith("---")) {
    return {};
  }

  const endIndex = markdown.indexOf("\n---", 3);

  if (endIndex === -1) {
    return {};
  }

  const raw = markdown.slice(3, endIndex).trim();
  return (YAML.parse(raw) as SkillFrontmatter | null) ?? {};
}

function summarizeMarkdown(markdown: string): string {
  const withoutFrontmatter = markdown.replace(/^---[\s\S]*?---\s*/, "");
  const lines = withoutFrontmatter
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
  return lines[0] ?? "Reusable workflow skill.";
}

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .map((token) => token.trim())
      .filter((token) => token.length > 2),
  );
}

function basenameLike(path: string): string {
  return resolve(path).split(/[\\/]/).pop() ?? path;
}

export function getDefaultSystemSkillsRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "system-skills");
}

export function getDefaultHomeDir(): string {
  return join(homedir(), ".yellow-flow");
}
