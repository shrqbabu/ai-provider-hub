import { spawn, execSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";

export interface CliToolInfo {
  name: string;
  command: string;
  installed: boolean;
  path?: string;
  version?: string;
}

interface CliSession {
  dir: string;
  turnCount: number;
  createdAt: number;
  lastUsedAt: number;
  model: string;
}

const MAX_SESSION_TURNS = 50;
const SESSION_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours
const sessionStore = new Map<string, CliSession>();

function getOrCreateSession(sessionKey: string, model: string): { dir: string; isNewSession: boolean } {
  const now = Date.now();
  const existing = sessionStore.get(sessionKey);

  if (existing) {
    const isExpired = now - existing.lastUsedAt > SESSION_TTL_MS;
    const isTurnLimit = existing.turnCount >= MAX_SESSION_TURNS;
    const isModelChange = existing.model !== model;

    if (!isExpired && !isTurnLimit && !isModelChange && fs.existsSync(existing.dir)) {
      existing.turnCount++;
      existing.lastUsedAt = now;
      return { dir: existing.dir, isNewSession: false };
    }

    try {
      if (fs.existsSync(existing.dir)) {
        fs.rmSync(existing.dir, { recursive: true, force: true });
      }
    } catch {
      // ignore
    }
  }

  const safeKey = sessionKey.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 32);
  const sessionDir = path.join(os.tmpdir(), "ai_hub_cli_sessions", `${safeKey}_${Date.now()}`);
  try {
    fs.mkdirSync(sessionDir, { recursive: true });
  } catch {
    // ignore
  }

  sessionStore.set(sessionKey, {
    dir: sessionDir,
    turnCount: 1,
    createdAt: now,
    lastUsedAt: now,
    model,
  });

  return { dir: sessionDir, isNewSession: true };
}

const SUPPORTED_TOOLS: Array<{ name: string; command: string; versionFlag: string; runArgs: (model: string, prompt: string, isContinue?: boolean) => string[] }> = [
  {
    name: "Antigravity CLI (agy)",
    command: "agy",
    versionFlag: "--version",
    runArgs: (model, prompt, _isContinue = false) => {
      let cleanModel = (model || "gemini-3.7-flash").replace(/^(cli|antigravity)\//, "").trim();
      let effort = "low"; // Default to ultra-fast low reasoning effort (1-2s latency)
      if (cleanModel.includes("high")) effort = "high";
      else if (cleanModel.includes("medium")) effort = "medium";
      else if (cleanModel.includes("low")) effort = "low";

      cleanModel = cleanModel.replace(/-(high|medium|low)$/, "");

      if (cleanModel.includes("opus")) cleanModel = "claude-opus-4-6-thinking";
      else if (cleanModel.includes("sonnet")) cleanModel = "claude-sonnet-4-6-thinking";
      else if (cleanModel.includes("gpt-oss")) cleanModel = "gpt-oss-120b";

      const args = [
        "-p",
        prompt,
        "--model",
        cleanModel,
        "--dangerously-skip-permissions",
        "--disable-slash-commands",
      ];
      if (
        cleanModel.startsWith("gemini") ||
        cleanModel.startsWith("gpt-oss") ||
        cleanModel.includes("flash") ||
        cleanModel.includes("pro")
      ) {
        args.push("--effort", effort);
      }
      return args;
    },
  },
  {
    name: "Gemini CLI",
    command: "gemini",
    versionFlag: "--version",
    runArgs: (model, prompt) => ["--model", model || "gemini-2.5-flash", prompt],
  },
  {
    name: "Claude Code CLI",
    command: "claude",
    versionFlag: "--version",
    runArgs: (model, prompt) => ["-p", prompt],
  },
  {
    name: "Ollama",
    command: "ollama",
    versionFlag: "--version",
    runArgs: (model, prompt) => ["run", model || "llama3.2", prompt],
  },
];

export function detectInstalledCliTools(): CliToolInfo[] {
  const isWindows = process.platform === "win32";
  const whichCmd = isWindows ? "where" : "which";
  const homeDir = process.env.HOME || process.env.USERPROFILE || "";
  const customEnv = {
    ...process.env,
    PATH: `${homeDir}/.antigravity/bin:${homeDir}/.local/bin:${homeDir}/bin:/usr/local/bin:/usr/bin:${process.env.PATH || ""}`,
    TERM: "dumb",
    CI: "true",
    NO_COLOR: "1",
    FORCE_COLOR: "0",
  };

  return SUPPORTED_TOOLS.map((tool) => {
    try {
      const pathOut = execSync(`${whichCmd} ${tool.command}`, {
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "ignore"],
        timeout: 2000,
        env: customEnv,
      }).trim();

      const toolPath = pathOut.split("\n")[0].trim();
      let version = "";
      try {
        version = execSync(`${tool.command} ${tool.versionFlag}`, {
          encoding: "utf-8",
          stdio: ["ignore", "pipe", "ignore"],
          timeout: 2000,
        }).trim().slice(0, 40);
      } catch {
        // version flag optional
      }

      return {
        name: tool.name,
        command: tool.command,
        installed: true,
        path: toolPath,
        version: version || "installed",
      };
    } catch {
      return {
        name: tool.name,
        command: tool.command,
        installed: false,
      };
    }
  });
}

