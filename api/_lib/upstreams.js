// Gateway routing: given the incoming request's `model`, figure out WHICH of the
// user's connected providers should serve it, and what upstream base URL + keys
// to use. Routing strategy is auto-detect (per user's choice): match the model
// id against the user's saved models to find its providerId. An explicit
// "provider/model" prefix acts as an override.
// Known hosted provider base URLs (mirrors api/proxy.ts TARGETS). Used when a
// connected provider only stored a provider `key` without a full baseURL.
export var PROVIDER_BASE = {
    openai: "https://api.openai.com/v1",
    nvidia: "https://integrate.api.nvidia.com/v1",
    anthropic: "https://api.anthropic.com/v1",
    openrouter: "https://openrouter.ai/api/v1",
};
/** Strip an optional "provider/model" prefix. Returns { providerHint, modelId }. */
export function parseModel(model) {
    var trimmed = (model !== null && model !== void 0 ? model : "").trim();
    // Only treat the first segment as a provider hint if it's a known provider
    // key. Real model ids often contain "/" (e.g. "meta/llama-3.1-70b-instruct",
    // "mistralai/mistral-7b"), so we must NOT strip those.
    var slash = trimmed.indexOf("/");
    if (slash > 0) {
        var head = trimmed.slice(0, slash).toLowerCase();
        if (head in PROVIDER_BASE || head === "custom") {
            return { providerHint: head, modelId: trimmed.slice(slash + 1) };
        }
    }
    return { modelId: trimmed };
}
/** Ordered list of auth keys for a provider (multi-key fallback). */
export function providerKeys(p) {
    var _a, _b;
    var list = ((_a = p.apiKeys) !== null && _a !== void 0 ? _a : []).map(function (k) { return (k !== null && k !== void 0 ? k : "").trim(); }).filter(Boolean);
    var primary = ((_b = p.apiKey) !== null && _b !== void 0 ? _b : "").trim();
    if (primary && !list.includes(primary))
        list.unshift(primary);
    // De-dup while preserving order.
    return Array.from(new Set(list));
}
export function baseURLFor(p) {
    var _a, _b;
    var url = ((_a = p.baseURL) !== null && _a !== void 0 ? _a : "").trim();
    if (url)
        return url.replace(/\/$/, "");
    return (_b = PROVIDER_BASE[p.key]) !== null && _b !== void 0 ? _b : "";
}
/**
 * Resolve which provider serves `model`.
 * 1. If model has a known provider prefix → pick a matching connected provider.
 * 2. Else find a saved model whose modelId matches → use its providerId.
 * 3. Else, if the user has exactly one provider, fall back to it.
 */
export function resolveRoute(model, providers, models) {
    var _a;
    if (!model)
        return { error: "Request is missing `model`.", status: 400 };
    if (!providers.length)
        return {
            error: "No providers connected. Add a provider in the app first.",
            status: 400,
        };
    var _b = parseModel(model), providerHint = _b.providerHint, modelId = _b.modelId;
    var byId = new Map(providers.map(function (p) { return [p.id, p]; }));
    // 1. Explicit provider prefix → first connected provider of that key.
    if (providerHint) {
        var match = providers.find(function (p) { return p.key === providerHint; });
        if (match)
            return finalize(match, modelId);
    }
    // 2. Auto-detect via saved models (match against full model OR stripped id).
    var hit = (_a = models.find(function (m) { return m.modelId === model; })) !== null && _a !== void 0 ? _a : models.find(function (m) { return m.modelId === modelId; });
    if (hit) {
        var provider = byId.get(hit.providerId);
        if (provider)
            return finalize(provider, hit.modelId);
    }
    // 3. Single-provider convenience: no ambiguity possible.
    if (providers.length === 1)
        return finalize(providers[0], modelId);
    return {
        error: "Could not route model \"".concat(model, "\". Add it under a provider in the app, or prefix it with the provider (e.g. \"openai/").concat(modelId, "\")."),
        status: 404,
    };
}
function finalize(provider, modelId) {
    return { provider: provider, modelId: modelId, keys: providerKeys(provider) };
}
