// Vercel Edge Function — proxies browser requests to the target AI provider.
// Injects Authorization from the client's `x-provider-key` header, and passes
// SSE streaming responses back unchanged so OpenAI SDK streaming works.

export const config = { runtime: "edge" };

const TARGETS: Record<string, string> = {
  openai: "https://api.openai.com",
  nvidia: "https://integrate.api.nvidia.com",
  anthropic: "https://api.anthropic.com",
  openrouter: "https://openrouter.ai",
  google: "https://generativelanguage.googleapis.com",
};

const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "transfer-encoding",
  "te",
  "trailer",
  "upgrade",
  "proxy-authorization",
  "proxy-authenticate",
]);

export default async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url);

  // Path can come from either the rewrite (__p query) or the original pathname.
  let rawPath = url.searchParams.get("__p") ?? "";
  if (!rawPath) {
    const m = url.pathname.match(/^\/api\/proxy\/?(.*)$/);
    rawPath = m ? m[1] : "";
  }
  if (!rawPath) {
    return json({ error: "Missing proxy path." }, 400);
  }

  const [providerKey, ...rest] = rawPath.split("/");
  const upstreamPath = "/" + rest.join("/");

  let upstreamBase: string | undefined = TARGETS[providerKey];
  if (providerKey === "custom") {
    const target = url.searchParams.get("target");
    if (!target) return json({ error: "Missing ?target=<base-url>" }, 400);
    try {
      const parsed = new URL(target);
      upstreamBase = `${parsed.protocol}//${parsed.host}${parsed.pathname.replace(/\/$/, "")}`;
    } catch {
      return json({ error: "Invalid ?target URL" }, 400);
    }
  }
  if (!upstreamBase) {
    return json({ error: `Unknown provider "${providerKey}"` }, 400);
  }

  const forwardedParams = new URLSearchParams(url.searchParams);
  forwardedParams.delete("target");
  forwardedParams.delete("__p");

  const providerToken = req.headers.get("x-provider-key");

  // Google's Generative Language API uses query parameter auth
  if (providerKey === "google" && providerToken) {
    forwardedParams.set("key", providerToken);
  }

  const qs = forwardedParams.toString();
  let targetURL = upstreamBase + upstreamPath + (qs ? "?" + qs : "");
  // Failsafe: if the base URL and upstream path both included /v1, resolve duplicate "/v1/v1/"
  targetURL = targetURL.replace(/\/v1\/v1\//g, "/v1/");

  const outHeaders = new Headers();
  req.headers.forEach((value, key) => {
    const k = key.toLowerCase();
    if (HOP_BY_HOP.has(k)) return;
    if (k === "host" || k === "origin" || k === "referer") return;
    if (k === "cookie") return;
    if (k === "x-provider-key") return;
    if (k === "x-provider-cookie") return;
    if (k.startsWith("x-vercel-") || k.startsWith("cf-") || k.startsWith("sec-")) return;
    outHeaders.set(key, value);
  });

  if (providerToken && providerKey !== "google") {
    if (upstreamPath.includes("/messages") || providerKey === "anthropic") {
      outHeaders.set("x-api-key", providerToken);
    } else {
      outHeaders.set("Authorization", `Bearer ${providerToken}`);
    }
  }

  const providerCookie = req.headers.get("x-provider-cookie");
  if (providerCookie) {
    outHeaders.set("Cookie", providerCookie);
  }

  const method = req.method.toUpperCase();
  const hasBody = method !== "GET" && method !== "HEAD";

  // Google Gemini requires special translation from OpenAI format
  if (providerKey === "google" && upstreamPath.includes("/chat/completions")) {
    if (!providerToken) {
      return json({ error: "Missing API key for Google provider" }, 401);
    }
    return handleGoogleChatCompletion(req, providerToken);
  }

  try {
    const upstream = await fetch(targetURL, {
      method,
      headers: outHeaders,
      body: hasBody ? await req.arrayBuffer() : undefined,
      redirect: "follow",
    });

    const respHeaders = new Headers();
    upstream.headers.forEach((v, k) => {
      const lk = k.toLowerCase();
      if (HOP_BY_HOP.has(lk)) return;
      if (lk === "content-encoding" || lk === "content-length") return;
      respHeaders.set(k, v);
    });

    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: respHeaders,
    });
  } catch (err) {
    return json(
      { error: err instanceof Error ? err.message : "Proxy fetch failed" },
      502
    );
  }
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function handleGoogleChatCompletion(
  req: Request,
  apiKey: string
): Promise<Response> {
  let openaiBody: any;
  try {
    openaiBody = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const model = openaiBody.model || "gemini-pro";
  const messages = openaiBody.messages || [];
  const stream = openaiBody.stream === true;

  const contents: any[] = [];
  let systemInstruction: string | undefined;

  for (const msg of messages) {
    if (msg.role === "system") {
      systemInstruction = typeof msg.content === "string" ? msg.content : "";
      continue;
    }

    const role = msg.role === "assistant" ? "model" : "user";
    const parts: any[] = [];

    if (typeof msg.content === "string") {
      if (msg.content.trim()) {
        parts.push({ text: msg.content });
      }
    } else if (Array.isArray(msg.content)) {
      for (const part of msg.content) {
        if (part.type === "text" && part.text) {
          parts.push({ text: part.text });
        } else if (part.type === "image_url") {
          const url = part.image_url?.url || "";
          if (url.startsWith("data:")) {
            const match = url.match(/^data:(.*?);base64,(.*)$/);
            if (match) {
              parts.push({
                inlineData: {
                  mimeType: match[1],
                  data: match[2],
                },
              });
            }
          }
        }
      }
    }

    if (parts.length > 0) {
      contents.push({ role, parts });
    }
  }

  if (contents.length === 0) {
    contents.push({
      role: "user",
      parts: [{ text: "Hello" }],
    });
  }

  const googleBody: any = {
    contents,
  };

  const generationConfig: any = {};
  if (openaiBody.temperature !== undefined) {
    generationConfig.temperature = openaiBody.temperature;
  }
  if (openaiBody.max_tokens || openaiBody.max_completion_tokens) {
    generationConfig.maxOutputTokens = openaiBody.max_tokens || openaiBody.max_completion_tokens;
  }
  if (openaiBody.top_p !== undefined) {
    generationConfig.topP = openaiBody.top_p;
  }

  if (Object.keys(generationConfig).length > 0) {
    googleBody.generationConfig = generationConfig;
  }

  if (systemInstruction) {
    googleBody.systemInstruction = { parts: [{ text: systemInstruction }] };
  }

  const endpoint = stream ? "streamGenerateContent" : "generateContent";
  const googleUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:${endpoint}?key=${encodeURIComponent(apiKey)}`;

  try {
    const upstream = await fetch(googleUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(googleBody),
    });

    if (!upstream.ok) {
      const errorText = await upstream.text();
      try {
        const errorJson = JSON.parse(errorText);
        const errorMsg = errorJson.error?.message || errorText;
        return json({
          error: {
            message: errorMsg,
            type: "google_api_error",
            code: errorJson.error?.code || upstream.status,
          }
        }, upstream.status);
      } catch {
        return json({
          error: {
            message: errorText,
            type: "google_api_error",
            code: upstream.status,
          }
        }, upstream.status);
      }
    }

    if (stream) {
      return streamGoogleResponse(upstream);
    } else {
      return convertGoogleResponse(await upstream.json());
    }
  } catch (err) {
    return json(
      { error: err instanceof Error ? err.message : "Google API request failed" },
      502
    );
  }
}

function convertGoogleResponse(googleResp: any): Response {
  const candidate = googleResp.candidates?.[0];
  const content = candidate?.content;
  const parts = content?.parts || [];
  const text = parts.map((p: any) => p.text || "").join("");

  const openaiResp = {
    id: `chatcmpl-${Date.now()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: googleResp.modelVersion || "gemini-pro",
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: text,
        },
        finish_reason: candidate?.finishReason?.toLowerCase() || "stop",
      },
    ],
    usage: {
      prompt_tokens: googleResp.usageMetadata?.promptTokenCount || 0,
      completion_tokens: googleResp.usageMetadata?.candidatesTokenCount || 0,
      total_tokens: googleResp.usageMetadata?.totalTokenCount || 0,
    },
  };

  return json(openaiResp, 200);
}