export function executeCliCompletion(options: {
  command?: string;
  model: string;
  messages: Array<{ role: string; content: string }>;
  stream?: boolean;
  signal?: AbortSignal;
  sessionId?: string;
}): { stream: ReadableStream<Uint8Array>; cancel: () => void } | { promise: Promise<any>; cancel: () => void } {
  const { command = "agy", model = "gemini-3.7-flash", messages = [], stream = false, signal, sessionId = "default_cli_session" } = options;

  const { dir: sessionCwd, isNewSession } = getOrCreateSession(sessionId, model);

  // Extract clean prompt text from messages
  let prompt = "";
  if (!messages || messages.length === 0) {
    prompt = "Hello";
  } else if (messages.length === 1) {
    const m = messages[0];
    prompt = typeof m.content === "string" ? m.content : JSON.stringify(m.content);
  } else {
    const nonSystem = messages.filter((m) => m.role !== "system");
    if (nonSystem.length === 1 && nonSystem[0].role === "user") {
      const u = nonSystem[0];
      prompt = typeof u.content === "string" ? u.content : JSON.stringify(u.content);
    } else {
      prompt = messages
        .map((m) => {
          const role = m.role === "assistant" ? "Assistant" : m.role === "system" ? "System" : "User";
          const text = typeof m.content === "string" ? m.content : JSON.stringify(m.content);
          return `${role}: ${text}`;
        })
        .join("\n\n") + "\n\nAssistant:";
    }
  }

  // Match tool config or use generic spawn
  const toolConfig = SUPPORTED_TOOLS.find((t) => t.command === command) || {
    name: command,
    command,
    versionFlag: "--version",
    runArgs: (m: string, p: string) => [
      "-p",
      p,
      "--model",
      m,
      "--dangerously-skip-permissions",
      "--disable-slash-commands",
    ],
  };

  const args = toolConfig.runArgs(model, prompt, false);
  let child: ChildProcessWithoutNullStreams | null = null;

  const cancel = () => {
    if (child && !child.killed) {
      try {
        child.kill("SIGTERM");
        setTimeout(() => {
          if (child && !child.killed) child.kill("SIGKILL");
        }, 1000);
      } catch {
        // ignore
      }
    }
  };

  if (signal) {
    signal.addEventListener("abort", cancel);
  }

  const homeDir = process.env.HOME || process.env.USERPROFILE || "";
  const customEnv = {
    ...process.env,
    PATH: `${homeDir}/.antigravity/bin:${homeDir}/.local/bin:${homeDir}/bin:/usr/local/bin:/usr/bin:${process.env.PATH || ""}`,
    TERM: "dumb",
    CI: "true",
    NO_COLOR: "1",
    FORCE_COLOR: "0",
  };

  if (stream) {
    const readable = new ReadableStream<Uint8Array>({
      start(controller) {
        const encoder = new TextEncoder();
        const chatId = `chatcmpl-cli-${Date.now()}`;
        const created = Math.floor(Date.now() / 1000);

        try {
          console.log(`[CLI Stream] Spawning (session=${sessionId}, new=${isNewSession}): ${command} ${args.join(" ")} in ${sessionCwd}`);
          child = spawn(command, args, {
            stdio: ["ignore", "pipe", "pipe"],
            shell: process.platform === "win32",
            cwd: sessionCwd,
            env: customEnv,
          });

          // Safety timeout (120 seconds)
          const timer = setTimeout(() => {
            if (child && !child.killed) {
              console.warn(`[CLI Stream] Process timed out after 120s, killing: ${command}`);
              child.kill("SIGTERM");
            }
          }, 120000);

          // Send initial role chunk
          const initChunk = {
            id: chatId,
            object: "chat.completion.chunk",
            created,
            model,
            choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }],
          };
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(initChunk)}\n\n`));

          let stdoutText = "";
          let stderrText = "";

          child.stdout.on("data", (chunk: Buffer) => {
            const text = chunk.toString("utf-8");
            stdoutText += text;
            const dataChunk = {
              id: chatId,
              object: "chat.completion.chunk",
              created,
              model,
              choices: [{ index: 0, delta: { content: text }, finish_reason: null }],
            };
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(dataChunk)}\n\n`));
          });

          child.stderr.on("data", (errChunk: Buffer) => {
            const errStr = errChunk.toString("utf-8");
            stderrText += errStr;
            console.error(`[CLI stderr]`, errStr);
          });

          child.on("close", (code) => {
            clearTimeout(timer);
            if (code !== 0 && stdoutText.trim().length === 0 && stderrText.trim().length > 0) {
              const errChunk = {
                id: chatId,
                object: "chat.completion.chunk",
                created,
                model,
                choices: [{ index: 0, delta: { content: `\n[CLI Error: ${stderrText.trim()}]` }, finish_reason: "error" }],
              };
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(errChunk)}\n\n`));
            } else {
              const finalChunk = {
                id: chatId,
                object: "chat.completion.chunk",
                created,
                model,
                choices: [{ index: 0, delta: {}, finish_reason: code === 0 ? "stop" : "error" }],
              };
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(finalChunk)}\n\n`));
            }
            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
            controller.close();
          });

          child.on("error", (err) => {
            clearTimeout(timer);
            console.error(`[CLI spawn error]`, err);
            const errChunk = {
              id: chatId,
              object: "chat.completion.chunk",
              created,
              model,
              choices: [{ index: 0, delta: { content: `\n[CLI Error: ${err.message}]` }, finish_reason: "error" }],
            };
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(errChunk)}\n\n`));
            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
            controller.close();
          });
        } catch (err: any) {
          controller.enqueue(encoder.encode(`data: {"error":{"message":"${err.message || "Failed to spawn CLI"}"}}\n\n`));
          controller.close();
        }
      },
      cancel() {
        cancel();
      },
    });

    return { stream: readable, cancel };
  }

  // Non-streaming Promise
  const promise = new Promise((resolve, reject) => {
    try {
      console.log(`[CLI Sync] Spawning (session=${sessionId}, new=${isNewSession}): ${command} ${args.join(" ")} in ${sessionCwd}`);
      child = spawn(command, args, {
        stdio: ["ignore", "pipe", "pipe"],
        shell: process.platform === "win32",
        cwd: sessionCwd,
        env: customEnv,
      });

      const timer = setTimeout(() => {
        if (child && !child.killed) {
          console.warn(`[CLI Sync] Process timed out after 120s, killing: ${command}`);
          child.kill("SIGTERM");
        }
      }, 120000);

      let stdout = "";
      let stderr = "";

      child.stdout.on("data", (c: Buffer) => {
        stdout += c.toString("utf-8");
      });

      child.stderr.on("data", (c: Buffer) => {
        stderr += c.toString("utf-8");
      });

      child.on("close", (code) => {
        clearTimeout(timer);
        console.log(`[CLI close code=${code}], stdout length=${stdout.length}, stderr=${stderr}`);
        if (code === 0 || stdout.trim().length > 0) {
          resolve({
            id: `chatcmpl-cli-${Date.now()}`,
            object: "chat.completion",
            created: Math.floor(Date.now() / 1000),
            model,
            choices: [
              {
                index: 0,
                message: { role: "assistant", content: stdout.trim() || "OK" },
                finish_reason: "stop",
              },
            ],
            usage: {
              prompt_tokens: Math.ceil(prompt.length / 4),
              completion_tokens: Math.ceil(stdout.length / 4),
              total_tokens: Math.ceil((prompt.length + stdout.length) / 4),
            },
          });
        } else {
          reject(new Error(stderr.trim() || `CLI exited with code ${code}`));
        }
      });

      child.on("error", (err) => {
        clearTimeout(timer);
        console.error(`[CLI sync spawn error]`, err);
        reject(err);
      });
    } catch (err) {
      reject(err);
    }
  });

  return { promise, cancel };
}
