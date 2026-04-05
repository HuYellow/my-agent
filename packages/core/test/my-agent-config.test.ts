import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  ensureStoredProviderConfig,
  getDefaultMyAgentHomeDir,
  loadStoredProviderConfig,
  parseTomlDocument,
  serializeTomlDocument,
  syncStoredProviderConfig,
  watchStoredConfig,
} from "../src/services/my-agent-config.js";

const ORIGINAL_MY_AGENT_HOME = process.env.MY_AGENT_HOME;

afterEach(() => {
  if (ORIGINAL_MY_AGENT_HOME === undefined) {
    delete process.env.MY_AGENT_HOME;
  } else {
    process.env.MY_AGENT_HOME = ORIGINAL_MY_AGENT_HOME;
  }
});

describe("my-agent file config integration", () => {
  it("loads provider and auth from ~/.my-agent files", () => {
    const myAgentHome = mkdtempSync(join(tmpdir(), "my-agent-home-"));
    process.env.MY_AGENT_HOME = myAgentHome;
    writeFileSync(
      join(myAgentHome, "config.toml"),
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
    writeFileSync(join(myAgentHome, "auth.json"), JSON.stringify({ OPENAI_API_KEY: "sk-test" }, null, 2), "utf8");

    const loaded = loadStoredProviderConfig();

    expect(getDefaultMyAgentHomeDir()).toBe(myAgentHome);
    expect(loaded?.provider).toMatchObject({
      id: "my-agent:sub2api",
      name: "sub2api",
      baseUrl: "https://aixj.vip",
      apiKey: "sk-test",
      model: "gpt-5.4",
      apiFlavor: "responses",
      reasoningEffort: "high",
    });
  });

  it("syncs provider changes back to config.toml and auth.json", () => {
    const myAgentHome = mkdtempSync(join(tmpdir(), "my-agent-home-"));
    process.env.MY_AGENT_HOME = myAgentHome;

    syncStoredProviderConfig({
      id: "codex:sub2api",
      name: "sub2api",
      baseUrl: "https://api.deepseek.com",
      apiKey: "sk-new",
      model: "deepseek-chat",
      apiFlavor: "responses",
      reasoningEffort: "minimal",
    });

    expect(existsSync(join(myAgentHome, "config.toml"))).toBe(true);
    expect(readFileSync(join(myAgentHome, "auth.json"), "utf8")).toContain("sk-new");

    const loaded = loadStoredProviderConfig();
    expect(loaded?.provider).toMatchObject({
      id: "my-agent:sub2api",
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
    const myAgentHome = mkdtempSync(join(tmpdir(), "my-agent-home-"));
    process.env.MY_AGENT_HOME = myAgentHome;
    writeFileSync(
      join(myAgentHome, "config.toml"),
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

    writeFileSync(join(myAgentHome, "auth.json"), JSON.stringify({ OPENAI_API_KEY: "sk-live" }, null, 2), "utf8");

    await changed;
  });

  it("creates missing config files from the current provider", () => {
    const myAgentHome = mkdtempSync(join(tmpdir(), "my-agent-home-"));
    process.env.MY_AGENT_HOME = myAgentHome;

    ensureStoredProviderConfig({
      id: "default-provider",
      name: "DeepSeek",
      baseUrl: "https://api.deepseek.com",
      apiKey: "sk-live",
      model: "deepseek-chat",
      apiFlavor: "responses",
      reasoningEffort: "minimal",
    });

    expect(existsSync(join(myAgentHome, "config.toml"))).toBe(true);
    expect(existsSync(join(myAgentHome, "auth.json"))).toBe(true);
  });
});