function streamGoogleResponse(upstream: Response): Response {
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  (async () => {
    try {
      const reader = upstream.body?.getReader();
      if (!reader) {
        await writer.close();
        return;
      }

      let buffer = "";
      const chatId = `chatcmpl-${Date.now()}`;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        let startIdx = 0;
        while (startIdx < buffer.length) {
          const objStart = buffer.indexOf("{", startIdx);
          if (objStart === -1) break;

          let braceCount = 0;
          let objEnd = -1;
          for (let i = objStart; i < buffer.length; i++) {
            if (buffer[i] === "{") braceCount++;
            if (buffer[i] === "}") {
              braceCount--;
              if (braceCount === 0) {
                objEnd = i + 1;
                break;
              }
            }
          }

          if (objEnd !== -1) {
            const chunk = buffer.substring(objStart, objEnd);
            try {
              const googleChunk = JSON.parse(chunk);
              const candidate = googleChunk.candidates?.[0];

              if (candidate) {
                const parts = candidate?.content?.parts || [];
                const text = parts.map((p: any) => p.text || "").join("");

                if (text) {
                  const openaiChunk = {
                    id: chatId,
                    object: "chat.completion.chunk",
                    created: Math.floor(Date.now() / 1000),
                    model: "gemini-pro",
                    choices: [
                      {
                        index: 0,
                        delta: { content: text },
                        finish_reason: null,
                      },
                    ],
                  };

                  await writer.write(
                    encoder.encode(`data: ${JSON.stringify(openaiChunk)}\n\n`)
                  );
                }

                if (candidate?.finishReason) {
                  const finalChunk = {
                    id: chatId,
                    object: "chat.completion.chunk",
                    created: Math.floor(Date.now() / 1000),
                    model: "gemini-pro",
                    choices: [
                      {
                        index: 0,
                        delta: {},
                        finish_reason: "stop",
                      },
                    ],
                  };
                  await writer.write(
                    encoder.encode(`data: ${JSON.stringify(finalChunk)}\n\n`)
                  );
                }

                if (googleChunk.usageMetadata) {
                  const usageChunk = {
                    id: chatId,
                    object: "chat.completion.chunk",
                    created: Math.floor(Date.now() / 1000),
                    model: "gemini-pro",
                    choices: [],
                    usage: {
                      prompt_tokens: googleChunk.usageMetadata.promptTokenCount || 0,
                      completion_tokens: googleChunk.usageMetadata.candidatesTokenCount || 0,
                      total_tokens: googleChunk.usageMetadata.totalTokenCount || 0,
                    },
                  };
                  await writer.write(
                    encoder.encode(`data: ${JSON.stringify(usageChunk)}\n\n`)
                  );
                }
              }
            } catch (e) {
              // Skip malformed JSON
            }

            startIdx = objEnd;
          } else {
            break;
          }
        }

        buffer = buffer.substring(startIdx);
      }

      await writer.write(encoder.encode("data: [DONE]\n\n"));
      await writer.close();
    } catch (err) {
      console.error("Stream error:", err);
      try {
        await writer.abort(err);
      } catch (abortErr) {
        // Writer already closed
      }
    }
  })();

  return new Response(readable, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
