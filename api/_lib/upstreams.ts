// Gateway routing: given the incoming request's `model`, figure out WHICH of the
// user's connected providers should serve it, and what upstream base URL + keys
// to use. Routing strategy is auto-detect (per user's choice): match the model
// id against the user's saved models to find its providerId. An explicit
// "provider/model" prefix acts as an override.

// Known hosted provider base URLs (mirrors api/proxy.ts TARGETS). Used when a
// connected provider only stored a provider `key` without a full baseURL.
export const PROVIDER_BASE: Record<string, string> = {
  openai: "https://api.openai.com/v1",
  nvidia: "https://integrate.api.nvidia.com/v1",
  anthropic: "https://api.anthropic.com/v1",
  openrouter: "https://openrouter.ai/api/v1",
  google: "https://generativelanguage.googleapis.com/v1",
  // OAuth provider bases — used when the provider was saved without an explicit
  // baseURL (shouldn't happen, but acts as a safety net).
  github: "https://api.githubcopilot.com",
  grok: "https://api.x.ai/v1",
  kimi: "https://api.kimi.com/coding/v1",
  codex: "https://api.openai.com/v1",
  claude: "https://api.anthropic.com/v1",
  antigravity: "https://cloudcode-pa.googleapis.com",
};

// Minimal mirror of the frontend types (api code can't import from src/).
export interface GwProvider {
  id: string;
  key: string;
  displayName?: string;
  authMode?: "apiKey" | "cookie" | "oauth";
  apiFormat?: "openai" | "anthropic";
  apiKey?: string;
  refreshToken?: string;
  tokenExpiry?: number;
  email?: string;
  apiKeys?: string[];
  cookie?: string;
  baseURL: string;
  organization?: string;
  extraHeaders?: Record<string, string>;
}

export interface GwModel {
  providerId: string;
  providerKey: string;
  modelId: string;
}

// A user-defined combo: a named group of models with a fallback priority
// order. When the gateway is called with `model: "<combo name>"`, it tries
// each member in order until one succeeds. Combos are OpenAI-format only.
export interface GwCombo {
  id: string;
  name: string;
  members: { providerId: string; modelId: string }[];
}

export interface ResolvedRoute {
  provider: GwProvider;
  /** The model id to send upstream (prefix stripped). */
  modelId: string;
  /** Ordered auth keys to try (fallback list). */
  keys: string[];
}

/** Strip an optional "provider/model" prefix. Returns { providerHint, modelId }. */
export function parseModel(model: string): {
  providerHint?: string;
  modelId: string;
} {
  const trimmed = (model ?? "").trim();
  // Only treat the first segment as a provider hint if it's a known provider
  // key. Real model ids often contain "/" (e.g. "meta/llama-3.1-70b-instruct",
  // "mistralai/mistral-7b"), so we must NOT strip those.
  const slash = trimmed.indexOf("/");
  if (slash > 0) {
    const head = trimmed.slice(0, slash).toLowerCase();
    // "aip/" is a virtual prefix for Claude models (aip = Anthropic In Prefix).
    // It isn't a real provider key — it just marks "this is a Claude model" so
    // the gateway can route it to whichever provider serves Claude and strip
    // the prefix before the request goes upstream.
    if (head in PROVIDER_BASE || head === "custom" || head === "aip") {
      return { providerHint: head, modelId: trimmed.slice(slash + 1) };
    }
  }
  return { modelId: trimmed };
}

/** Convenience: return just the model id with any known prefix stripped.
 *  Use this for MATCHING/comparison only — never for the id sent upstream, since
 *  it also strips real provider namespaces (e.g. NVIDIA's "nvidia/…"). */
export function stripKnownPrefix(model: string): string {
  return parseModel(model).modelId;
}

/** Strip ONLY the virtual "aip/" prefix (the Claude marker). Real provider
 *  namespaces like "nvidia/llama-…", "google/gemma-…", "meta/llama-…" are part
 *  of the upstream model id and MUST be preserved. Use this for the id that
 *  actually goes upstream once the provider is already known. */
