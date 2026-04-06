import { type ProviderCapabilities, type ProviderProfile, type RuntimeRunMode } from "@my-agent/protocol";

export function detectProviderCapabilities(provider: ProviderProfile): ProviderCapabilities {
  const normalizedBaseUrl = provider.baseUrl.trim().toLowerCase();
  const supportsResponses = provider.apiFlavor === "responses";
  const supportsChatCompletions = provider.apiFlavor === "chat_completions";
  const notes: string[] = [];
  let recommendedRunMode: RuntimeRunMode = "full-tools";
  let supportsTools = supportsResponses;
  let supportsResumableApprovals = supportsResponses;

  if (normalizedBaseUrl.includes("aixj.vip")) {
    notes.push("Responses API works, but tool-enabled agent runtime may be unstable on this provider.");
    recommendedRunMode = "no-tools";
    supportsTools = false;
    supportsResumableApprovals = false;
  }

  return {
    apiFlavor: provider.apiFlavor,
    supportsResponses,
    supportsChatCompletions,
    supportsTools,
    supportsStreaming: true,
    supportsResumableApprovals,
    recommendedRunMode,
    notes,
  };
}
