import type { Brand } from "@/lib/auth";

export const AI_PROVIDER_OPTIONS = [
  {
    id: "openai",
    name: "OpenAI",
    kind: "hosted",
    detail: "OpenAI models through the official platform API.",
    defaultModel: "gpt-5-mini",
  },
  {
    id: "anthropic",
    name: "Anthropic",
    kind: "hosted",
    detail: "Claude models through the Anthropic Messages API.",
    defaultModel: "claude-sonnet-4-5",
  },
  {
    id: "mistral",
    name: "Mistral AI",
    kind: "hosted",
    detail: "Mistral models through the official chat completions API.",
    defaultModel: "mistral-small-latest",
  },
  {
    id: "zai",
    name: "Z.ai",
    kind: "hosted",
    detail: "GLM models through the Z.ai OpenAI-compatible API.",
    defaultModel: "glm-5.1",
  },
  {
    id: "moonshot",
    name: "Moonshot AI",
    kind: "hosted",
    detail: "Kimi models through Moonshot's OpenAI-compatible API.",
    defaultModel: "kimi-k2.6",
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    kind: "hosted",
    detail: "Use one key to route requests across the OpenRouter model catalog.",
    defaultModel: "openai/gpt-5-mini",
  },
  {
    id: "lmstudio",
    name: "LM Studio",
    kind: "local",
    detail: "Run downloaded models on your own machine through LM Studio.",
    defaultModel: "",
    defaultBaseUrl: "http://127.0.0.1:1234/v1",
  },
  {
    id: "ollama",
    name: "Ollama",
    kind: "local",
    detail: "Discover and run models from a private Ollama server.",
    defaultModel: "",
    defaultBaseUrl: "http://127.0.0.1:11434",
  },
] as const;

export type AiProviderId = (typeof AI_PROVIDER_OPTIONS)[number]["id"];

export function aiProviderById(value: unknown) {
  return AI_PROVIDER_OPTIONS.find((provider) => provider.id === value);
}

export function aiProviderConfiguration(value: Brand) {
  return value.ai_provider_config &&
    typeof value.ai_provider_config === "object"
    ? (value.ai_provider_config as Record<string, unknown>)
    : {};
}

export function aiConfigurationReady(value: Brand) {
  if (!value.ai_enabled) return true;
  const provider = aiProviderById(value.ai_provider);
  if (!provider) return false;
  const configuration = aiProviderConfiguration(value);
  if (!String(configuration.model || "").trim()) return false;
  if (provider.kind === "local")
    return Boolean(String(configuration.baseUrl || "").trim());
  return Boolean(
    String(value.ai_api_key || "").trim() ||
      value.ai_api_key_configured ||
      value.ai_server_key_configured,
  );
}
