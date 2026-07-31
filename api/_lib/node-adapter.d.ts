import type { IncomingMessage, ServerResponse } from "node:http";
import type { CoreRequest, CoreResponse } from "./http";
/** Build a CoreRequest from a Node request. `subPath` is the route-specific
 *  remainder (e.g. the gateway path after /api/v1). */
export declare function toCoreRequest(req: IncomingMessage, subPath: string, query: URLSearchParams): CoreRequest;
/** Write a CoreResponse to a Node response, streaming if needed. */
export declare function sendCoreResponse(res: ServerResponse, core: CoreResponse): Promise<void>;
