import { type PluginRecord, type ProjectRecord } from "@my-agent/protocol";
import { HarnessDatabase } from "../store/database.js";
import { discoverPluginEntries } from "./plugin-registry.js";

export class PluginManager {
  constructor(
    private readonly database: HarnessDatabase,
    private readonly emit: (plugin: PluginRecord) => void,
  ) {}

  list(project?: ProjectRecord): PluginRecord[] {
    if (!project) {
      return [];
    }

    const discovered = discoverPluginEntries({
      workspaceRoot: project.rootPath,
      persisted: this.database.listPlugins(),
    }).map((entry) => entry.record);

    for (const plugin of discovered) {
      this.database.upsertPlugin(plugin);
      this.emit(plugin);
    }

    return discovered;
  }

  update(pluginId: string, patch: Partial<Pick<PluginRecord, "enabled" | "trusted">>): PluginRecord {
    const current = this.database.getPlugin(pluginId);

    if (!current) {
      throw new Error(`Plugin not found: ${pluginId}`);
    }

    const plugin = this.database.upsertPlugin({
      ...current,
      ...patch,
      updatedAt: new Date().toISOString(),
    });
    this.emit(plugin);
    return plugin;
  }
}
