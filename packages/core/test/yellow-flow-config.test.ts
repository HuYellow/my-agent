import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  ensureStoredProviderConfig,
  getDefaultYellowFlowHomeDir,
  loadStoredProviderConfig,
  parseTomlDocument,
  serializeTomlDocument,
  syncStoredProviderConfig,
  watchStoredConfig,
} from "../src/services/yellow-flow-config.js";

const ORIGINAL_YELLOW_FLOW_HOME = process.env.YELLOW_FLOW_HOME;

afterEach(() => {
  if (ORIGINAL_YELLOW_FLOW_HOME === undefined) {
    delete process.env.YELLOW_FLOW_HOME;
  } else {
    process.env.YELLOW_FLOW_HOME = ORIGINAL_YELLOW_FLOW_HOME;
  }
});

describe("yellow-flow file config integration", () => {
  it("loads provider and auth from ~/.yellow-flow files", () => {
    const yellowFlowHome = mkdtempSync(join(tmpdir(), "yellow-flow-home-"));
    process.env.YELLOW_FLOW_HOME = yellowFlowHome;
    writeFileSync(
      join(yellowFlowHome, "config.toml"),
      [
        'model_provider = "sub2api"',
        'model = "gpt-5.4"',
        'model_reasoning_effort = "high"',
        "",
        "[model_providers.sub2api]",
        'name = "sub2api"',
        'base_url = "https://aixj.vip"',
        'wire_api = "responses"',
        "requires_openai_auth = true",
        "",
      ].join("\n"),
      "utf8",
    );
    writeFileSync(join(yellowFlowHome, "auth.json"), JSON.stringify({ OPENAI_API_KEY: "sk-test" }, null, 2), "utf8");

    const loaded = loadStoredProviderConfig();

    expect(getDefaultYellowFlowHomeDir()).toBe(yellowFlowHome);
    expect(loaded?.provider).toMatchObject({
      id: "yellow-flow:sub2api",
      name: "sub2api",
      baseUrl: "https://aixj.vip",
      apiKey: "sk-test",
      model: "gpt-5.4",
      apiFlavor: "responses",
      reasoningEffort: "high",
    });
  });

  it("syncs provider changes back to config.toml and auth.json", () => {
    const yellowFlowHome = mkdtempSync(join(tmpdir(), "yellow-flow-home-"));
    process.env.YELLOW_FLOW_HOME = yellowFlowHome;

    syncStoredProviderConfig({
      id: "codex:sub2api",
      name: "sub2api",
      baseUrl: "https://api.deepseek.com",
      apiKey: "sk-new",
      model: "deepseek-chat",
      apiFlavor: "responses",
      reasoningEffort: "minimal",
    });

    expect(existsSync(join(yellowFlowHome, "config.toml"))).toBe(true);
    expect(readFileSync(join(yellowFlowHome, "auth.json"), "utf8")).toContain("sk-new");

    const loaded = loadStoredProviderConfig();
    expect(loaded?.provider).toMatchObject({
      id: "yellow-flow:sub2api",
      baseUrl: "https://api.deepseek.com",
      apiKey: "sk-new",
      model: "deepseek-chat",
      reasoningEffort: "minimal",
    });
  });

  it("round-trips generic TOML sections used by provider config", () => {
    const document = parseTomlDocument([
      'model_provider = "sub2api"',
      'model = "gpt-5.4"',
      "",
      "[model_providers.sub2api]",
      'base_url = "https://aixj.vip"',
      'wire_api = "responses"',
      "",
      "[features]",
      "chat_enabled = false",
      "",
    ].join("\n"));

    const serialized = serializeTomlDocument(document);

    expect(serialized).toContain('[model_providers.sub2api]');
    expect(serialized).toContain('[features]');
    expect(serialized).toContain('wire_api = "responses"');
  });

  it("watches config file changes", async () => {
    const yellowFlowHome = mkdtempSync(join(tmpdir(), "yellow-flow-home-"));
    process.env.YELLOW_FLOW_HOME = yellowFlowHome;
    writeFileSync(
      join(yellowFlowHome, "config.toml"),
      [
        'model_provider = "sub2api"',
        'model = "gpt-5.4"',
        "",
        "[model_providers.sub2api]",
        'name = "sub2api"',
        'base_url = "https://aixj.vip"',
        'wire_api = "responses"',
        "requires_openai_auth = true",
        "",
      ].join("\n"),
      "utf8",
    );

    const changed = new Promise<void>((resolve) => {
      const stop = watchStoredConfig(() => {
        stop();
        resolve();
      });
    });

    writeFileSync(join(yellowFlowHome, "auth.json"), JSON.stringify({ OPENAI_API_KEY: "sk-live" }, null, 2), "utf8");

    await changed;
  });

  it("creates missing config files from the current provider", () => {
    const yellowFlowHome = mkdtempSync(join(tmpdir(), "yellow-flow-home-"));
    process.env.YELLOW_FLOW_HOME = yellowFlowHome;

    ensureStoredProviderConfig({
      id: "default-provider",
      name: "DeepSeek",
      baseUrl: "https://api.deepseek.com",
      apiKey: "sk-live",
      model: "deepseek-chat",
      apiFlavor: "responses",
      reasoningEffort: "minimal",
    });

    expect(existsSync(join(yellowFlowHome, "config.toml"))).toBe(true);
    expect(existsSync(join(yellowFlowHome, "auth.json"))).toBe(true);
  });

  it("falls back from legacy ai_sdk provider config to responses", () => {
    const yellowFlowHome = mkdtempSync(join(tmpdir(), "yellow-flow-home-"));
    process.env.YELLOW_FLOW_HOME = yellowFlowHome;
    writeFileSync(
      join(yellowFlowHome, "config.toml"),
      [
        'model_provider = "legacy"',
        'model = "gpt-5.4"',
        "",
        "[model_providers.legacy]",
        'name = "legacy"',
        'base_url = "https://aixj.vip"',
        'wire_api = "ai_sdk"',
        "requires_openai_auth = true",
        "",
      ].join("\n"),
      "utf8",
    );
    writeFileSync(join(yellowFlowHome, "auth.json"), JSON.stringify({ OPENAI_API_KEY: "sk-test" }, null, 2), "utf8");

    expect(loadStoredProviderConfig()?.provider.apiFlavor).toBe("responses");
  });
});
