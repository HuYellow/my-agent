import { pathToFileURL } from "node:url";

const [action, pluginPath] = process.argv.slice(2);
const payload = await readStdinJson();
const plugins = await loadPlugins(pluginPath!);

try {
  const result = await dispatch(action!, plugins, payload);
  process.stdout.write(JSON.stringify(result ?? null));
} catch (error) {
  process.stderr.write(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}

async function loadPlugins(pluginPath: string): Promise<Array<Record<string, unknown>>> {
  const module = await import(`${pathToFileURL(pluginPath).href}?t=${Date.now()}`);
  const exportsToLoad = module.default || module.plugin ? [module.default ?? module.plugin] : Object.values(module);
  const plugins: Array<Record<string, unknown>> = [];

  for (const exported of exportsToLoad) {
    const plugin = typeof exported === "function" ? await exported(buildContext()) : exported;
    if (plugin && typeof plugin === "object" && !Array.isArray(plugin)) {
      plugins.push(plugin as Record<string, unknown>);
    }
  }

  return plugins.length > 0 ? plugins : [{}];
}

async function dispatch(action: string, plugins: Array<Record<string, unknown>>, payload: Record<string, unknown>) {
  switch (action) {
    case "inspect":
      return inspectPlugins(plugins);
    case "executeTool":
      return executeTool(plugins, String(payload.toolName), asRecord(payload.args));
    case "beforeTool":
      return runBeforeHooks(plugins, String(payload.toolName), asRecord(payload.args));
    case "afterTool":
      return invokeHooks(plugins, "tool.execute.after", {
        tool: String(payload.toolName),
        args: asRecord(payload.args),
        output: typeof payload.output === "string" ? payload.output : undefined,
        error: typeof payload.error === "string" ? payload.error : undefined,
      }, {});
    case "shellEnv":
      return runShellEnvHooks(plugins);
    default:
      throw new Error(`Unsupported OpenCode runtime action: ${action}`);
  }
}

function inspectPlugins(plugins: Array<Record<string, unknown>>) {
  const toolEntries = plugins.flatMap((plugin) => Object.entries(asRecord(plugin.tool ?? plugin.tools)));
  const hookNames = [...new Set(plugins.flatMap((plugin) => collectHookNames(plugin)))];

  return {
    tools: toolEntries.map(([name, value]) => {
      const tool = asRecord(value);
      return {
        name,
        description: typeof tool.description === "string" ? tool.description : `OpenCode tool ${name}`,
        parameters: normalizeSchema(tool.args ?? tool.parameters ?? tool.schema),
      };
    }),
    hookNames,
  };
}

async function executeTool(plugins: Array<Record<string, unknown>>, toolName: string, args: Record<string, unknown>) {
  for (const plugin of plugins) {
    const tool = asRecord(asRecord(plugin.tool ?? plugin.tools)[toolName]);
    const execute = tool.execute ?? tool.run;

    if (typeof execute === "function") {
      return await execute(args, buildContext());
    }
  }

  throw new Error(`OpenCode tool not found: ${toolName}`);
}

async function runBeforeHooks(plugins: Array<Record<string, unknown>>, toolName: string, args: Record<string, unknown>) {
  const output = { args: { ...args } };
  const result = await invokeHooks(plugins, "tool.execute.before", { tool: toolName, args }, output, { convertErrorsToBlock: true });

  if (isRecord(result) && typeof result.block === "string") {
    return result;
  }

  return { args: output.args };
}

async function runShellEnvHooks(plugins: Array<Record<string, unknown>>) {
  const output = { env: {} as Record<string, string> };
  const result = await invokeHooks(plugins, "shell.env", {}, output);

  if (isRecord(result)) {
    for (const [key, value] of Object.entries(result)) {
      if (typeof value === "string") {
        output.env[key] = value;
      }
    }
  }

  return output.env;
}

async function invokeHooks(
  plugins: Array<Record<string, unknown>>,
  name: string,
  input: Record<string, unknown>,
  output: Record<string, unknown>,
  options: { convertErrorsToBlock?: boolean } = {},
) {
  let lastResult: unknown = null;

  for (const plugin of plugins) {
    const hooks = asRecord(plugin.hooks);
    const hook = plugin[name] ?? hooks[name];

    if (typeof hook !== "function") {
      continue;
    }

    try {
      lastResult = await hook(input, output, buildContext());
    } catch (error) {
      if (options.convertErrorsToBlock) {
        return { block: error instanceof Error ? error.message : String(error) };
      }
      throw error;
    }

    if (isRecord(lastResult)) {
      if (isRecord(lastResult.args)) {
        output.args = lastResult.args;
      }

      if (typeof lastResult.block === "string") {
        return lastResult;
      }
    }
  }

  return lastResult;
}

function collectHookNames(plugin: Record<string, unknown>): string[] {
  const hooks = asRecord(plugin.hooks);
  return [...Object.keys(plugin), ...Object.keys(hooks)]
    .filter((key) => ["tool.execute.before", "tool.execute.after", "shell.env"].includes(key))
    .filter((key, index, values) => values.indexOf(key) === index);
}

function normalizeSchema(value: unknown) {
  if (value && typeof value === "object" && !Array.isArray(value) && (value as { type?: unknown }).type === "object") {
    return value;
  }

  return {
    type: "object",
    properties: {},
    additionalProperties: true,
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function buildContext() {
  return {
    directory: process.cwd(),
    project: {},
    client: {
      app: {
        log: async () => undefined,
      },
    },
  };
}

async function readStdinJson(): Promise<Record<string, unknown>> {
  let input = "";
  process.stdin.setEncoding("utf8");

  for await (const chunk of process.stdin) {
    input += chunk;
  }

  return input.trim() ? JSON.parse(input) : {};
}
