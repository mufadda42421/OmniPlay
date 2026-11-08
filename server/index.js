
import "dotenv/config";
import express from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { z } from "zod";

const app = express();
const PORT = Number(process.env.PORT || 3001);
const GROQ_API_KEY = process.env.GROQ_API_KEY;

app.disable("x-powered-by");
app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
app.use(express.json({ limit: "32kb" }));

app.use(
  "/api/",
  rateLimit({
    windowMs: 60_000,
    limit: 30,
    standardHeaders: "draft-7",
    legacyHeaders: false,
  })
);

const providers = {
  groq: {
    name: "Groq",
    endpoint: "https://api.groq.com/openai/v1/chat/completions",
    type: "openai",
    models: [
      { id: "openai/gpt-oss-120b", name: "GPT OSS 120B", context: 131072 },
      { id: "openai/gpt-oss-20b", name: "GPT OSS 20B", context: 131072 },
      { id: "qwen/qwen3.8-27b", name: "Qwen 3.8 27B", context: 131072 },
    ],
  },
  openai: {
    name: "OpenAI",
    endpoint: "https://api.openai.com/v1/chat/completions",
    type: "openai",
    models: [
      { id: "gpt-4.1", name: "GPT-4.1", context: 1047576 },
      { id: "gpt-4.1-mini", name: "GPT-4.1 Mini", context: 1047576 },
      { id: "gpt-4.1-nano", name: "GPT-4.1 Nano", context: 1047576 },
      { id: "o4-mini", name: "o4-mini", context: 200000 },
    ],
  },
  gemini: {
    name: "Google Gemini",
    type: "gemini",
    models: [
      { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro", context: 1048576 },
      { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash", context: 1048576 },
      { id: "gemini-2.5-flash-lite", name: "Gemini 2.5 Flash Lite", context: 1048576 },
    ],
  },
  anthropic: {
    name: "Anthropic",
    endpoint: "https://api.anthropic.com/v1/messages",
    type: "anthropic",
    models: [
      { id: "claude-sonnet-4-5", name: "Claude Sonnet 4.5", context: 200000 },
      { id: "claude-haiku-4-5", name: "Claude Haiku 4.5", context: 200000 },
      { id: "claude-opus-4-1", name: "Claude Opus 4.1", context: 200000 },
    ],
  },
  openrouter: {
    name: "OpenRouter",
    endpoint: "https://openrouter.ai/api/v1/chat/completions",
    type: "openai",
    models: [
      { id: "openai/gpt-4.1", name: "GPT-4.1", context: 1047576 },
      { id: "anthropic/claude-sonnet-4", name: "Claude Sonnet", context: 200000 },
      { id: "google/gemini-2.5-flash", name: "Gemini 2.5 Flash", context: 1048576 },
      { id: "deepseek/deepseek-chat-v3-0324", name: "DeepSeek V3", context: 65536 },
      { id: "meta-llama/llama-4-maverick", name: "Llama 4 Maverick", context: 1048576 },
    ],
  },
  mistral: {
    name: "Mistral AI",
    endpoint: "https://api.mistral.ai/v1/chat/completions",
    type: "openai",
    models: [
      { id: "mistral-large-latest", name: "Mistral Large", context: 131072 },
      { id: "mistral-small-latest", name: "Mistral Small", context: 32768 },
      { id: "codestral-latest", name: "Codestral", context: 256000 },
    ],
  },
  cerebras: {
    name: "Cerebras",
    endpoint: "https://api.cerebras.ai/v1/chat/completions",
    type: "openai",
    models: [
      { id: "llama-3.3-70b", name: "Llama 3.3 70B", context: 131072 },
      { id: "qwen-3-32b", name: "Qwen 3 32B", context: 32768 },
      { id: "llama3.1-8b", name: "Llama 3.1 8B", context: 8192 },
    ],
  },
};

function getProviderModels() {
  return Object.entries(providers).flatMap(([providerId, provider]) =>
    provider.models.map((model) => ({
      ...model,
      provider: provider.name,
      providerId,
    }))
  );
}

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    providerConfigured: Boolean(GROQ_API_KEY),
    providers: Object.keys(providers),
  });
});

