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
// Gateway API keys — the user's own "ah-…" keys that let them call this app as
// a unified OpenAI-compatible gateway from anywhere (OpenAI SDK, curl, etc.).
//
// The raw key is shown to the user exactly once at creation. We only ever store
// its SHA-256 hash, so a leaked database can't reveal usable keys. Lookup on
// each gateway request hashes the presented key and reads apiKeys/{hash}.
import { createHash, randomBytes } from "node:crypto";
import { getDb } from "./firebase-admin";
var PREFIX = "ah-";
export function hashKey(raw) {
    return createHash("sha256").update(raw).digest("hex");
}
function genRawKey() {
    // 30 bytes → 60 hex chars. Plenty of entropy; prefixed for easy identification.
    return PREFIX + randomBytes(30).toString("hex");
}
/** Create a new gateway key for a user. Returns the RAW key (show once) + record. */
export function createApiKey(uid, label, nowMs) {
    return __awaiter(this, void 0, void 0, function () {
        var raw, hash, record;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    raw = genRawKey();
                    hash = hashKey(raw);
                    record = {
                        uid: uid,
                        label: label || "Gateway key",
                        last4: raw.slice(-4),
                        createdAt: nowMs,
                        revoked: false,
                    };
                    return [4 /*yield*/, getDb().collection("apiKeys").doc(hash).set(record)];
                case 1:
                    _a.sent();
                    return [2 /*return*/, { raw: raw, record: __assign({ id: hash }, record) }];
            }
        });
    });
}
/** List a user's gateway keys (never returns raw keys). */
export function listApiKeys(uid) {
    return __awaiter(this, void 0, void 0, function () {
        var snap;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, getDb()
                        .collection("apiKeys")
                        .where("uid", "==", uid)
                        .get()];
                case 1:
                    snap = _a.sent();
                    return [2 /*return*/, snap.docs
                            .map(function (d) {
                            var r = d.data();
                            return {
                                id: d.id,
                                label: r.label,
                                last4: r.last4,
                                createdAt: r.createdAt,
                                revoked: r.revoked,
                            };
                        })
                            .sort(function (a, b) { return b.createdAt - a.createdAt; })];
            }
        });
    });
}
/** Revoke a key by its hash id. Only the owning user may revoke it. */
export function revokeApiKey(uid, id) {
    return __awaiter(this, void 0, void 0, function () {
        var ref, snap, r;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    ref = getDb().collection("apiKeys").doc(id);
                    return [4 /*yield*/, ref.get()];
                case 1:
                    snap = _a.sent();
                    if (!snap.exists)
                        return [2 /*return*/, false];
                    r = snap.data();
                    if (r.uid !== uid)
                        return [2 /*return*/, false];
                    return [4 /*yield*/, ref.update({ revoked: true })];
                case 2:
                    _a.sent();
                    return [2 /*return*/, true];
            }
        });
    });
}
/** Resolve a raw "ah-…" key presented on a gateway request → owning uid, or null. */
export function resolveApiKey(raw) {
    return __awaiter(this, void 0, void 0, function () {
        var hash, snap, r;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    if (!raw || !raw.startsWith(PREFIX))
                        return [2 /*return*/, null];
                    hash = hashKey(raw);
                    return [4 /*yield*/, getDb().collection("apiKeys").doc(hash).get()];
                case 1:
                    snap = _a.sent();
                    if (!snap.exists)
                        return [2 /*return*/, null];
                    r = snap.data();
                    if (r.revoked)
                        return [2 /*return*/, null];
                    return [2 /*return*/, r.uid];
            }
        });
    });
}
