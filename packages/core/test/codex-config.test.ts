import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  getDefaultCodexHomeDir,
  loadExternalCodexProvider,
  parseTomlDocument,
  serializeTomlDocument,
  syncExternalCodexProvider,
  watchExternalCodexConfig,
} from "../src/services/codex-config.js";

const ORIGINAL_CODEX_HOME = process.env.CODEX_HOME;
const ORIGINAL_MY_AGENT_CODEX_HOME = process.env.MY_AGENT_CODEX_HOME;

afterEach(() => {
  if (ORIGINAL_CODEX_HOME === undefined) {
    delete process.env.CODEX_HOME;
  } else {
    process.env.CODEX_HOME = ORIGINAL_CODEX_HOME;
  }

  if (ORIGINAL_MY_AGENT_CODEX_HOME === undefined) {
    delete process.env.MY_AGENT_CODEX_HOME;
  } else {
    process.env.MY_AGENT_CODEX_HOME = ORIGINAL_MY_AGENT_CODEX_HOME;
  }
});

describe("codex config integration", () => {
  it("loads provider and auth from ~/.codex-style files", () => {
    const codexHome = mkdtempSync(join(tmpdir(), "my-agent-codex-"));
    process.env.MY_AGENT_CODEX_HOME = codexHome;
    writeFileSync(
      join(codexHome, "config.toml"),
      [
        'model_provider = "aixj"',
        'model = "gpt-5.4"',
        "",
        "[model_providers.aixj]",
        'name = "aixj"',
        'base_url = "https://aixj.vip"',
        'wire_api = "responses"',
        "requires_openai_auth = true",
        "",
      ].join("\n"),
      "utf8",
    );
    writeFileSync(join(codexHome, "auth.json"), JSON.stringify({ OPENAI_API_KEY: "sk-test" }, null, 2), "utf8");

    const loaded = loadExternalCodexProvider();

    expect(getDefaultCodexHomeDir()).toBe(codexHome);
    expect(loaded?.provider).toMatchObject({
      id: "codex:aixj",
      name: "aixj",
      baseUrl: "https://aixj.vip",
      apiKey: "sk-test",
      model: "gpt-5.4",
      apiFlavor: "responses",
    });
  });

  it("syncs provider changes back to config.toml and auth.json", () => {
    const codexHome = mkdtempSync(join(tmpdir(), "my-agent-codex-"));
    process.env.MY_AGENT_CODEX_HOME = codexHome;
    writeFileSync(
      join(codexHome, "config.toml"),
      [
        'model_provider = "aixj"',
        'model = "gpt-5.4"',
        "",
        "[model_providers.aixj]",
        'name = "aixj"',
        'base_url = "https://aixj.vip"',
        'wire_api = "responses"',
        "requires_openai_auth = true",
        "",
      ].join("\n"),
      "utf8",
    );
    writeFileSync(join(codexHome, "auth.json"), JSON.stringify({ OPENAI_API_KEY: "sk-old" }, null, 2), "utf8");

    syncExternalCodexProvider({
      id: "codex:aixj",
      name: "aixj",
      baseUrl: "https://aixj.vip",
      apiKey: "sk-new",
      model: "gpt-5.5",
      apiFlavor: "responses",
    });

    expect(existsSync(join(codexHome, "config.toml"))).toBe(true);
    expect(readFileSync(join(codexHome, "auth.json"), "utf8")).toContain("sk-new");

    const loaded = loadExternalCodexProvider();
    expect(loaded?.provider.model).toBe("gpt-5.5");
    expect(loaded?.provider.apiKey).toBe("sk-new");
  });

  it("round-trips generic TOML sections used by provider config", () => {
    const document = parseTomlDocument([
      'model_provider = "aixj"',
      'model = "gpt-5.4"',
      "",
      "[model_providers.aixj]",
      'base_url = "https://aixj.vip"',
      'wire_api = "responses"',
      "",
      "[features]",
      "chat_enabled = false",
      "",
    ].join("\n"));

    const serialized = serializeTomlDocument(document);

    expect(serialized).toContain('[model_providers.aixj]');
    expect(serialized).toContain('[features]');
    expect(serialized).toContain('wire_api = "responses"');
  });

  it("watches config file changes", async () => {
    const codexHome = mkdtempSync(join(tmpdir(), "my-agent-codex-"));
    process.env.MY_AGENT_CODEX_HOME = codexHome;
    writeFileSync(
      join(codexHome, "config.toml"),
      [
        'model_provider = "aixj"',
        'model = "gpt-5.4"',
        "",
        "[model_providers.aixj]",
        'name = "aixj"',
        'base_url = "https://aixj.vip"',
        'wire_api = "responses"',
        "requires_openai_auth = true",
        "",
      ].join("\n"),
      "utf8",
    );

    const changed = new Promise<void>((resolve) => {
      const stop = watchExternalCodexConfig(() => {
        stop();
        resolve();
      });
    });

    writeFileSync(join(codexHome, "auth.json"), JSON.stringify({ OPENAI_API_KEY: "sk-live" }, null, 2), "utf8");

    await changed;
  });
});
