# CORRECT PROMPT — Native Android app (Claude Mobile UI)

Pehla prompt **galat** tha. Woh TypeScript / Vite / PWA / bottom-tabs dashboard document karta tha.

**Sahi product:** ek **native Android app** (Kotlin + Jetpack Compose), jo **official Claude by Anthropic mobile app** jaisi dikhe aur feel ho — lekin andar **AI Provider Hub ki saari features** hon.

Neeche wala block **as-is** kisi Android engineer / AI builder ko do. Isme React, TypeScript, Vite, PWA **mat** banana.

---

## COPY THIS PROMPT

```
Build a NATIVE Android application. Not a website. Not a PWA. Not React. Not TypeScript. Not Capacitor. Not a wrapped admin dashboard.

Stack (mandatory)
- Language: Kotlin only
- UI: Jetpack Compose + Material3 customized to match Claude Mobile — do NOT use default purple Material You as the look
- Architecture: single-activity, Compose Navigation, MVVM, Hilt, Kotlin Coroutines + Flow
- Local DB: Room (chats, messages, providers, models, combos, prompts, keys, usage, settings)
- Network: OkHttp + Retrofit talking to the existing AI Provider Hub backend
- Images: Coil
- Markdown: Markwon or multiplatform-markdown-renderer
- Min SDK 26, Target / Compile SDK 35, Gradle Kotlin DSL

The visual design MUST clone the official Claude iOS/Android app (Anthropic), not ChatGPT, not Gemini, not a settings console.

==================================================
LOOK AND FEEL — CLAUDE MOBILE (pixel-level)
==================================================

Canvas
- Light: warm cream paper #F6F1EA. Not white. Not blue-gray.
- Dark: warm charcoal #262624. Not OLED pure black, not Material #121212.
- Surfaces: #EFE8DD (light) / #30302E (dark)
- User bubble: rounded 18dp cream-tan #E8E0D4 on light, #3A3936 on dark. Full-width-ish, comfortable padding 14/16. No neon, no chat-app blue.
- Assistant: NO bubble. Bare text on the cream canvas, ~16.5sp, line-height 1.45, near-black #1C1917. After the answer, a small coral 8-point asterisk (✱) bottom-left and a tiny gray “Can make mistakes. Double-check.”
- Accent / brand: Claude coral #D97757 (hover/press #C96442). This is the ONLY saturated color.
- Logo: 8-point starburst / asterisk in that coral. Never a lightning bolt, never a robot, never a gradient cube.

Empty new-chat screen (this is the home screen — NOT a dashboard)
- Top-left: hamburger (3 lines), 44dp hit target
- Top-right: gear (settings)
- Vertically centered:
    coral asterisk ~56dp
    greeting in a soft editorial serif (e.g. Fraunces / Source Serif 4 / Newsreader), 28–32sp, weight 500
    Time-aware copy:
      morning  → “How can I help you this morning?”
      afternoon → “How can I help you this afternoon?”
      evening → “How can I help you this evening?”
      else → “Start chatting anytime”
- NO cards, NO stat tiles, NO bottom tab bar, NO FAB, NO chip cloud on the home canvas.

Composer (Claude pill — always at the bottom)
- Floating capsule, 56–64dp tall, white (light) / #30302E (dark), 28dp corner radius, hairline border, soft shadow
- Left: circular + button (attach: photo, file, folder, PDF)
- Middle: placeholder “Reply to {model display name}…” or “Chat with {model}”
- Right when empty: model chip “Sonnet ▾” style (shows current model/combo short name) OR a close X on overlay sheets
- Right when text entered: coral circular Send
- Optional mic on the empty-state overlay only
- Keyboard: IME send = send. Shift not relevant. Enter sends.

Active chat screen
- Top: centered conversation title (auto from first user line, tap to rename). No subtitle clutter.
- Messages scroll under a thin cream app bar
- Streaming: caret, no rainbow sparkles
- Stop replaces Send while streaming
- Long-press message: Copy / Retry / Delete
- Attachments render as Claude-style file cards (PDF/TXT chips) above the user bubble

Drawer (hamburger) — Claude style, NOT a 12-item admin nav dump
Top:
  [New chat] coral text button
  Search chats
Then: Recent chats (title + time, swipe to delete, pin)
Then a quiet section “Hub” (small caps label) with text rows, not colorful tiles:
  Providers
  Models
  Combos
  Compress
  Prompts
  Gateway keys
  Key store
  Cookies
  Quota
  Usage
  Trash
Footer: profile row + Sign out

Hub screens open as FULL-SCREEN destinations with a back chevron — they must still feel like Claude Settings pages (grouped lists, cream background, coral toggles), never like a dense SaaS dashboard.

==================================================
WHAT THIS APP IS (product)
==================================================
Name: AI Hub
Subtitle: AI Provider Hub
It is a Claude-like chat client that can talk to MANY providers through the user’s self-hosted AI Provider Hub (or directly to providers).

The chat is the app. Everything else is a sheet / full-screen page reached from the drawer or from the + / model chip.

==================================================
WIRE TO THE EXISTING HUB BACKEND
==================================================
Base URL is user-configurable in Settings (default http://<user-vps>:3000).

Use the hub’s real endpoints — do not invent new ones:
- POST {base}/v1/chat/completions     (OpenAI shape, SSE)
- POST {base}/v1/messages             (Anthropic shape, SSE)
- GET  {base}/v1/models               (includes combos)
- ALL  {base}/api/proxy/*             (CORS proxy to OpenAI/Claude/Gemini/NVIDIA/OpenRouter/custom)
- GET/POST/DELETE {base}/api/keys     (gateway keys ah-…)
- GET/POST {base}/api/backup
- GET/PUT/DELETE {base}/api/data?key= (providers, models, combos, chats, prompts, settings, keystore, usage, combo_logs)
- POST {base}/api/oauth/antigravity
- GET  {base}/api/quota
- GET  {base}/api/ping

Auth: if the hub has Firebase, send Bearer ID token + x-user-uid. If local-only mode, no auth header.
Persist a copy of every collection in Room so the app works offline for reading history.

Strip any virtual “aip/” prefix from model IDs before an upstream/hub request.

==================================================
ALL AI PROVIDER HUB FEATURES (must ship)
==================================================

A. Chat
- Streaming tokens into one assistant bubble
- Auto-continue up to 4 times if finish_reason=length
- Auto-resume up to 2 times if the SSE drops mid-answer and the text looks cut (open ``` or no terminal punctuation)
- Vision images, PDF, text/code inline, folder attach (skip node_modules/.git/dist, max 50 files)
- Image-generation mode when model id looks like dall-e / flux / sdxl / imagen
- Pin, favorite, export JSON, soft-delete → Trash
- Route by the MODEL’s provider, never a stale chat.providerId