app.get("/api/models", (req, res) => {
  const providerId = String(req.query.provider || "").toLowerCase();

  if (providerId && providers[providerId]) {
    const provider = providers[providerId];

    return res.json({
      provider: providerId,
      models: provider.models.map((model) => ({
        ...model,
        provider: provider.name,
        providerId,
      })),
    });
  }

  res.json({
    provider: "all",
    models: getProviderModels(),
  });
});

const chatSchema = z.object({
  provider: z
    .enum([
      "groq",
      "openai",
      "gemini",
      "anthropic",
      "openrouter",
      "mistral",
      "cerebras",
    ])
    .optional()
    .default("groq"),
  apiKey: z.string().max(500).optional().default(""),
  model: z.string().min(1).max(200),
  prompt: z.string().trim().min(1).max(24000),
  systemPrompt: z.string().max(12000).optional().default(""),
  temperature: z.number().min(0).max(2).default(0.7),
  maxTokens: z.number().int().min(1).max(8192).default(2048),
});

function sendSSE(res, data) {
  if (!res.destroyed && !res.writableEnded) {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  }
}

function sendTextDelta(res, text) {
  if (!text) return;

  sendSSE(res, {
    choices: [
      {
        index: 0,
        delta: { content: text },
        finish_reason: null,
      },
    ],
  });
}

async function readSSEStream(body, onEvent) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();

    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    let boundary;

    while ((boundary = buffer.indexOf("\n\n")) !== -1) {
      const block = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);

      let event = "";
      let data = "";

      for (const line of block.split("\n")) {
        if (line.startsWith("event:")) {
          event = line.slice(6).trim();
        }

        if (line.startsWith("data:")) {
          data += line.slice(5).trim();
        }
      }

      if (data) {
        await onEvent({ event, data });
      }
    }
  }

  buffer += decoder.decode();

  if (buffer.trim()) {
    let event = "";
    let data = "";

    for (const line of buffer.split("\n")) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      if (line.startsWith("data:")) data += line.slice(5).trim();
    }

    if (data) await onEvent({ event, data });
  }
}

function getMessages(systemPrompt, prompt) {
  return [
    ...(systemPrompt.trim()
      ? [{ role: "system", content: systemPrompt.trim() }]
      : []),
    { role: "user", content: prompt },
  ];
}

async function handleOpenAICompatible({
  provider,
  apiKey,
  model,
  prompt,
  systemPrompt,
  temperature,
  maxTokens,
  signal,
}) {
  const tokenField = provider === "mistral" ? "max_tokens" : "max_completion_tokens";

  const body = {
    model,
    messages: getMessages(systemPrompt, prompt),
    temperature,
    stream: true,
    [tokenField]: maxTokens,
  };

  const headers = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };

  if (provider === "openrouter") {
    headers["HTTP-Referer"] = "http://localhost:5173";
    headers["X-Title"] = "OmniPlay";
  }

  return fetch(providers[provider].endpoint, {
    method: "POST",
    signal,
    headers,
    body: JSON.stringify(body),
  });
}

