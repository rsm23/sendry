import { afterEach, describe, expect, it, vi } from "vitest";
import {
  completeWithAiProvider,
  discoverLocalAiModels,
  embedWithAiProvider,
  streamWithAiProvider,
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

  it("embeds bounded batches through compatible and Ollama endpoints", async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ embedding: [1, 0, 0] }, { embedding: [0, 1, 0] }] }), { status: 200, headers: { "content-type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ embeddings: [[0, 0, 1]] }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(embedWithAiProvider({ provider: "openai", model: "text-embedding-3-small", apiKey: "write-only", baseUrl: "https://embedding.example.test/v1" }, ["one", "two"])).resolves.toEqual([[1, 0, 0], [0, 1, 0]]);
    await expect(embedWithAiProvider({ provider: "ollama", model: "nomic-embed-text", baseUrl: "http://127.0.0.1:11434" }, ["local"])).resolves.toEqual([[0, 0, 1]]);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://embedding.example.test/v1/embeddings");
    expect(fetchMock.mock.calls[1]?.[0]).toBe("http://127.0.0.1:11434/api/embed");
    await expect(embedWithAiProvider({ provider: "anthropic", model: "unsupported", apiKey: "secret" }, ["text"])).rejects.toThrow("does not expose an embeddings API");
  });

  it("yields compatible response deltas without exposing provider metadata", async () => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(new Response('data: {"choices":[{"delta":{"content":"Grounded "}}]}\n\ndata: {"choices":[{"delta":{"content":"answer"}}]}\n\ndata: [DONE]\n\n', { status: 200, headers: { "content-type": "text/event-stream" } })));
    const parts: string[] = [];
    for await (const part of streamWithAiProvider({ provider: "openai", model: "gpt-test", apiKey: "secret" }, "Use evidence.", "Question")) parts.push(part);
    expect(parts).toEqual(["Grounded ", "answer"]);
  });
});