B. Providers
- Catalog: OpenAI, Anthropic/Claude, Google AI Studio, Antigravity OAuth, NVIDIA NIM, OpenRouter, GitHub, Grok, Kimi, DeepSeek, Qwen, Blackbox, Custom OpenAI-compatible (Groq, Together, Ollama, LM Studio, vLLM, LiteLLM)
- authMode: apiKey | cookie | oauth
- Multiple apiKeys[] fallback (try top→bottom on 401/403/429/5xx)
- apiFormat: openai | anthropic
- Enable/disable, test connection, extra headers, custom base URL, custom logo

C. Models — full custom (this is required, not a nice-to-have)
Every model row has a Customize sheet:
  displayName
  modelId
  contextWindow          (presets 8K, 16K, 32K, 64K, 128K, 200K, 1M)
  tokenLimit             (input budget for compress; empty = contextWindow)
  maxTokens              (output cap; empty = Auto)
  temperature            0.0–2.0
  contextPromptId
  customSystemPrompt
  tokenCompress / promptCompress / compressMode
  vision, pdf, streaming, toolCalling, reasoning
  inputPrice / outputPrice per 1M
User custom fields MUST survive catalog refresh.
Add-manual model. Test one / test batch. Favorite, save, disconnect. Filter free/paid/disconnected.

D. Token limits — 3 layers, first hit wins
Output:
  1. this chat.maxTokens if > 0
  2. this model.maxTokens if > 0
  3. Settings.maxTokens if > 0
  4. Auto = 32768 if reasoning/o1/o3/deepseek-r1/qwq/thinking else 16384
Presets in UI: Auto, 1K, 2K, 4K, 8K, 16K, 32K, 64K.

Input budget for compress:
  model.tokenLimit ?: model.contextWindow ?: 128000
  minus Settings.contextReserveTokens (default 4096)
  fire when used > window * Settings.tokenCompressThreshold (default 0.75, range 0.40–0.95)

