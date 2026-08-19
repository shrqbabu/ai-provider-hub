export const config = { runtime: "edge" };

const TARGETS: Record<string, string> = {
  openai: "https://api.openai.com",
  nvidia: "https://integrate.api.nvidia.com",
  anthropic: "https://api.anthropic.com",
  openrouter: "https://openrouter.ai",
  google: "https://generativelanguage.googleapis.com",
  antigravity: "https://cloudcode-pa.googleapis.com",
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

  if (providerKey === "google" && providerToken && !providerToken.startsWith("ya29.")) {
    forwardedParams.set("key", providerToken);
  }

  const qs = forwardedParams.toString();
  let targetURL = upstreamBase + upstreamPath + (qs ? "?" + qs : "");
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

  if (providerToken && (providerKey !== "google" || providerToken.startsWith("ya29."))) {
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

  if (providerKey === "antigravity" && upstreamPath.includes("/models")) {
    return json(
      {
        object: "list",
        data: [
          { id: "gemini-2.5-pro", object: "model", created: Date.now(), owned_by: "google-antigravity" },
          { id: "gemini-2.5-flash", object: "model", created: Date.now(), owned_by: "google-antigravity" },
          { id: "gemini-2.0-flash", object: "model", created: Date.now(), owned_by: "google-antigravity" },
          { id: "gemini-3.5-flash", object: "model", created: Date.now(), owned_by: "google-antigravity" },
          { id: "gemini-3.1-pro", object: "model", created: Date.now(), owned_by: "google-antigravity" },
          { id: "claude-sonnet-4.6", object: "model", created: Date.now(), owned_by: "google-antigravity" },
          { id: "claude-3-5-sonnet-v2", object: "model", created: Date.now(), owned_by: "google-antigravity" },
        ],
      },
      200
    );
  }

  if ((providerKey === "google" || providerKey === "antigravity") && upstreamPath.includes("/chat/completions")) {
    if (!providerToken) {
      return json({ error: `Missing API key or OAuth token for ${providerKey} provider` }, 401);
    }
    return handleGoogleChatCompletion(req, providerToken, providerKey);
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

    // Don't stream HTML error pages (wrong base URL, provider web 404, etc.)
    // back to the client — return a readable JSON error instead.
    if ((respHeaders.get("content-type") ?? "").includes("text/html")) {
      const text = await upstream.text().catch(() => "");
      return json(
        {
          error: `Upstream returned an HTML page instead of an API response (${upstream.status}). Check the Base URL (include /v1) and that it's an API endpoint, not a website.${
            text ? ` HTML: ${text.slice(0, 200)}` : ""
          }`,
        },
        upstream.status
      );
    }

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
  apiKey: string,
  providerKey: string = "google"
): Promise<Response> {
  let openaiBody: any;
  try {
    openaiBody = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const rawModel = openaiBody.model || "gemini-2.0-flash";
  let model = rawModel.replace(/^(antigravity\/|google\/|aip\/)/i, "").trim();
  const messages = openaiBody.messages || [];
  const stream = openaiBody.stream === true;

  const isOAuth =
    providerKey === "antigravity" ||
    apiKey.startsWith("ya29.") ||
    apiKey.startsWith("oauth_") ||
    req.headers.get("x-auth-mode") === "oauth";

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
    contents.push({ role: "user", parts: [{ text: "Hello" }] });
  }

  const googleBody: any = { contents };

  const generationConfig: any = {};
  if (openaiBody.temperature !== undefined) generationConfig.temperature = openaiBody.temperature;
  if (openaiBody.max_tokens || openaiBody.max_completion_tokens) {
    generationConfig.maxOutputTokens = openaiBody.max_tokens || openaiBody.max_completion_tokens;
  }
  if (openaiBody.top_p !== undefined) generationConfig.topP = openaiBody.top_p;

  if (Object.keys(generationConfig).length > 0) googleBody.generationConfig = generationConfig;
  if (systemInstruction) googleBody.systemInstruction = { parts: [{ text: systemInstruction }] };

  const endpoint = stream ? "streamGenerateContent" : "generateContent";
  const sseParam = stream ? (isOAuth ? "?alt=sse" : "&alt=sse") : "";

  // Prepare alternate CloudCode companion and internal bodies (OmniRoute format)
  const promptText = messages.map((m: any) => typeof m.content === "string" ? m.content : "").join("\n");
  const companionBody = {
    model,
    prompt: promptText,
    messages: messages.map((m: any) => ({
      author: m.role === "assistant" ? "model" : "user",
      content: typeof m.content === "string" ? m.content : "",
    })),
  };

  const internalBody = {
    model,
    ...googleBody,
  };
  const wrappedInternalBody = {
    model,
    project: "",
    request: googleBody,
  };

  const candidateRequests: Array<{ url: string; body: string }> = [];

  if (isOAuth) {
    // 1. Antigravity CloudCode Internal endpoints for Google OAuth ya29... tokens
    candidateRequests.push(
      { url: `https://cloudcode-pa.googleapis.com/v1internal:${endpoint}${sseParam}`, body: JSON.stringify(wrappedInternalBody) },
      { url: `https://daily-cloudcode-pa.googleapis.com/v1internal:${endpoint}${sseParam}`, body: JSON.stringify(wrappedInternalBody) },
      { url: `https://cloudcode-pa.googleapis.com/v1internal:${endpoint}${sseParam}`, body: JSON.stringify(internalBody) },
      { url: `https://daily-cloudcode-pa.googleapis.com/v1internal:${endpoint}${sseParam}`, body: JSON.stringify(internalBody) }
    );

    // 2. Fallback: public Generative Language API with Bearer token (works for some OAuth tokens)
    candidateRequests.push(
      { url: `https://generativelanguage.googleapis.com/v1beta/models/${model}:${endpoint}${sseParam}`, body: JSON.stringify(googleBody) },
      { url: `https://generativelanguage.googleapis.com/v1/models/${model}:${endpoint}${sseParam}`, body: JSON.stringify(googleBody) }
    );

    // 3. CloudCode companion endpoints (for Claude/preview models)
    candidateRequests.push(
      { url: `https://cloudaicompanion.googleapis.com/v1alpha:generateMessage`, body: JSON.stringify(companionBody) },
      { url: `https://cloudcode-pa.googleapis.com/v1alpha:generateMessage`, body: JSON.stringify(companionBody) }
    );

    // Fallbacks for Claude / preview models to standard Gemini backends on CloudCode
    let baseModel = "gemini-2.5-flash";
    if (model.includes("3.1-pro") || model.includes("2.5-pro") || model.includes("opus") || model.includes("sonnet")) {
      baseModel = "gemini-2.5-pro";
    }
    const fallbackWrapped = { model: baseModel, project: "", request: googleBody };
    candidateRequests.push(
      { url: `https://cloudcode-pa.googleapis.com/v1internal:${endpoint}${sseParam}`, body: JSON.stringify(fallbackWrapped) },
      { url: `https://daily-cloudcode-pa.googleapis.com/v1internal:${endpoint}${sseParam}`, body: JSON.stringify(fallbackWrapped) },
      // Fallback to public GL API with base model
      { url: `https://generativelanguage.googleapis.com/v1beta/models/${baseModel}:${endpoint}${sseParam}`, body: JSON.stringify(googleBody) }
    );
  } else {
    candidateRequests.push(
      { url: `https://generativelanguage.googleapis.com/v1beta/models/${model}:${endpoint}?key=${encodeURIComponent(apiKey)}${sseParam}`, body: JSON.stringify(googleBody) },
      { url: `https://generativelanguage.googleapis.com/v1/models/${model}:${endpoint}?key=${encodeURIComponent(apiKey)}${sseParam}`, body: JSON.stringify(googleBody) }
    );
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "User-Agent": "antigravity/1.0.0",
    "x-goog-api-client": "gl-node/20.0.0 antigravity/1.0.0",
  };
  if (isOAuth) {
    headers["Authorization"] = `Bearer ${apiKey}`;
  }

  let lastErrorText = "";
  let lastStatus = 502;

  for (const reqItem of candidateRequests) {
    try {
      const upstream = await fetch(reqItem.url, {
        method: "POST",
        headers,
        body: reqItem.body,
      });

      if (upstream.ok) {
        if (stream) return streamGoogleResponse(upstream, model, openaiBody);
        else return convertGoogleResponse(await upstream.json(), model, openaiBody);
      }

      lastStatus = upstream.status;
      lastErrorText = await upstream.text().catch(() => `HTTP ${upstream.status}`);

      // Try the next candidate endpoint on any failure
      continue;
    } catch (err: any) {
      lastErrorText = err?.message || "Upstream fetch error";
    }
  }



  try {
    const errorJson = JSON.parse(lastErrorText);
    const errorMsg = errorJson.error?.message || lastErrorText;
    return json({ error: { message: errorMsg, type: "google_api_error", code: errorJson.error?.code || lastStatus } }, lastStatus);
  } catch {
    return json({ error: { message: lastErrorText || "Google API request failed", type: "google_api_error", code: lastStatus } }, lastStatus);
  }
}

const KNOWN_CLAUDE_TOOLS: Record<string, string> = {
  read: "Read",
  write: "Write",
  edit: "Edit",
  bash: "Bash",
  glob: "Glob",
  grep: "Grep",
  todomvc: "TodoMVC",
  websearch: "WebSearch",
  fetch: "Fetch",
  read_file: "Read",
  write_file: "Write",
  edit_file: "Edit",
  execute_command: "Bash",
};

function extractToolNameMap(body?: any): Map<string, string> {
  const map = new Map<string, string>();
  for (const [k, v] of Object.entries(KNOWN_CLAUDE_TOOLS)) {
    map.set(k.toLowerCase(), v);
    map.set(k.toLowerCase().replace(/[_\s-]/g, ""), v);
  }
  if (!body) return map;

  if (Array.isArray(body.tools)) {
    for (const t of body.tools as any[]) {
      const name = t?.function?.name || t?.name;
      if (typeof name === "string" && name.trim()) {
        const exact = name.trim();
        const lower = exact.toLowerCase();
        const normalized = lower.replace(/[_\s-]/g, "");
        map.set(exact, exact);
        map.set(lower, exact);
        map.set(normalized, exact);
      }
    }
  }
  return map;
}

function restoreToolName(rawName: string, map: Map<string, string>): string {
  if (!rawName) return rawName;
  const trimmed = rawName.trim();
  const lower = trimmed.toLowerCase();
  const normalized = lower.replace(/[_\s-]/g, "");
  return map.get(trimmed) || map.get(lower) || map.get(normalized) || KNOWN_CLAUDE_TOOLS[lower] || trimmed;
}

function sanitizeGoogleOutputText(text: string): string {
  if (!text) return text;
  if (text.includes("<GenerateWidget")) {
    text = text.replace(/<GenerateWidget[^>]*>([\s\S]*?)<\/GenerateWidget>/gi, (_, inner) => {
      try {
        const parsed = JSON.parse(inner.trim());
        if (parsed.widgetSpec?.prompt) {
          return parsed.widgetSpec.prompt;
        }
      } catch {}
      return "";
    });
    text = text.replace(/<GenerateWidget[^>]*>[\s\S]*/gi, (match) => {
      const jsonStart = match.indexOf("{");
      if (jsonStart !== -1) {
        try {
          const parsed = JSON.parse(match.slice(jsonStart).trim());
          if (parsed.widgetSpec?.prompt) return parsed.widgetSpec.prompt;
        } catch {}
      }
      return "";
    });
  }
  return text;
}

function isDeclaredTool(rawName: string, map: Map<string, string>): boolean {
  if (!rawName) return false;
  const trimmed = rawName.trim();
  const lower = trimmed.toLowerCase();
  const normalized = lower.replace(/[_\s-]/g, "");
  if (trimmed.includes(":") || trimmed.startsWith("image_agent") || trimmed.startsWith("google_search") || trimmed.startsWith("python")) {
    return false;
  }
  return map.has(trimmed) || map.has(lower) || map.has(normalized) || !!KNOWN_CLAUDE_TOOLS[lower];
}

function convertGoogleResponse(googleResp: any, modelName: string = "gemini-2.5-flash", openaiBody?: any): Response {
  const candidate = googleResp.candidates?.[0];
  const parts = candidate?.content?.parts || [];
  const textParts: string[] = [];
  const reasoningParts: string[] = [];
  const toolCalls: any[] = [];
  const toolNameMap = extractToolNameMap(openaiBody);

  for (const p of parts) {
    if (p.text) {
      const clean = sanitizeGoogleOutputText(p.text);
      if (clean) {
        if (p.thought) {
          reasoningParts.push(clean);
        } else {
          textParts.push(clean);
        }
      }
    }
    if (p.functionCall?.name && isDeclaredTool(p.functionCall.name, toolNameMap)) {
      const exactName = restoreToolName(p.functionCall.name, toolNameMap);
      toolCalls.push({
        id: `call_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        type: "function",
        function: {
          name: exactName,
          arguments: JSON.stringify(p.functionCall.args || {}),
        },
      });
    }
  }

  let text = textParts.join("");
  const reasoningText = reasoningParts.join("");
  if (!text && !toolCalls.length) {
    if (typeof candidate?.message?.content === "string") text = sanitizeGoogleOutputText(candidate.message.content);
    else if (typeof googleResp.reply === "string") text = sanitizeGoogleOutputText(googleResp.reply);
    else if (typeof googleResp.message === "string") text = sanitizeGoogleOutputText(googleResp.message);
    else if (typeof googleResp.response === "string") text = sanitizeGoogleOutputText(googleResp.response);
    else if (Array.isArray(googleResp.predictions) && googleResp.predictions[0]) {
      text = typeof googleResp.predictions[0] === "string" ? sanitizeGoogleOutputText(googleResp.predictions[0]) : JSON.stringify(googleResp.predictions[0]);
    }
  }

  const message: any = { role: "assistant", content: text || (toolCalls.length ? null : "") };
  if (reasoningText) {
    message.reasoning_content = reasoningText;
  }
  if (toolCalls.length) {
    message.tool_calls = toolCalls;
  }

  return json({
    id: `chatcmpl-${Date.now()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: modelName || googleResp.modelVersion || "gemini-2.5-flash",
    choices: [{
      index: 0,
      message,
      finish_reason: toolCalls.length ? "tool_calls" : (candidate?.finishReason?.toLowerCase() || "stop"),
    }],
    usage: {
      prompt_tokens: googleResp.usageMetadata?.promptTokenCount || 0,
      completion_tokens: googleResp.usageMetadata?.candidatesTokenCount || 0,
      total_tokens: googleResp.usageMetadata?.totalTokenCount || 0,
    },
  }, 200);
}

function streamGoogleResponse(upstream: Response, modelName: string = "gemini-2.0-flash", openaiBody?: any): Response {
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const toolNameMap = extractToolNameMap(openaiBody);

  (async () => {
    try {
      const reader = upstream.body?.getReader();
      if (!reader) { await writer.close(); return; }

      let buffer = "";
      let toolIndex = 0;
      const chatId = `chatcmpl-${Date.now()}`;
      const effectiveModel = modelName || "gemini-2.0-flash";

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
            if (buffer[i] === "}") { braceCount--; if (braceCount === 0) { objEnd = i + 1; break; } }
          }

          if (objEnd !== -1) {
            const chunk = buffer.substring(objStart, objEnd);
            try {
              const googleChunk = JSON.parse(chunk);
              const candidate = googleChunk.candidates?.[0];
              if (candidate) {
                const parts = candidate?.content?.parts || [];
                for (const p of parts) {
                  if (p.text) {
                    const cleanText = sanitizeGoogleOutputText(p.text);
                    if (cleanText) {
                      const delta = p.thought
                        ? { reasoning_content: cleanText }
                        : { content: cleanText };
                      await writer.write(encoder.encode(`data: ${JSON.stringify({
                        id: chatId, object: "chat.completion.chunk", created: Math.floor(Date.now() / 1000), model: effectiveModel,
                        choices: [{ index: 0, delta, finish_reason: null }],
                      })}\n\n`));
                    }
                  }
                }
                for (const p of parts) {
                  if (p.functionCall?.name && isDeclaredTool(p.functionCall.name, toolNameMap)) {
                    const exactName = restoreToolName(p.functionCall.name, toolNameMap);
                    await writer.write(encoder.encode(`data: ${JSON.stringify({
                      id: chatId,
                      object: "chat.completion.chunk",
                      created: Math.floor(Date.now() / 1000),
                      model: effectiveModel,
                      choices: [{
                        index: 0,
                        delta: {
                          tool_calls: [{
                            index: toolIndex++,
                            id: `call_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
                            type: "function",
                            function: {
                              name: exactName,
                              arguments: JSON.stringify(p.functionCall.args || {}),
                            },
                          }],
                        },
                        finish_reason: null,
                      }],
                    })}\n\n`));
                  }
                }
                if (candidate?.finishReason) {
                  const hasTool = parts.some((p: any) => p.functionCall);
                  await writer.write(encoder.encode(`data: ${JSON.stringify({
                    id: chatId, object: "chat.completion.chunk", created: Math.floor(Date.now() / 1000), model: effectiveModel,
                    choices: [{ index: 0, delta: {}, finish_reason: hasTool ? "tool_calls" : candidate.finishReason.toLowerCase() }],
                  })}\n\n`));
                }
                if (googleChunk.usageMetadata) {
                  await writer.write(encoder.encode(`data: ${JSON.stringify({
                    id: chatId, object: "chat.completion.chunk", created: Math.floor(Date.now() / 1000), model: effectiveModel,
                    choices: [],
                    usage: {
                      prompt_tokens: googleChunk.usageMetadata.promptTokenCount || 0,
                      completion_tokens: googleChunk.usageMetadata.candidatesTokenCount || 0,
                      total_tokens: googleChunk.usageMetadata.totalTokenCount || 0,
                    },
                  })}\n\n`));
                }
              }
            } catch (e) { /* skip malformed */ }
            startIdx = objEnd;
          } else { break; }
        }
        buffer = buffer.substring(startIdx);
      }

      await writer.write(encoder.encode("data: [DONE]\n\n"));
      await writer.close();
    } catch (err) {
      try { await writer.abort(err); } catch { /* already closed */ }
    }
  })();

  return new Response(readable, {
    status: 200,
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" },
  });
}
