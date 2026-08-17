import http, { IncomingMessage, ServerResponse } from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { handleGateway } from "./api/_lib/gateway-core.js";
import { handleKeys } from "./api/_lib/keys-core.js";
import { handleData } from "./api/_lib/data-core.js";
import { handleBackup } from "./api/_lib/backup-core.js";
import { toCoreRequest, sendCoreResponse, sendError } from "./api/_lib/node-adapter.js";
import handleProxy from "./api/proxy.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function getDistDir(): string {
  const candidates = [
    path.resolve(process.cwd(), "./dist"),
    path.resolve(__dirname, "./dist"),
    path.resolve(__dirname, "../dist"),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return path.resolve(process.cwd(), "./dist");
}

const PORT = parseInt(process.env.PORT || "3000", 10);
const HOST = process.env.HOST || "0.0.0.0";
const DIST_DIR = getDistDir();

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".txt": "text/plain; charset=utf-8",
};

function setCorsHeaders(req: IncomingMessage, res: ServerResponse) {
  const origin = req.headers.origin || "*";
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET, POST, PUT, PATCH, DELETE, OPTIONS, HEAD"
  );
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, x-api-key, x-provider-key, x-provider-cookie, x-auth-mode, anthropic-version, openai-organization"
  );
  res.setHeader("Access-Control-Allow-Credentials", "true");
}

async function handleWebRequest(
  req: IncomingMessage,
  res: ServerResponse,
  handler: (webReq: Request) => Promise<Response>
) {
  const protocol = req.headers["x-forwarded-proto"] || "http";
  const host = req.headers["x-forwarded-host"] || req.headers.host || "localhost";
  const url = new URL(req.url || "/", `${protocol}://${host}`);

  const method = (req.method || "GET").toUpperCase();
  const hasBody = method !== "GET" && method !== "HEAD";

  let body: Uint8Array | undefined;
  if (hasBody) {
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
    }
    body = new Uint8Array(Buffer.concat(chunks));
  }

  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (v) {
      if (Array.isArray(v)) {
        for (const item of v) headers.append(k, item);
      } else {
        headers.set(k, v);
      }
    }
  }

  const webReq = new Request(url.toString(), {
    method,
    headers,
    body: body as BodyInit | undefined,
    // @ts-ignore
    duplex: "half",
  });

  const webRes = await handler(webReq);

  res.statusCode = webRes.status;
  webRes.headers.forEach((v, k) => {
    res.setHeader(k, v);
  });

  if (webRes.body) {
    const reader = webRes.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(Buffer.from(value));
    }
    res.end();
  } else {
    res.end();
  }
}

function serveStaticFile(req: IncomingMessage, res: ServerResponse, filePath: string) {
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) return false;

    const ext = path.extname(filePath).toLowerCase();
    const mime = MIME_TYPES[ext] || "application/octet-stream";

    res.statusCode = 200;
    res.setHeader("Content-Type", mime);
    res.setHeader("Content-Length", stat.size);

    if (filePath.endsWith("index.html")) {
      res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
      res.setHeader("Pragma", "no-cache");
      res.setHeader("Expires", "0");
    } else if (filePath.includes("/assets/") || filePath.includes("\\assets\\")) {
      res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    } else {
      res.setHeader("Cache-Control", "public, max-age=3600");
    }

    if (req.method === "HEAD") {
      res.end();
      return true;
    }

    const stream = fs.createReadStream(filePath);
    stream.pipe(res);
    return true;
  } catch {
    return false;
  }
}

const server = http.createServer(async (req, res) => {
  setCorsHeaders(req, res);

  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return;
  }

  const rawUrl = req.url || "/";
  const [pathname, qs = ""] = rawUrl.split("?");
  const query = new URLSearchParams(qs);

  try {
    // 1. Health & Ping
    if (pathname === "/api/ping" || pathname === "/health" || pathname === "/ping") {
      res.statusCode = 200;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ ok: true, status: "healthy", timestamp: Date.now() }));
      return;
    }

    // 2. Gateway routes: /api/v1/* and /v1/*
    if (pathname.startsWith("/api/v1") || pathname.startsWith("/v1")) {
      let subPath = query.get("__p") || "";
      if (!subPath) {
        subPath = pathname.replace(/^\/(?:api\/)?v1\/?/, "");
      }
      const core = toCoreRequest(req, subPath, query);
      const result = await handleGateway(core, Date.now());
      await sendCoreResponse(res, result);
      return;
    }

    // 3. Proxy routes: /api/proxy/*
    if (pathname.startsWith("/api/proxy")) {
      await handleWebRequest(req, res, handleProxy);
      return;
    }

    // 4. Key Management: /api/keys
    if (pathname.startsWith("/api/keys")) {
      const core = toCoreRequest(req, "", query);
      const result = await handleKeys(core, Date.now());
      await sendCoreResponse(res, result);
      return;
    }

    // 5. Data Storage: /api/data
    if (pathname.startsWith("/api/data")) {
      const core = toCoreRequest(req, "", query);
      const result = await handleData(core, Date.now());
      await sendCoreResponse(res, result);
      return;
    }



    // 7. Full Backup & Restore: /api/backup
    if (pathname.startsWith("/api/backup")) {
      const core = toCoreRequest(req, "", query);
      const result = await handleBackup(core, Date.now());
      await sendCoreResponse(res, result);
      return;
    }



    // 7. Static files and SPA fallback
    if (fs.existsSync(DIST_DIR)) {
      const safePath = path.normalize(decodeURIComponent(pathname)).replace(/^(\.\.[\/\\])+/, "");
      const fullPath = path.join(DIST_DIR, safePath);

      if (safePath !== "/" && fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
        if (serveStaticFile(req, res, fullPath)) return;
      }

      // Single Page Application (SPA) fallback to index.html
      const indexPath = path.join(DIST_DIR, "index.html");
      if (fs.existsSync(indexPath)) {
        serveStaticFile(req, res, indexPath);
        return;
      }
    }

    res.statusCode = 404;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Not found" }));
  } catch (err) {
    sendError(res, err);
  }
});

server.listen(PORT, HOST, () => {
  console.log(`> AI Provider Hub Server running at http://${HOST}:${PORT}`);
});

process.on("SIGTERM", () => {
  console.log("SIGTERM received, closing server...");
  server.close(() => process.exit(0));
});

process.on("SIGINT", () => {
  console.log("SIGINT received, closing server...");
  server.close(() => process.exit(0));
});
