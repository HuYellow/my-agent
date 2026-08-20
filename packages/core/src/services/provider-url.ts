import { type ApiFlavor } from "@yellow-flow/protocol";

export function normalizeProviderBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim();

  if (!trimmed) {
    return "";
  }

  const url = new URL(ensureTrailingSlash(trimmed));
  const normalizedPath = normalizeApiBasePath(url.pathname);
  url.pathname = ensureTrailingSlash(normalizedPath);
  url.search = "";
  url.hash = "";
  return url.toString();
}

export function buildModelsUrl(baseUrl: string): string {
  return new URL("models", normalizeProviderBaseUrl(baseUrl)).toString();
}

export function buildLlmEndpointUrl(baseUrl: string, apiFlavor: ApiFlavor): string {
  const endpoint = apiFlavor === "responses" ? "responses" : "chat/completions";
  return new URL(endpoint, normalizeProviderBaseUrl(baseUrl)).toString();
}

function normalizeApiBasePath(pathname: string): string {
  const rawSegments = pathname
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean);
  const segments = stripKnownEndpointSuffix(rawSegments);

  if (segments.length === 0) {
    return "/v1";
  }

  if (segments[segments.length - 1] === "v1") {
    return `/${segments.join("/")}`;
  }

  if (segments.length >= 2 && segments[segments.length - 2] === "v1") {
    return `/${segments.slice(0, -1).join("/")}`;
  }

  return `/${segments.join("/")}/v1`;
}

function stripKnownEndpointSuffix(segments: string[]): string[] {
  if (segments.length >= 3 && segments.at(-3) === "v1" && segments.at(-2) === "chat" && segments.at(-1) === "completions") {
    return segments.slice(0, -2);
  }

  if (segments.length >= 2 && segments.at(-2) === "v1" && segments.at(-1) === "responses") {
    return segments.slice(0, -1);
  }

  if (segments.length >= 2 && segments.at(-2) === "v1" && segments.at(-1) === "models") {
    return segments.slice(0, -1);
  }

  return segments;
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}
