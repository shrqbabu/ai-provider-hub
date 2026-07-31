export declare const PROVIDER_BASE: Record<string, string>;
export interface GwProvider {
    id: string;
    key: string;
    displayName?: string;
    authMode?: "apiKey" | "cookie";
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
export interface ResolvedRoute {
    provider: GwProvider;
    /** The model id to send upstream (prefix stripped). */
    modelId: string;
    /** Ordered auth keys to try (fallback list). */
    keys: string[];
}
/** Strip an optional "provider/model" prefix. Returns { providerHint, modelId }. */
export declare function parseModel(model: string): {
    providerHint?: string;
    modelId: string;
};
/** Ordered list of auth keys for a provider (multi-key fallback). */
export declare function providerKeys(p: GwProvider): string[];
export declare function baseURLFor(p: GwProvider): string;
/**
 * Resolve which provider serves `model`.
 * 1. If model has a known provider prefix → pick a matching connected provider.
 * 2. Else find a saved model whose modelId matches → use its providerId.
 * 3. Else, if the user has exactly one provider, fall back to it.
 */
export declare function resolveRoute(model: string, providers: GwProvider[], models: GwModel[]): ResolvedRoute | {
    error: string;
    status: number;
};