E. Token compress (history) — extractive, no second LLM
Estimate tokens = ceil(chars/4); +80 per attachment.
Keep: all system messages, last N turns (keepLastMessages default 6), and the LATEST user turn NEVER compressed.
Modes:
  off         — as-is
  light       — whitespace; long turns keep head+tail + “[…compressed…]”
  smart       — drop English filler + comments; keep first 2 sentences + last 1
  aggressive  — first sentence ~220 chars; if still over, omit oldest turns
Hindi/Devanagari must not be treated as filler.
After apply: snackbar “Saved X tokens · Y turns” and increment compressStats.

F. Prompt compress (system text)
Compress the combined system string before send:
  context prompt body
  + model.customSystemPrompt
  + chat.systemPrompt
Modes off / light / smart / aggressive (same definitions).
Compress Studio screen: two panes original vs compressed, % saved, copy, save-as-context.
Toggles + mode + threshold + keep-last + reserve live on this screen.

G. Context prompts
Prompt.kind = context | snippet
context → injected as system
snippet → copy into composer only
Priority: this chat > this model > Settings.defaultContextPromptId > none
Seed built-in templates once (do not duplicate titles):
  Concise Expert, Ultra Token Saver, Coding Pair, System Architect,
  Security Reviewer, Researcher, Teacher, Hindi–English Bilingual,
  Creative Writer, Data Analyst, Hub Operator
From chat: a small “Context” entry inside the + sheet (NOT a permanent chip bar on the cream home canvas). Same sheet also has Compress mode and Out-token presets — secondary, Claude-quiet.

H. Combos
Named fallback chains. Chat model picker lists combos first.
Try members in order. Combo Logs: who answered, attempts, tokens, duration.

I. Gateway & keys
Create/revoke ah-… gateway keys.
Show copy-paste setup for Cursor / Claude Desktop / Cline:
  base URL = {hub}/v1
  model = upstream id OR combo name
Key Store = vault of raw provider keys.
Cookie Manager = web-session providers.

J. Quota, Usage, Profile, Trash, Backup
Quota cards per provider.
Usage charts (tokens in/out, cost, latency).
Profile: name, uid, photo.
Trash: restore / empty.
Settings: theme light/dark/system, default model, default context, compress defaults, hub base URL, Export/Import JSON backup (providers, models, combos, keystore, chats, prompts, settings).

==================================================
CHAT CONTROLS (Claude way — do not copy the web dashboard)
==================================================
Do NOT put a row of admin chips under the greeting.
Do NOT put a 5-tab bottom bar (Chat/Models/Compress/Prompts/More). That is Material, not Claude.

Put power-user controls here instead:
1. Model / combo name in the composer (tap → Claude-style list: Favorites, Combos, then providers)
2. + sheet sections:
   - Photo / File / Folder
   - Context prompt
   - Compress (Off/Light/Smart/Max + token/prompt toggles)
   - Output limit (Auto…64K)
3. Gear → Settings page (limits, default context, hub URL, backup)
4. Drawer → Hub pages

==================================================
SCREENS TO SHIP
==================================================
1. Chat (empty + thread)          — Claude clone
2. Drawer                          — Claude clone
3. Model picker sheet
4. Plus sheet
5. Providers
6. Models + Customize
7. Combos + Combo logs
8. Compress Studio
9. Prompts (Context / Snippets)
10. Gateway keys + Key store + Cookies
11. Quota + Usage
12. Settings + Profile + Trash

==================================================
QUALITY BAR
==================================================
- 44dp minimum tap targets
- Predictive back, edge-to-edge, status/nav bar icons match cream/charcoal
- No layout jump when keyboard opens (imePadding)
- Streaming 60fps, no jank
- Never log API keys, cookies, or OAuth tokens
- Never ship exploit/malware tooling
- Hindi + English + Hinglish input works (no keyboard bugs)
- App name “AI Hub”, launcher icon = coral asterisk on cream

==================================================
OUT OF SCOPE (do not do)
==================================================
- Do not rebuild this as a Vite/React/TypeScript website
- Do not wrap the existing dashboard in a WebView and call it an Android app
- Do not use ChatGPT’s green bubbles or Gemini’s blue chips
- Do not put Providers/Quota/Keys on the home screen
- Do not add a Play-billing clone or fake “Pro subscribe” wall

Deliver a Gradle project that opens in Android Studio Hedgehog+ and runs on an emulator (Pixel 7, API 34) with the empty Claude-like home screen as the first frame.
```

---

## 1-line yaad rakhna

> Native Kotlin Compose app. Home screen = Claude empty chat (cream + coral asterisk + pill). Hub features live in the drawer and sheets — dashboard nahi.
