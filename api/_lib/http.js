// Runtime-agnostic request/response shapes so the same core logic runs both as
// a Vercel Node function (api/*.ts) and inside the Vite dev middleware
// (vite.config.ts). Each adapter builds a CoreRequest from its native req and
// writes back a CoreResponse.
export function jsonResponse(status, body) {
    return { status: status, jsonBody: body };
}
