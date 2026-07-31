export interface CoreRequest {
    method: string;
    /** Case-insensitive header lookup. */
    header(name: string): string | undefined;
    /** Query params (already parsed). */
    query: URLSearchParams;
    /** Sub-path after the route mount, e.g. "chat/completions" for the gateway. */
    subPath: string;
    /** Parsed JSON body (throws on invalid JSON). */
    json<T = unknown>(): Promise<T>;
    /** Raw request body bytes (for proxying upstream unchanged). */
    rawBody(): Promise<Uint8Array>;
}
export interface CoreResponse {
    status: number;
    headers?: Record<string, string>;
    /** JSON payload — serialized by the adapter. */
    jsonBody?: unknown;
    /** Streaming/binary payload — piped through unchanged. */
    streamBody?: ReadableStream<Uint8Array> | null;
    /** Passthrough status text (used when relaying upstream responses). */
    statusText?: string;
}
export declare function jsonResponse(status: number, body: unknown): CoreResponse;
