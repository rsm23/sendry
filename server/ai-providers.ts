import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export const AI_PROVIDER_IDS = [
  "openai",
  "anthropic",
  "mistral",
  "zai",
  "moonshot",
  "openrouter",
  "lmstudio",
  "ollama",
] as const;

export type AiProviderId = (typeof AI_PROVIDER_IDS)[number];

export type AiProviderSettings = {
  provider: AiProviderId | "";
  model: string;
  baseUrl?: string;
  apiKey?: string;
};

const HOSTED_PROVIDERS: Record<
  Exclude<AiProviderId, "lmstudio" | "ollama">,
  { baseUrl: string }
> = {
  openai: { baseUrl: "https://api.openai.com/v1" },
  anthropic: { baseUrl: "https://api.anthropic.com/v1" },
  mistral: { baseUrl: "https://api.mistral.ai/v1" },
  zai: { baseUrl: "https://api.z.ai/api/paas/v4" },
  moonshot: { baseUrl: "https://api.moonshot.ai/v1" },
  openrouter: { baseUrl: "https://openrouter.ai/api/v1" },
};

export function isLocalAiProvider(
  provider: string,
): provider is "lmstudio" | "ollama" {
  return provider === "lmstudio" || provider === "ollama";
}

function allowedLocalAddress(address: string) {
  if (address === "::1" || address.startsWith("fc") || address.startsWith("fd"))
    return true;
  if (isIP(address) !== 4) return false;
  const parts = address.split(".").map(Number);
  return (
    parts[0] === 10 ||
    parts[0] === 127 ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 192 && parts[1] === 168)
  );
}

async function assertLocalAiEndpoint(url: URL) {
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password
  )
    throw new Error("A private HTTP or HTTPS endpoint is required");
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  if (hostname === "localhost" || hostname.endsWith(".localhost")) return;
  if (isIP(hostname)) {
    if (!allowedLocalAddress(hostname))
      throw new Error("The endpoint must use a loopback or private network address");
    return;
  }
  const addresses = await lookup(hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(({ address }) => !allowedLocalAddress(address)))
    throw new Error("The endpoint must resolve only to private network addresses");
}

export function normalizeLocalAiBaseUrl(
  provider: "lmstudio" | "ollama",
  value?: string,
) {
  const fallback =
    provider === "lmstudio"
      ? "http://127.0.0.1:1234/v1"
      : "http://127.0.0.1:11434";
  const url = new URL(value?.trim() || fallback);
  url.search = "";
  url.hash = "";
  let path = url.pathname.replace(/\/+$/, "");
  if (provider === "lmstudio" && !path.endsWith("/v1")) path = `${path}/v1`;
  if (provider === "ollama" && path.endsWith("/api")) path = path.slice(0, -4);
  url.pathname = path || "/";
  return url.toString().replace(/\/$/, "");
}

function endpoint(baseUrl: string, suffix: string) {
  return `${baseUrl.replace(/\/$/, "")}/${suffix.replace(/^\//, "")}`;
}

async function readJson(response: Response) {
  const length = Number(response.headers.get("content-length") || 0);
  if (length > 2_000_000) throw new Error("The provider response is too large");
  const text = await response.text();
  if (text.length > 2_000_000) throw new Error("The provider response is too large");
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error("The provider returned an invalid JSON response");
  }
}

function providerMessage(payload: Record<string, unknown>) {
  const error = payload.error;
  if (typeof error === "string") return error;
  if (error && typeof error === "object") {
    const message = (error as Record<string, unknown>).message;
    if (typeof message === "string") return message;
  }
  return "The provider rejected the request";
}

async function fetchProviderJson(
  url: string,
  init: RequestInit,
  apiKey?: string,
) {
  const response = await fetch(url, {
    ...init,
    redirect: "error",
    signal: AbortSignal.timeout(45_000),
  });
  const payload = await readJson(response);
  if (!response.ok) {
    const message = providerMessage(payload);
    const redacted = apiKey ? message.replaceAll(apiKey, "••••") : message;
    throw new Error(`AI provider request failed (${response.status}): ${redacted}`);
  }
  return payload;
}

