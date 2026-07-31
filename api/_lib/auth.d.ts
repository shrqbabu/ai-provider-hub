import type { CoreRequest } from "./http";
export declare function bearerToken(req: CoreRequest): string | undefined;
/** Verify the Firebase ID token on the request. Returns uid, or null if invalid/missing. */
export declare function requireUser(req: CoreRequest): Promise<string | null>;
