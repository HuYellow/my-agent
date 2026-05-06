import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  type DistributionTarget,
  type DistributionTemplateRecord,
  type TemplateScaffoldResult,
} from "@my-agent/protocol";
import { findGitRoot } from "../utils/path-utils.js";

const TEMPLATE_VERSION = "1.0";
const PROTOCOL_VERSION = "0.1.0";
const SERVER_VERSION = "0.1.0";
const DISTRIBUTION_DOC_PATH = "docs/distribution-and-templates.md";

const BUILTIN_TEMPLATES: DistributionTemplateRecord[] = [
  {
    id: "skill-basic",
    kind: "skill",
    name: "Basic Skill",
    description: "A repo/user/catalog skill with frontmatter and OpenAI runtime metadata.",
    version: TEMPLATE_VERSION,
    recommendedTarget: "repo",
    supportedTargets: ["repo", "user", "catalog"],
    destinationHint: ".agents/skills/<name>/",
    files: ["SKILL.md", "agents/openai.yaml"],
    documentationPath: DISTRIBUTION_DOC_PATH,
  },
  {
    id: "workflow-review",
    kind: "workflow",
    name: "Review Workflow",
    description: "A structured workflow manifest with protocol compatibility metadata and review + agent steps.",
    version: TEMPLATE_VERSION,
    recommendedTarget: "repo",
    supportedTargets: ["repo", "user", "catalog"],
    destinationHint: ".agents/workflows/<name>.yaml",
    files: ["<name>.yaml"],
    documentationPath: DISTRIBUTION_DOC_PATH,
  },
  {
    id: "plugin-tool",
    kind: "plugin",
    name: "Tool Plugin",
    description: "A runnable plugin scaffold with manifest, Node entrypoint, and README.",
    version: TEMPLATE_VERSION,
    recommendedTarget: "catalog",
    supportedTargets: ["repo", "user", "catalog"],
    destinationHint: "catalogs/plugins/<name>/",
    files: [".codex-plugin/plugin.json", "src/index.js", "README.md"],
    documentationPath: DISTRIBUTION_DOC_PATH,
  },
];

export class TemplateService {
  constructor(private readonly homeDir: string) {}

  listTemplates(): DistributionTemplateRecord[] {
    return BUILTIN_TEMPLATES;
  }

  scaffold(params: {
    templateId: string;
    target: DistributionTarget;
    projectRoot?: string;
    name?: string;
    directoryName?: string;
  }): TemplateScaffoldResult {
    const template = BUILTIN_TEMPLATES.find((entry) => entry.id === params.templateId);

    if (!template) {
      throw new Error(`Template not found: ${params.templateId}`);
    }

    if (!template.supportedTargets.includes(params.target)) {
      throw new Error(`Template ${template.name} does not support target ${params.target}.`);
    }

    const normalizedName = normalizeTemplateName(params.name ?? template.name);
    const directoryName = slugify(params.directoryName ?? normalizedName);
    const rootPath = resolveTargetRoot({
      kind: template.kind,
      target: params.target,
      homeDir: this.homeDir,
      projectRoot: params.projectRoot,
      directoryName,
    });

    const createdPaths = writeTemplateFiles(template.id, {
      rootPath,
      name: normalizedName,
      slug: directoryName,
    });

    return {
      template,
      rootPath,
      createdPaths,
    };
  }
}

function resolveTargetRoot(params: {
  kind: DistributionTemplateRecord["kind"];
  target: DistributionTarget;
  homeDir: string;
  projectRoot?: string;
  directoryName: string;
}): string {
  const baseDirName = params.kind === "skill" ? "skills" : params.kind === "workflow" ? "workflows" : "plugins";

  switch (params.target) {
    case "repo": {
      if (!params.projectRoot) {
        throw new Error("A project is required when scaffolding into the repo target.");
      }

      const repoRoot = findGitRoot(params.projectRoot) ?? params.projectRoot;
      const baseRoot = join(repoRoot, ".agents", baseDirName);
      return params.kind === "workflow" ? join(baseRoot, `${params.directoryName}.yaml`) : join(baseRoot, params.directoryName);
    }
    case "catalog": {
      const baseRoot = join(params.homeDir, "catalogs", baseDirName);
      return params.kind === "workflow" ? join(baseRoot, `${params.directoryName}.yaml`) : join(baseRoot, params.directoryName);
    }
    case "user":
    default: {
      const baseRoot = join(params.homeDir, baseDirName);
      return params.kind === "workflow" ? join(baseRoot, `${params.directoryName}.yaml`) : join(baseRoot, params.directoryName);
    }
  }
}

function writeTemplateFiles(
  templateId: string,
  params: { rootPath: string; name: string; slug: string },
): string[] {
  switch (templateId) {
    case "skill-basic":
      return writeFiles(params.rootPath, {
        "SKILL.md": buildSkillMarkdown(params.name, params.slug),
        "agents/openai.yaml": buildSkillYaml(params.name),
      });
    case "workflow-review":
      return writeFiles(dirname(params.rootPath), {
        [`${params.slug}.yaml`]: buildWorkflowYaml(params.name, params.slug),
      });
    case "plugin-tool":
      return writeFiles(params.rootPath, {
        ".codex-plugin/plugin.json": buildPluginManifest(params.name, params.slug),
        "src/index.js": buildPluginEntrypoint(params.name),
        "README.md": buildPluginReadme(params.name, params.slug),
      });
    default:
      throw new Error(`Unsupported template: ${templateId}`);
  }
}

