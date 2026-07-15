# AI Provider Hub

A production-ready, **100% frontend** AI chat client inspired by Claude.ai. Connect
your own API keys — OpenAI, Anthropic, NVIDIA NIM, OpenRouter, or any OpenAI-compatible
endpoint (Ollama, LM Studio, vLLM, LiteLLM) — and chat with any model. Every request
goes directly from your browser to the provider. No backend, no proxy, no auth.

## Features

- 🔑 Bring-your-own-key. Keys stored locally (IndexedDB), lightly obfuscated.
- 🌍 5 provider types: OpenAI, NVIDIA NIM, Anthropic, OpenRouter, Custom.
- 🔎 Automatic model discovery via `client.models.list()` with capability inference.
- ✍️ Manual model entry for providers without a `/models` endpoint (e.g. Anthropic).
- 💬 Claude.ai-inspired chat with streaming, retry, stop, copy, delete.
- 🖼️ Image + PDF upload with drag-and-drop; capability-aware (auto-disabled if unsupported).
- 📚 Prompt Library with folders, tags, favorites.
- 📊 Local usage tracking (tokens, cost, latency) with charts.
- 🎨 Premium dark/light UI with glassmorphism, aurora gradients, Framer Motion.
- 🔎 Global search (⌘K) across chats, models, providers, prompts.
- 💾 Full export/import of every piece of local data.

## Tech Stack

React 19 · TypeScript (strict) · Vite · Tailwind · shadcn-style components · Radix UI ·
Framer Motion · Zustand · TanStack Query · React Router · react-hook-form · Zod ·
OpenAI SDK · react-markdown · remark-gfm · rehype-highlight · react-dropzone ·
react-syntax-highlighter · localforage · lucide-react · sonner · Recharts.

## Getting Started

```bash
npm install
npm run dev
```

Open http://localhost:5173.

1. Go to **Providers** → **Add provider**.
2. Paste your API key (e.g. `sk-...` for OpenAI).
3. Test the connection. Models are auto-fetched.
4. Click **New chat**, pick a model, chat away.

## Provider notes

| Provider | Base URL | Models endpoint | Notes |
| --- | --- | --- | --- |
| OpenAI | `https://api.openai.com/v1` | ✅ | Full feature support. |
| NVIDIA NIM | `https://integrate.api.nvidia.com/v1` | ✅ | Full OpenAI compatibility. |
| Anthropic | `https://api.anthropic.com/v1` | ⚠️ | Uses Anthropic's OpenAI-compat mode. `/models` not exposed — add models manually (e.g. `claude-3-5-sonnet-20241022`). |
| OpenRouter | `https://openrouter.ai/api/v1` | ✅ | 200+ models. |
| Custom | any | depends | Ollama (`http://localhost:11434/v1`), LM Studio (`http://localhost:1234/v1`), vLLM, LiteLLM… |

> **CORS**: Some hosted providers may block direct browser requests. For local
> servers, ensure CORS is enabled (Ollama and LM Studio do by default).

## Data & Privacy

Everything lives in your browser's IndexedDB (via `localforage`). API keys are
XOR-obfuscated at rest. Chats, models, prompts, and usage are exportable/importable
as JSON from **Settings → Data**.

## Scripts

- `npm run dev` — dev server
- `npm run build` — production build
- `npm run preview` — preview the build
