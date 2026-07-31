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
};

// Minimal mirror of the frontend types (api code can't import from src/).
export interface GwProvider {
  id: string;
  key: string;
  displayName?: string;
  authMode?: "apiKey" | "cookie";
  apiFormat?: "openai" | "anthropic";
  apiKey?: string;
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
    if (head in PROVIDER_BASE || head === "custom") {
      return { providerHint: head, modelId: trimmed.slice(slash + 1) };
    }
  }
  return { modelId: trimmed };
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
  const url = (p.baseURL ?? "").trim();
  if (url) return url.replace(/\/$/, "");
  return PROVIDER_BASE[p.key] ?? "";
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
    const match = providers.find((p) => p.key === providerHint);
    if (match) return finalize(match, modelId);
  }

  // 2. Auto-detect via saved models (match against full model OR stripped id).
  const hit =
    models.find((m) => m.modelId === model) ??
    models.find((m) => m.modelId === modelId);
  if (hit) {
    const provider = byId.get(hit.providerId);
    if (provider) return finalize(provider, hit.modelId);
  }

  // 3. Single-provider convenience: no ambiguity possible.
  if (providers.length === 1) return finalize(providers[0], modelId);

  return {
    error: `Could not route model "${model}". Add it under a provider in the app, or prefix it with the provider (e.g. "openai/${modelId}").`,
    status: 404,
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
): { attempts: ResolvedRoute[] } | { error: string; status: number } {
  if (!model) return { error: "Request is missing `model`.", status: 400 };
  if (!providers.length)
    return {
      error: "No providers connected. Add a provider in the app first.",
      status: 400,
    };

  const wanted = model.trim().toLowerCase();
  const combo = combos.find((c) => (c.name ?? "").trim().toLowerCase() === wanted);
  if (combo) {
    const byId = new Map(providers.map((p) => [p.id, p]));
    const attempts: ResolvedRoute[] = [];
    for (const member of combo.members ?? []) {
      const provider = byId.get(member.providerId);
      if (!provider) continue; // provider deleted since combo was saved — skip
      attempts.push(finalize(provider, member.modelId));
    }
    if (!attempts.length)
      return {
        error: `Combo "${combo.name}" has no usable members. Its providers may have been removed — edit the combo in the app.`,
        status: 400,
      };
    return { attempts };
  }

  const route = resolveRoute(model, providers, models);
  if ("error" in route) return route;
  return { attempts: [route] };
}