function writeFiles(rootPath: string, files: Record<string, string>): string[] {
  const createdPaths: string[] = [];

  for (const [relativePath, content] of Object.entries(files)) {
    const absolutePath = join(rootPath, relativePath);
    mkdirSync(dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, content, "utf8");
    createdPaths.push(absolutePath);
  }

  return createdPaths.sort((left, right) => left.localeCompare(right));
}

function buildSkillMarkdown(name: string, slug: string): string {
  return [
    "---",
    `name: ${slug}`,
    `description: Use when the user needs ${name.toLowerCase()} support.`,
    "---",
    "",
    `# ${name}`,
    "",
    "Use this skill to provide a focused workflow.",
    "",
    "## When To Use",
    "",
    "1. The request clearly matches this domain.",
    "2. The task benefits from a repeatable approach.",
    "",
    "## Workflow",
    "",
    "1. Restate the user's goal.",
    "2. Gather the smallest useful context.",
    "3. Execute the requested work.",
    "4. Summarize outcomes, verification, and risks.",
    "",
  ].join("\n");
}

function buildSkillYaml(name: string): string {
  return [
    "interface:",
    `  display_name: ${name}`,
    `  short_description: Focused ${name.toLowerCase()} helper`,
    "policy:",
    "  allow_implicit_invocation: false",
    `compatibility:`,
    `  protocol_version: "${PROTOCOL_VERSION}"`,
    `  server_version: "${SERVER_VERSION}"`,
    `template_version: "${TEMPLATE_VERSION}"`,
    "",
  ].join("\n");
}

function buildWorkflowYaml(name: string, slug: string): string {
  return [
    `apiVersion: "my-agent/v1alpha1"`,
    `templateVersion: "${TEMPLATE_VERSION}"`,
    "compatibility:",
    `  protocolVersion: "${PROTOCOL_VERSION}"`,
    `  serverVersion: "${SERVER_VERSION}"`,
    `name: ${name}`,
    `description: ${name} workflow scaffold`,
    "steps:",
    "  - id: inspect",
    "    type: command",
    "    title: Inspect repository state",
    '    command: git status --short --branch',
    "  - id: review",
    "    type: review",
    "    title: Review staged or working-tree changes",
    "    prompt: Focus on correctness, regressions, and missing tests.",
    "    reviewSource:",
    "      kind: workspace",
    "    dependsOn:",
    "      - inspect",
    "  - id: summarize",
    "    type: agent",
    "    title: Summarize findings",
    `    prompt: Summarize the ${slug} workflow result and propose the next safe step.`,
    "    dependsOn:",
    "      - review",
    "",
  ].join("\n");
}

function buildPluginManifest(name: string, slug: string): string {
  return `${JSON.stringify(
    {
      schemaVersion: TEMPLATE_VERSION,
      name: slug,
      version: "0.1.0",
      capabilities: ["write"],
      sandboxMode: "workspace-write",
      command: "node",
      args: ["src/index.js"],
      compatibility: {
        protocolVersion: PROTOCOL_VERSION,
        serverVersion: SERVER_VERSION,
      },
      tool: {
        name: `${slug}_run`,
        description: `Run the ${name} plugin scaffold.`,
        parameters: {
          type: "object",
          properties: {
            task: {
              type: "string",
              description: "The task description for the plugin scaffold.",
            },
          },
          required: ["task"],
          additionalProperties: false,
        },
      },
    },
    null,
    2,
  )}\n`;
}

function buildPluginEntrypoint(name: string): string {
  return [
    "process.stdin.setEncoding(\"utf8\");",
    "",
    "let input = \"\";",
    "process.stdin.on(\"data\", (chunk) => {",
    "  input += chunk;",
    "});",
    "",
    "process.stdin.on(\"end\", () => {",
    "  const payload = input.trim() ? JSON.parse(input) : {};",
    "  const task = typeof payload.task === \"string\" ? payload.task : \"No task provided.\";",
    `  const result = { summary: "${name} plugin scaffold ran successfully.", task };`,
    "  process.stdout.write(JSON.stringify(result, null, 2));",
    "});",
    "",
  ].join("\n");
}

function buildPluginReadme(name: string, slug: string): string {
  return [
    `# ${name}`,
    "",
    "This plugin scaffold is intentionally small but runnable.",
    "",
    "## Files",
    "",
    "- `.codex-plugin/plugin.json`: plugin manifest and compatibility metadata",
    "- `src/index.js`: stdin -> stdout JSON command handler",
    "",
    "## Manual Smoke Test",
    "",
    "```bash",
    `echo '{\"task\":\"test ${slug}\"}' | node src/index.js`,
    "```",
    "",
  ].join("\n");
}

function normalizeTemplateName(value: string): string {
  const trimmed = value.trim();
  return trimmed || "New Template";
}

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "template";
}