async function handleGemini({
  apiKey,
  model,
  prompt,
  systemPrompt,
  temperature,
  maxTokens,
  signal,
}) {
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`;

  const body = {
    contents: [
      {
        role: "user",
        parts: [{ text: prompt }],
      },
    ],
    generationConfig: {
      temperature,
      maxOutputTokens: maxTokens,
    },
  };

  if (systemPrompt.trim()) {
    body.systemInstruction = {
      parts: [{ text: systemPrompt.trim() }],
    };
  }

  return fetch(url, {
    method: "POST",
    signal,
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify(body),
  });
}

async function handleAnthropic({
  apiKey,
  model,
  prompt,
  systemPrompt,
  temperature,
  maxTokens,
  signal,
}) {
  const body = {
    model,
    max_tokens: maxTokens,
    temperature,
    messages: [{ role: "user", content: prompt }],
    stream: true,
  };

  if (systemPrompt.trim()) {
    body.system = systemPrompt.trim();
  }

  return fetch(providers.anthropic.endpoint, {
    method: "POST",
    signal,
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

async function sendProviderError(upstream, res) {
  const errorBody = await upstream.text();
  let message = "The model provider rejected the request.";

  try {
    const parsed = JSON.parse(errorBody);
    message =
      parsed?.error?.message ||
      parsed?.message ||
      parsed?.error?.type ||
      message;
  } catch {
    if (errorBody.trim()) message = errorBody.slice(0, 500);
  }

  if (!res.headersSent) {
    res.status(upstream.status).json({ error: message });
  }
}

app.post("/api/chat", async (req, res) => {
  const parsed = chatSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({
      error: "Invalid request",
      details: parsed.error.flatten(),
    });
  }

  const {
    provider,
    apiKey: suppliedApiKey,
    model,
    prompt,
    systemPrompt,
    temperature,
    maxTokens,
  } = parsed.data;

  const providerConfig = providers[provider];

  const modelExists = providerConfig.models.some(
    (item) => item.id === model
  );

  if (!modelExists) {
    return res.status(400).json({
      error: `The selected model is not available for ${providerConfig.name}.`,
    });
  }

  const apiKey =
    suppliedApiKey.trim() ||
    (provider === "groq" ? GROQ_API_KEY : "");

  if (!apiKey) {
    return res.status(401).json({
      error: `Add your ${providerConfig.name} API key in OmniPlay's API Key Manager.`,
    });
  }

  const controller = new AbortController();

  res.on("close", () => {
    if (!res.writableEnded) controller.abort();
  });

  try {
    const requestData = {
      provider,
      apiKey,
      model,
      prompt,
      systemPrompt,
      temperature,
      maxTokens,
      signal: controller.signal,
    };

    let upstream;

    if (provider === "gemini") {
      upstream = await handleGemini(requestData);
    } else if (provider === "anthropic") {
      upstream = await handleAnthropic(requestData);
    } else {
      upstream = await handleOpenAICompatible(requestData);
    }

    if (!upstream.ok) {
      return await sendProviderError(upstream, res);
    }

    if (!upstream.body) {
      return res.status(502).json({
        error: "The provider returned an empty response.",
      });
    }

    res.status(200);
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders?.();

    if (providerConfig.type === "openai") {
      for await (const chunk of upstream.body) {
        if (res.destroyed || controller.signal.aborted) break;
        res.write(chunk);
      }
    } else if (provider === "gemini") {
      await readSSEStream(upstream.body, ({ data }) => {
        if (data === "[DONE]") return;

        try {
          const parsedData = JSON.parse(data);
          const text = parsedData?.candidates?.[0]?.content?.parts
            ?.map((part) => part.text || "")
            .join("");

          sendTextDelta(res, text);
        } catch {
          // Ignore malformed stream fragments.
        }
      });

      sendSSE(res, { choices: [{ index: 0, delta: {}, finish_reason: "stop" }] });
      if (!res.destroyed && !res.writableEnded) {
        res.write("data: [DONE]\n\n");
      }
    } else if (provider === "anthropic") {
      await readSSEStream(upstream.body, ({ event, data }) => {
        try {
          const parsedData = JSON.parse(data);

          if (
            event === "content_block_delta" ||
            parsedData.type === "content_block_delta"
          ) {
            sendTextDelta(res, parsedData.delta?.text || "");
          }
        } catch {
          // Ignore malformed stream fragments.
        }
      });

      sendSSE(res, { choices: [{ index: 0, delta: {}, finish_reason: "stop" }] });
      if (!res.destroyed && !res.writableEnded) {
        res.write("data: [DONE]\n\n");
      }
    }

    if (!res.destroyed && !res.writableEnded) {
      res.end();
    }
  } catch (error) {
    if (error.name === "AbortError") return;

    console.error("Chat request failed:", error.message);

    if (!res.headersSent) {
      res.status(502).json({
        error: "Unable to reach the model provider. Please try again.",
      });
    } else if (!res.destroyed) {
      sendSSE(res, {
        error: "The stream ended unexpectedly.",
      });
      res.end();
    }
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`OmniPlay API listening on http://localhost:${PORT}`);
  console.log(
    `Groq fallback key: ${GROQ_API_KEY ? "configured" : "not configured"}`
  );
  console.log("Supported providers:", Object.keys(providers).join(", "));
});
