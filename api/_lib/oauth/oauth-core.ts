import { jsonResponse, type CoreRequest, type CoreResponse } from "../http.js";
import { initiateDeviceCode, pollDeviceToken } from "./device-flow.js";
import { OAUTH_PROVIDERS } from "./constants.js";

export async function handleOAuth(req: CoreRequest): Promise<CoreResponse> {
  const method = req.method.toUpperCase();
  const path = req.path.replace(/^\/+/, "");

  if (method === "GET" && (path === "providers" || path === "")) {
    const list = Object.entries(OAUTH_PROVIDERS).map(([key, config]) => ({
      key,
      name: config.name,
      type: config.type,
      defaultModels: (config as any).defaultModels || [],
    }));
    return jsonResponse(200, { ok: true, providers: list });
  }

  if (method === "POST" && path === "device/code") {
    let body: any = {};
    try {
      body = await req.json();
    } catch {
      return jsonResponse(400, { ok: false, error: "Invalid JSON body" });
    }

    const provider = body.provider;
    if (!provider) {
      return jsonResponse(400, { ok: false, error: "Missing required 'provider' parameter." });
    }

    try {
      const codeResp = await initiateDeviceCode(provider);
      return jsonResponse(200, { ok: true, ...codeResp });
    } catch (err: any) {
      return jsonResponse(500, { ok: false, error: err.message || "Failed to initiate device code" });
    }
  }

  if (method === "POST" && path === "device/poll") {
    let body: any = {};
    try {
      body = await req.json();
    } catch {
      return jsonResponse(400, { ok: false, error: "Invalid JSON body" });
    }

    const { provider, device_code } = body;
    if (!provider || !device_code) {
      return jsonResponse(400, {
        ok: false,
        error: "Missing required 'provider' or 'device_code' parameter.",
      });
    }

    try {
      const pollResult = await pollDeviceToken(provider, device_code);
      return jsonResponse(200, { ok: true, ...pollResult });
    } catch (err: any) {
      return jsonResponse(500, { ok: false, error: err.message || "Failed to poll device token" });
    }
  }

  return jsonResponse(404, { ok: false, error: `OAuth route not found: ${path}` });
}
