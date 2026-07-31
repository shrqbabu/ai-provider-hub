export interface ApiKeyRecord {
    uid: string;
    label: string;
    last4: string;
    createdAt: number;
    revoked: boolean;
}
export interface ApiKeyPublic {
    id: string;
    label: string;
    last4: string;
    createdAt: number;
    revoked: boolean;
}
export declare function hashKey(raw: string): string;
/** Create a new gateway key for a user. Returns the RAW key (show once) + record. */
export declare function createApiKey(uid: string, label: string, nowMs: number): Promise<{
    raw: string;
    record: ApiKeyPublic;
}>;
/** List a user's gateway keys (never returns raw keys). */
export declare function listApiKeys(uid: string): Promise<ApiKeyPublic[]>;
/** Revoke a key by its hash id. Only the owning user may revoke it. */
export declare function revokeApiKey(uid: string, id: string): Promise<boolean>;
/** Resolve a raw "ah-…" key presented on a gateway request → owning uid, or null. */
export declare function resolveApiKey(raw: string): Promise<string | null>;
