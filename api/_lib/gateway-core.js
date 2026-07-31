var __assign = (this && this.__assign) || function () {
    __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
                t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
// Gateway core — the OpenAI-compatible endpoint the user hits with their own
// "ah-…" key from anywhere. Flow:
//   1. Authenticate the ah- key → uid.
//   2. Load the user's providers + models from Firestore.
//   3. Resolve which provider serves the requested model (auto-detect).
//   4. Try that provider's keys in order (fallback on 401/403/429/5xx/network).
//   5. Stream the upstream response straight back (SSE passes through unchanged).
//
// Supported sub-paths (OpenAI-compatible):
//   POST chat/completions   → provider /chat/completions
//   POST completions        → provider /completions
//   POST embeddings         → provider /embeddings
//   GET  models             → aggregate of the user's saved models
import { resolveApiKey } from "./api-keys";
import { readKV, writeKV } from "./kv";
import { baseURLFor, resolveRoute, } from "./upstreams";
import { bearerToken } from "./auth";
import { jsonResponse } from "./http";
var HOP_BY_HOP = new Set([
    "connection",
    "keep-alive",
    "transfer-encoding",
    "te",
    "trailer",
    "upgrade",
    "proxy-authorization",
    "proxy-authenticate",
]);
// Status codes worth retrying with the next key. 401/403 → this key is bad;
// 429 → this key is rate-limited; 5xx → upstream hiccup, another key/region
// may succeed.
function shouldFallback(status) {
    return status === 401 || status === 403 || status === 429 || status >= 500;
}
export function handleGateway(req, nowMs) {
    return __awaiter(this, void 0, void 0, function () {
        var raw, uid, path, _a, providers, models, endpoint, body, _b, requestedModel, route, provider, modelId, keys, base, upstreamBody, wantsStream, targetURL, authList, lastStatus, lastText, i, cred, headers, _i, _c, _d, k, v, upstream, err_1;
        var _e, _f, _g, _h;
        return __generator(this, function (_j) {
            switch (_j.label) {
                case 0:
                    raw = bearerToken(req);
                    if (!raw) {
                        return [2 /*return*/, jsonResponse(401, {
                                error: { message: "Missing API key. Send `Authorization: Bearer ah-…`.", type: "auth" },
                            })];
                    }
                    return [4 /*yield*/, resolveApiKey(raw)];
                case 1:
                    uid = _j.sent();
                    if (!uid) {
                        return [2 /*return*/, jsonResponse(401, {
                                error: { message: "Invalid or revoked API key.", type: "auth" },
                            })];
                    }
                    path = req.subPath.replace(/^\/+/, "").toLowerCase();
                    return [4 /*yield*/, Promise.all([
                            readKV(uid, "providers", []),
                            readKV(uid, "models", []),
                        ])];
                case 2:
                    _a = _j.sent(), providers = _a[0], models = _a[1];
                    // ── GET models: return the user's saved models in OpenAI list shape ──────
                    if (path === "models" || path === "v1/models") {
                        return [2 /*return*/, jsonResponse(200, {
                                object: "list",
                                data: models.map(function (m) { return ({
                                    id: m.modelId,
                                    object: "model",
                                    owned_by: m.providerKey,
                                }); }),
                            })];
                    }
                    endpoint = matchEndpoint(path);
                    if (!endpoint) {
                        return [2 /*return*/, jsonResponse(404, {
                                error: { message: "Unsupported gateway path \"/".concat(path, "\"."), type: "invalid_request" },
                            })];
                    }
                    _j.label = 3;
                case 3:
                    _j.trys.push([3, 5, , 6]);
                    return [4 /*yield*/, req.json()];
                case 4:
                    body = _j.sent();
                    return [3 /*break*/, 6];
                case 5:
                    _b = _j.sent();
                    return [2 /*return*/, jsonResponse(400, {
                            error: { message: "Request body must be valid JSON.", type: "invalid_request" },
                        })];
                case 6:
                    requestedModel = String((_e = body.model) !== null && _e !== void 0 ? _e : "");
                    route = resolveRoute(requestedModel, providers, models);
                    if ("error" in route) {
                        return [2 /*return*/, jsonResponse(route.status, {
                                error: { message: route.error, type: "invalid_request" },
                            })];
                    }
                    provider = route.provider, modelId = route.modelId, keys = route.keys;
                    base = baseURLFor(provider);
                    if (!base) {
                        return [2 /*return*/, jsonResponse(400, {
                                error: { message: "Provider \"".concat((_f = provider.displayName) !== null && _f !== void 0 ? _f : provider.key, "\" has no base URL."), type: "invalid_request" },
                            })];
                    }
                    upstreamBody = JSON.stringify(__assign(__assign({}, body), { model: modelId }));
                    wantsStream = body.stream === true;
                    targetURL = base.replace(/\/$/, "") + endpoint;
                    authList = provider.authMode === "cookie"
                        ? [(_g = provider.cookie) !== null && _g !== void 0 ? _g : ""].filter(Boolean)
                        : keys;
                    if (!authList.length) {
                        return [2 /*return*/, jsonResponse(400, {
                                error: {
                                    message: "Provider \"".concat((_h = provider.displayName) !== null && _h !== void 0 ? _h : provider.key, "\" has no API key configured."),
                                    type: "invalid_request",
                                },
                            })];
                    }
                    lastStatus = 502;
                    lastText = "All provider keys failed.";
                    i = 0;
                    _j.label = 7;
                case 7:
                    if (!(i < authList.length)) return [3 /*break*/, 15];
                    cred = authList[i];
                    headers = new Headers();
                    headers.set("Content-Type", "application/json");
                    if (provider.authMode === "cookie")
                        headers.set("Cookie", cred);
                    else
                        headers.set("Authorization", "Bearer ".concat(cred));
                    if (provider.organization)
                        headers.set("OpenAI-Organization", provider.organization);
                    if (provider.extraHeaders) {
                        for (_i = 0, _c = Object.entries(provider.extraHeaders); _i < _c.length; _i++) {
                            _d = _c[_i], k = _d[0], v = _d[1];
                            headers.set(k, v);
                        }
                    }
                    upstream = void 0;
                    _j.label = 8;
                case 8:
                    _j.trys.push([8, 10, , 11]);
                    return [4 /*yield*/, fetch(targetURL, {
                            method: "POST",
                            headers: headers,
                            body: upstreamBody,
                        })];
                case 9:
                    upstream = _j.sent();
                    return [3 /*break*/, 11];
                case 10:
                    err_1 = _j.sent();
                    lastStatus = 502;
                    lastText = err_1 instanceof Error ? err_1.message : "Upstream fetch failed.";
                    return [3 /*break*/, 14]; // network error → try next key
                case 11:
                    if (!(shouldFallback(upstream.status) && i < authList.length - 1)) return [3 /*break*/, 13];
                    lastStatus = upstream.status;
                    return [4 /*yield*/, safeText(upstream)];
                case 12:
                    lastText = _j.sent();
                    return [3 /*break*/, 14]; // try next key
                case 13:
                    // Success (or final attempt) → relay this response to the caller.
                    void recordUsage(uid, provider.id, modelId, nowMs).catch(function () { });
                    return [2 /*return*/, relay(upstream, wantsStream)];
                case 14:
                    i++;
                    return [3 /*break*/, 7];
                case 15: return [2 /*return*/, jsonResponse(lastStatus, {
                        error: {
                            message: "All ".concat(authList.length, " key(s) for this provider failed. Last upstream error: ").concat(lastText),
                            type: "upstream_error",
                        },
                    })];
            }
        });
    });
}
function matchEndpoint(path) {
    var p = path.replace(/^v1\//, "");
    if (p === "chat/completions")
        return "/chat/completions";
    if (p === "completions")
        return "/completions";
    if (p === "embeddings")
        return "/embeddings";
    return null;
}
function relay(upstream, _wantsStream) {
    var headers = {};
    upstream.headers.forEach(function (v, k) {
        var lk = k.toLowerCase();
        if (HOP_BY_HOP.has(lk))
            return;
        if (lk === "content-encoding" || lk === "content-length")
            return;
        headers[k] = v;
    });
    return {
        status: upstream.status,
        statusText: upstream.statusText,
        headers: headers,
        streamBody: upstream.body,
    };
}
function safeText(res) {
    return __awaiter(this, void 0, void 0, function () {
        var t, _a;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    _b.trys.push([0, 2, , 3]);
                    return [4 /*yield*/, res.text()];
                case 1:
                    t = _b.sent();
                    return [2 /*return*/, t.slice(0, 500)];
                case 2:
                    _a = _b.sent();
                    return [2 /*return*/, "".concat(res.status, " ").concat(res.statusText)];
                case 3: return [2 /*return*/];
            }
        });
    });
}
// Best-effort usage counter. Appends to users/{uid}/kv/gatewayUsage. Never
// blocks or fails the request.
function recordUsage(uid, providerId, modelId, nowMs) {
    return __awaiter(this, void 0, void 0, function () {
        var KEY, list, trimmed;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    KEY = "gatewayUsage";
                    return [4 /*yield*/, readKV(uid, KEY, [])];
                case 1:
                    list = _a.sent();
                    list.push({ providerId: providerId, modelId: modelId, at: nowMs });
                    trimmed = list.slice(-500);
                    return [4 /*yield*/, writeKV(uid, KEY, trimmed, nowMs)];
                case 2:
                    _a.sent();
                    return [2 /*return*/];
            }
        });
    });
}
