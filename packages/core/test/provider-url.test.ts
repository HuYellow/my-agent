import { describe, expect, it } from "vitest";
import { buildLlmEndpointUrl, buildModelsUrl, normalizeProviderBaseUrl } from "../src/services/provider-url.js";

describe("provider URL normalization", () => {
  it("appends /v1 when the user provides a site root", () => {
    expect(normalizeProviderBaseUrl("https://aixj.vip")).toBe("https://aixj.vip/v1/");
    expect(buildModelsUrl("https://aixj.vip")).toBe("https://aixj.vip/v1/models");
    expect(buildLlmEndpointUrl("https://aixj.vip", "responses")).toBe("https://aixj.vip/v1/responses");
  });

  it("keeps an existing /v1 api root intact", () => {
    expect(normalizeProviderBaseUrl("https://aixj.vip/v1")).toBe("https://aixj.vip/v1/");
    expect(buildLlmEndpointUrl("https://aixj.vip/v1", "chat_completions")).toBe("https://aixj.vip/v1/chat/completions");
  });

  it("strips endpoint suffixes back to the api root", () => {
    expect(normalizeProviderBaseUrl("https://aixj.vip/v1/chat/completions")).toBe("https://aixj.vip/v1/");
    expect(normalizeProviderBaseUrl("https://aixj.vip/v1/responses")).toBe("https://aixj.vip/v1/");
  });
});
