import { afterEach, describe, expect, it, vi } from "vitest";
import {
  completeWithAiProvider,
  discoverLocalAiModels,
} from "../server/ai-providers";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("AI providers", () => {
  it("discovers LM Studio and Ollama models from their private APIs", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ data: [{ id: "qwen/local" }, { id: "gemma/local" }] }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ models: [{ model: "llama3.3" }, { name: "mistral" }] }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      discoverLocalAiModels("lmstudio", "http://127.0.0.1:1234"),
    ).resolves.toEqual({
      baseUrl: "http://127.0.0.1:1234/v1",
      models: ["gemma/local", "qwen/local"],
    });
    await expect(
      discoverLocalAiModels("ollama", "http://127.0.0.1:11434/api"),
    ).resolves.toEqual({
      baseUrl: "http://127.0.0.1:11434",
      models: ["llama3.3", "mistral"],
    });
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "http://127.0.0.1:1234/v1/models",
    );
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      "http://127.0.0.1:11434/api/tags",
    );
  });

  it("routes OpenAI-compatible hosted providers without exposing the key", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { role: "assistant", content: "Ready" } }],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      completeWithAiProvider(
        {
          provider: "moonshot",
          model: "kimi-k2.6",
          apiKey: "moonshot-private-test",
        },
        "Be concise.",
        "Draft a subject.",
      ),
    ).resolves.toBe("Ready");
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://api.moonshot.ai/v1/chat/completions",
    );
    const request = fetchMock.mock.calls[0]?.[1];
    expect(request?.headers).toMatchObject({
      authorization: "Bearer moonshot-private-test",
    });
  });

  it("uses the Ollama chat API and blocks public endpoints for local providers", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({ message: { role: "assistant", content: "Local answer" } }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      completeWithAiProvider(
        {
          provider: "ollama",
          model: "llama3.3",
          baseUrl: "http://127.0.0.1:11434",
        },
        "Be concise.",
        "Draft a subject.",
      ),
    ).resolves.toBe("Local answer");
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "http://127.0.0.1:11434/api/chat",
    );
    await expect(
      discoverLocalAiModels("ollama", "https://8.8.8.8"),
    ).rejects.toThrow("loopback or private network");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