export async function discoverLocalAiModels(
  provider: "lmstudio" | "ollama",
  value?: string,
) {
  const baseUrl = normalizeLocalAiBaseUrl(provider, value);
  const parsed = new URL(baseUrl);
  await assertLocalAiEndpoint(parsed);
  const url =
    provider === "lmstudio"
      ? endpoint(baseUrl, "models")
      : endpoint(baseUrl, "api/tags");
  const payload = await fetchProviderJson(url, { method: "GET" });
  const models =
    provider === "lmstudio"
      ? Array.isArray(payload.data)
        ? payload.data
            .map((item) =>
              item && typeof item === "object"
                ? String((item as Record<string, unknown>).id ?? "")
                : "",
            )
            .filter(Boolean)
        : []
      : Array.isArray(payload.models)
        ? payload.models
            .map((item) =>
              item && typeof item === "object"
                ? String(
                    (item as Record<string, unknown>).model ??
                      (item as Record<string, unknown>).name ??
                      "",
                  )
                : "",
            )
            .filter(Boolean)
        : [];
  return { baseUrl, models: [...new Set(models)].sort() };
}

function textFromCompatibleResponse(payload: Record<string, unknown>) {
  const choices = payload.choices;
  if (!Array.isArray(choices)) return "";
  const first = choices[0];
  if (!first || typeof first !== "object") return "";
  const message = (first as Record<string, unknown>).message;
  if (!message || typeof message !== "object") return "";
  const content = (message as Record<string, unknown>).content;
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  return content
    .map((part) =>
      part && typeof part === "object"
        ? String((part as Record<string, unknown>).text ?? "")
        : "",
    )
    .join("")
    .trim();
}

async function completeAnthropic(
  settings: AiProviderSettings,
  instructions: string,
  input: string,
) {
  const apiKey = settings.apiKey;
  if (!apiKey) return null;
  const payload = await fetchProviderJson(
    endpoint(HOSTED_PROVIDERS.anthropic.baseUrl, "messages"),
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: settings.model,
        max_tokens: 4096,
        system: instructions,
        messages: [{ role: "user", content: input }],
      }),
    },
    apiKey,
  );
  if (!Array.isArray(payload.content)) return "";
  return payload.content
    .map((part) =>
      part && typeof part === "object" &&
      (part as Record<string, unknown>).type === "text"
        ? String((part as Record<string, unknown>).text ?? "")
        : "",
    )
    .join("")
    .trim();
}

async function completeOllama(
  settings: AiProviderSettings,
  instructions: string,
  input: string,
) {
  const baseUrl = normalizeLocalAiBaseUrl("ollama", settings.baseUrl);
  await assertLocalAiEndpoint(new URL(baseUrl));
  const payload = await fetchProviderJson(endpoint(baseUrl, "api/chat"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: settings.model,
      stream: false,
      messages: [
        { role: "system", content: instructions },
        { role: "user", content: input },
      ],
    }),
  });
  const message = payload.message;
  return message && typeof message === "object"
    ? String((message as Record<string, unknown>).content ?? "").trim()
    : "";
}

async function completeCompatible(
  settings: AiProviderSettings,
  instructions: string,
  input: string,
) {
  const local = settings.provider === "lmstudio";
  if (!local && !settings.apiKey) return null;
  const baseUrl = local
    ? normalizeLocalAiBaseUrl("lmstudio", settings.baseUrl)
    : HOSTED_PROVIDERS[
        settings.provider as Exclude<AiProviderId, "anthropic" | "lmstudio" | "ollama">
      ].baseUrl;
  if (local) await assertLocalAiEndpoint(new URL(baseUrl));
  const apiKey = settings.apiKey;
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (apiKey) headers.authorization = `Bearer ${apiKey}`;
  const payload = await fetchProviderJson(
    endpoint(baseUrl, "chat/completions"),
    {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: settings.model,
        messages: [
          { role: "system", content: instructions },
          { role: "user", content: input },
        ],
      }),
    },
    apiKey,
  );
  return textFromCompatibleResponse(payload);
}

export async function completeWithAiProvider(
  settings: AiProviderSettings,
  instructions: string,
  input: string,
) {
  if (!settings.provider || !settings.model.trim()) return null;
  if (settings.provider === "anthropic")
    return completeAnthropic(settings, instructions, input);
  if (settings.provider === "ollama")
    return completeOllama(settings, instructions, input);
  return completeCompatible(settings, instructions, input);
}
