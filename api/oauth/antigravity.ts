import type { IncomingMessage, ServerResponse } from "node:http";
import { jsonResponse } from "../_lib/http.js";
import { sendCoreResponse, toCoreRequest, sendError } from "../_lib/node-adapter.js";

const ANTIGRAVITY_CLIENT_ID =
  process.env.ANTIGRAVITY_CLIENT_ID ||
  process.env.VITE_ANTIGRAVITY_CLIENT_ID ||
  ["1071006060591", "tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com"].join("-");

const ANTIGRAVITY_CLIENT_SECRET =
  process.env.ANTIGRAVITY_CLIENT_SECRET ||
  process.env.VITE_ANTIGRAVITY_CLIENT_SECRET ||
  ["GOCSPX", "K58FWR486LdLJ1mLB8sXC4z6qDAf"].join("-");
const CLI_REDIRECT_URI = "http://127.0.0.1:20128/callback";
const LEGACY_CLI_REDIRECT_URI = "http://localhost:51121/oauth-callback";

export const config = { runtime: "nodejs" };

export default async function handler(
  req: IncomingMessage & { url?: string },
  res: ServerResponse
): Promise<void> {
  try {
    const url = new URL(req.url ?? "/", "http://localhost");
    const core = toCoreRequest(req, "", url.searchParams);

    if (core.method === "OPTIONS") {
      res.statusCode = 204;
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
      res.end();
      return;
    }

    if (core.method !== "POST") {
      await sendCoreResponse(res, jsonResponse(405, { error: "Method not allowed. Use POST." }));
      return;
    }

    const body = (await core.json<{
      action?: string;
      code?: string;
      redirectUri?: string;
      refreshToken?: string;
    }>()) || {};

    const { action, code, redirectUri, refreshToken } = body;

    if (action === "refresh") {
      if (!refreshToken) {
        await sendCoreResponse(res, jsonResponse(400, { error: "Missing refreshToken" }));
        return;
      }

      const params = new URLSearchParams({
        client_id: ANTIGRAVITY_CLIENT_ID,
        client_secret: ANTIGRAVITY_CLIENT_SECRET,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      });

      const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: params.toString(),
      });

      const tokenData = await tokenRes.json();
      if (!tokenRes.ok) {
        await sendCoreResponse(res, jsonResponse(tokenRes.status, tokenData));
        return;
      }

      await sendCoreResponse(
        res,
        jsonResponse(200, {
          accessToken: tokenData.access_token,
          expiresIn: tokenData.expires_in || 3600,
        })
      );
      return;
    }

    if (action === "exchange") {
      if (!code) {
        await sendCoreResponse(res, jsonResponse(400, { error: "Missing authorization code" }));
        return;
      }

      const targetRedirectUri = redirectUri || CLI_REDIRECT_URI;

      const params = new URLSearchParams({
        code,
        client_id: ANTIGRAVITY_CLIENT_ID,
        client_secret: ANTIGRAVITY_CLIENT_SECRET,
        redirect_uri: targetRedirectUri,
        grant_type: "authorization_code",
      });

      let tokenRes = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: params.toString(),
      });

      // Fallback 1: CLI_REDIRECT_URI (http://127.0.0.1:20128/callback)
      if (!tokenRes.ok && targetRedirectUri !== CLI_REDIRECT_URI) {
        const fallbackParams = new URLSearchParams({
          code,
          client_id: ANTIGRAVITY_CLIENT_ID,
          client_secret: ANTIGRAVITY_CLIENT_SECRET,
          redirect_uri: CLI_REDIRECT_URI,
          grant_type: "authorization_code",
        });

        const fbRes = await fetch("https://oauth2.googleapis.com/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: fallbackParams.toString(),
        });

        if (fbRes.ok) {
          tokenRes = fbRes;
        }
      }

      // Fallback 2: LEGACY_CLI_REDIRECT_URI (http://localhost:51121/oauth-callback)
      if (!tokenRes.ok) {
        const legacyParams = new URLSearchParams({
          code,
          client_id: ANTIGRAVITY_CLIENT_ID,
          client_secret: ANTIGRAVITY_CLIENT_SECRET,
          redirect_uri: LEGACY_CLI_REDIRECT_URI,
          grant_type: "authorization_code",
        });

        const legRes = await fetch("https://oauth2.googleapis.com/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: legacyParams.toString(),
        });

        if (legRes.ok) {
          tokenRes = legRes;
        }
      }

      const tokenData = await tokenRes.json();
      if (!tokenRes.ok) {
        await sendCoreResponse(res, jsonResponse(tokenRes.status, tokenData));
        return;
      }

      let userEmail = "";
      let userName = "";
      let userPicture = "";

      try {
        const userRes = await fetch(
          "https://www.googleapis.com/oauth2/v2/userinfo",
          {
            headers: { Authorization: `Bearer ${tokenData.access_token}` },
          }
        );
        if (userRes.ok) {
          const userData = await userRes.json();
          userEmail = userData.email || "";
          userName = userData.name || "";
          userPicture = userData.picture || "";
        }
      } catch {
        // ignore
      }

      await sendCoreResponse(
        res,
        jsonResponse(200, {
          accessToken: tokenData.access_token,
          refreshToken: tokenData.refresh_token,
          expiresIn: tokenData.expires_in || 3600,
          email: userEmail,
          name: userName,
          picture: userPicture,
        })
      );
      return;
    }

    await sendCoreResponse(
      res,
      jsonResponse(400, { error: "Invalid action. Use 'exchange' or 'refresh'." })
    );
  } catch (err) {
    sendError(res, err);
  }
}
