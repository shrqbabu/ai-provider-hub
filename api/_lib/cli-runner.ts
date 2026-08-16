import { spawn, execSync, type ChildProcessWithoutNullStreams } from "node:child_process";

export interface CliToolInfo {
  name: string;
  command: string;
  installed: boolean;
  path?: string;
  version?: string;
}

const SUPPORTED_TOOLS: Array<{ name: string; command: string; versionFlag: string; runArgs: (model: string, prompt: string) => string[] }> = [
  {
    name: "Antigravity CLI (agy)",
    command: "agy",
    versionFlag: "--version",
    runArgs: (model, prompt) => ["chat", "--model", model || "gemini-2.5-flash", prompt],
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

  return SUPPORTED_TOOLS.map((tool) => {
    try {
      const pathOut = execSync(`${whichCmd} ${tool.command}`, {
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "ignore"],
        timeout: 2000,
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
}): { stream: ReadableStream<Uint8Array>; cancel: () => void } | { promise: Promise<any>; cancel: () => void } {
  const { command = "agy", model = "gemini-2.5-flash", messages, stream = false, signal } = options;

  // Extract prompt text from messages
  const lastUserMsg = messages.filter((m) => m.role === "user").pop();
  const prompt = typeof lastUserMsg?.content === "string" ? lastUserMsg.content : "hello";

  // Match tool config or use generic spawn
  const toolConfig = SUPPORTED_TOOLS.find((t) => t.command === command) || {
    name: command,
    command,
    versionFlag: "--version",
    runArgs: (m: string, p: string) => ["chat", "--model", m, p],
  };

  const args = toolConfig.runArgs(model, prompt);
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

  if (stream) {
    const readable = new ReadableStream<Uint8Array>({
      start(controller) {
        const encoder = new TextEncoder();
        const chatId = `chatcmpl-cli-${Date.now()}`;
        const created = Math.floor(Date.now() / 1000);

        try {
          child = spawn(command, args, {
            stdio: ["pipe", "pipe", "pipe"],
            shell: process.platform === "win32",
          });

          // Send initial role chunk
          const initChunk = {
            id: chatId,
            object: "chat.completion.chunk",
            created,
            model,
            choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }],
          };
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(initChunk)}\n\n`));

          child.stdout.on("data", (chunk: Buffer) => {
            const text = chunk.toString("utf-8");
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
            console.error(`[CLI stderr]`, errChunk.toString("utf-8"));
          });

          child.on("close", (code) => {
            const finalChunk = {
              id: chatId,
              object: "chat.completion.chunk",
              created,
              model,
              choices: [{ index: 0, delta: {}, finish_reason: code === 0 ? "stop" : "error" }],
            };
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(finalChunk)}\n\n`));
            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
            controller.close();
          });

          child.on("error", (err) => {
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
      child = spawn(command, args, {
        stdio: ["pipe", "pipe", "pipe"],
        shell: process.platform === "win32",
      });

      let stdout = "";
      let stderr = "";

      child.stdout.on("data", (c: Buffer) => {
        stdout += c.toString("utf-8");
      });

      child.stderr.on("data", (c: Buffer) => {
        stderr += c.toString("utf-8");
      });

      child.on("close", (code) => {
        if (code === 0 || stdout.trim().length > 0) {
          resolve({
            id: `chatcmpl-cli-${Date.now()}`,
            object: "chat.completion",
            created: Math.floor(Date.now() / 1000),
            model,
            choices: [
              {
                index: 0,
                message: { role: "assistant", content: stdout.trim() },
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

      child.on("error", reject);
    } catch (err) {
      reject(err);
    }
  });

  return { promise, cancel };
}