export function stripVirtualPrefix(model: string): string {
  return (model ?? "").trim().replace(/^aip\//i, "");
}

/** Ordered list of auth keys for a provider (multi-key fallback). */
export function providerKeys(p: GwProvider): string[] {
  const list = (p.apiKeys ?? []).map((k) => (k ?? "").trim()).filter(Boolean);
  const primary = (p.apiKey ?? "").trim();
  if (primary && !list.includes(primary)) list.unshift(primary);
  // De-dup while preserving order.
  return Array.from(new Set(list));
}

export function baseURLFor(p: GwProvider): string {
  let url = (p.baseURL ?? "").trim().replace(/\/$/, "");
  if (!url) return PROVIDER_BASE[p.key] ?? "";

  // If baseURL is relative (e.g. /api/cli), resolve to localhost server
  if (url.startsWith("/")) {
    const port = process.env.PORT || "3000";
    url = `http://127.0.0.1:${port}${url}`;
  }

  // 1. Strip trailing endpoint paths if user saved the full endpoint URL
  url = url
    .replace(/\/chat\/completions\/?$/i, "")
    .replace(/\/messages\/?$/i, "")
    .replace(/\/completions\/?$/i, "")
    .replace(/\/embeddings\/?$/i, "")
    .replace(/\/$/, "");

  // 2. Auto-normalize standard provider URLs if /v1 path is omitted
  // SKIP /v1 for OAuth providers that don't use standard /v1 paths
  const isCloudCode = url.includes("cloudcode-pa.googleapis.com") || url.includes("daily-cloudcode-pa.googleapis.com");
  const isCopilot = url.includes("api.githubcopilot.com") || url.includes("copilot");
  const isKimiCoding = url.includes("api.kimi.com");
  if (isCloudCode || isCopilot || isKimiCoding) {
    // These OAuth URLs use their own path structure, don't auto-append /v1
    return url;
  }
  if (p.key === "openai" && !url.includes("/v1")) {
    url += "/v1";
  } else if (p.key === "nvidia" && !url.includes("/v1")) {
    url += "/v1";
  } else if (p.key === "anthropic" && !url.includes("/v1")) {
    url += "/v1";
  } else if (p.key === "openrouter" && !url.includes("/v1")) {
    url += "/api/v1";
  } else if (p.key === "google" && !url.includes("/v1")) {
    url += "/v1";
  } else if (p.key === "custom") {
    if (url.includes("integrate.api.nvidia.com") && !url.includes("/v1")) {
      url += "/v1";
    } else if (url.includes("api.openai.com") && !url.includes("/v1")) {
      url += "/v1";
    } else if (url.includes("api.anthropic.com") && !url.includes("/v1")) {
      url += "/v1";
    } else if (url.includes("openrouter.ai") && !url.includes("/v1")) {
      url += "/api/v1";
    }
  }
  return url;
}

/**
 * Resolve which provider serves `model`.
 * 1. If model has a known provider prefix → pick a matching connected provider.
 * 2. Else find a saved model whose modelId matches → use its providerId.
 * 3. Else, if the user has exactly one provider, fall back to it.
 */
export function resolveRoute(
  model: string,
  providers: GwProvider[],
  models: GwModel[]
): ResolvedRoute | { error: string; status: number } {
  if (!model) return { error: "Request is missing `model`.", status: 400 };
  if (!providers.length)
    return {
      error: "No providers connected. Add a provider in the app first.",
      status: 400,
    };

  const { providerHint, modelId } = parseModel(model);
  const byId = new Map(providers.map((p) => [p.id, p]));

  // 1. Explicit provider prefix → first connected provider of that key.
  if (providerHint) {
    // "aip/" is the virtual Claude prefix — route it to whichever provider
    // serves Claude. Prefer a native anthropic provider; else a provider that
    // speaks the Anthropic wire format; else the provider that has this exact
    // model saved.
    if (providerHint === "aip") {
      const savedHit = models.find((m) => stripKnownPrefix(m.modelId) === modelId);
      const claude =
        providers.find((p) => p.key === "anthropic") ??
        providers.find((p) => p.apiFormat === "anthropic") ??
        (savedHit ? byId.get(savedHit.providerId) : undefined);
      if (claude) return finalize(claude, modelId);
    }
    const match = providers.find((p) => p.key === providerHint);
    if (match) return finalize(match, modelId);
  }

  // 2. Auto-detect via saved models. A saved modelId may itself carry the
  // virtual "aip/" prefix, so compare on the stripped form both ways, and
  // send the stripped id upstream.
  const hit =
    models.find((m) => m.modelId === model) ??
    models.find((m) => m.modelId === modelId) ??
    models.find((m) => stripKnownPrefix(m.modelId) === modelId);
  if (hit) {
    const provider = byId.get(hit.providerId);
    // Send the SAVED id minus only the virtual "aip/" marker. Real provider
    // namespaces in the model id (nvidia/…, google/…, meta/…) belong upstream.
    if (provider) return finalize(provider, stripVirtualPrefix(hit.modelId));
  }

  // 3. Single-provider convenience: no ambiguity possible.
  if (providers.length === 1) return finalize(providers[0], modelId);

  return {
    error: `Could not route model "${model}". Add it under a provider in the app, or prefix it with the provider (e.g. "openai/${modelId}").`,
    status: 400,
  };
}

function finalize(provider: GwProvider, modelId: string): ResolvedRoute {
  return { provider, modelId, keys: providerKeys(provider) };
}

/**
 * Resolve `model` into an ORDERED list of attempts (provider + modelId + keys).
 *
 * - If `model` matches a combo name → one attempt per combo member, in the
 *   user-defined priority order. The gateway falls through them on failure.
 * - Otherwise → a single attempt via `resolveRoute`.
 *
 * This is what the gateway actually loops over: normal models yield one
 * attempt, combos yield N. Each attempt still carries its own key list, so
 * per-provider multi-key fallback stacks on top of combo fallback.
 */
export function resolveAttempts(
  model: string,
  providers: GwProvider[],
  models: GwModel[],
  combos: GwCombo[]
): { attempts: ResolvedRoute[]; combo?: GwCombo } | { error: string; status: number } {
  if (!model) return { error: "Request is missing `model`.", status: 400 };
  if (!providers.length)
    return {
      error: "No providers connected. Add a provider in the app first.",
      status: 400,
    };

  const wanted = model.trim().toLowerCase();
  const { modelId: strippedWanted } = parseModel(wanted);
  const combo = combos.find((c) => {
    const name = (c.name ?? "").trim().toLowerCase();
    return name === wanted || name === strippedWanted;
  });
  if (combo) {
    const byId = new Map(providers.map((p) => [p.id, p]));
    const attempts: ResolvedRoute[] = [];
    for (const member of combo.members ?? []) {
      const provider = byId.get(member.providerId);
      if (!provider) continue; // provider deleted since combo was saved — skip
      // A combo member's modelId may carry the virtual "aip/" prefix if it was
      // picked from the prefixed model list. Strip ONLY that; real provider
      // namespaces (nvidia/…, google/…, meta/…) are part of the upstream id.
      const { modelId } = parseModel(member.modelId);
      attempts.push(finalize(provider, stripVirtualPrefix(modelId)));
    }
    if (!attempts.length)
      return {
        error: `Combo "${combo.name}" has no usable members. Its providers may have been removed — edit the combo in the app.`,
        status: 400,
      };
    return { attempts, combo };
  }

  const route = resolveRoute(model, providers, models);
  if ("error" in route) return route;
  return { attempts: [route] };
}
