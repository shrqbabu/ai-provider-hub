# ⚡ AI Provider Hub

A powerful, universal AI Gateway, Proxy, and Multi-Provider Management Platform. Connect OpenAI, Claude (Anthropic), Google AI Studio (Gemini), Antigravity (Google OAuth), NVIDIA NIM, OpenRouter, and custom endpoints with **automatic fallback combos, universal format translation, live model testing, and self-hosted VPS data storage (OmniRoute style)**.

---

## ✨ Features

- **💾 Self-Hosted VPS Storage (Zero-Config SQLite / Local DB)**:
  - All providers, API keys, models, fallback combos, chat histories, prompts, and gateway keys are saved locally in `./data/` on your VPS.
  - **Firebase is 100% optional!** Runs out-of-the-box without needing any external cloud database.
- **🔄 1-Click Data Backup & Restore (Import / Export)**:
  - Export your complete hub state into a single JSON file (`ai-provider-hub-backup-YYYY-MM-DD.json`).
  - Import / restore backup on any VPS or local machine with 1 click.
- **🌐 Universal Format Translation Bridge**:
  - Connect your Gateway key (`ah-...`) to Claude Desktop, Cursor, Cline, OpenCode, Aider, or any OpenAI/Anthropic SDK.
  - Automatically translates incoming requests:
    - **Anthropic (`/v1/messages`)** $\longleftrightarrow$ **OpenAI (`/v1/chat/completions`)** $\longleftrightarrow$ **Google Gemini (`generateContent` / `streamGenerateContent`)**.
  - Full support for SSE streaming and tool calling across all providers.
- **🔌 Multi-Provider Support**:
  - **OpenAI**: GPT-4o, o1, o3-mini, GPT-4.1 catalog.
  - **Claude (Anthropic)**: Claude 3.7 Sonnet, 3.5 Sonnet, 3.5 Haiku, Opus.
  - **Google AI Studio**: Gemini 2.5 Pro, 2.5 Flash, 2.0 Flash, Flash Thinking with official API key.
  - **Antigravity (Google OAuth)**: Free Google OAuth authentication for Gemini 2.5/2.0 and Claude models.
  - **NVIDIA NIM & OpenRouter**: 200+ open and proprietary models.
  - **Custom Endpoints**: Any OpenAI-compatible endpoint (Groq, Together, Ollama, LM Studio, vLLM, LiteLLM).
- **🛡 Multi-Key Fallback & Redundancy**:
  - Add multiple API keys per provider. The gateway automatically falls back top-to-bottom on rate limits or errors.
- **🔀 Smart Fallback Combos**:
  - Chain multiple models across different providers in priority order. If Model A fails or rate-limits, Model B responds seamlessly.
- **🧪 Live Model Testing & Filtering**:
  - 1-Click model connectivity and latency testing.
  - Filter models by provider, tier (free/paid), favorite, or disconnected state.

---

## 🖥 VPS Deployment & Setup Guide

### 🚀 Method 1: Node.js + PM2 + Nginx (Standard VPS with Domain & SSL)

This is the recommended method to run on Ubuntu / Debian VPS with your custom domain (e.g. `ai-provider.duckdns.org`) and free HTTPS/SSL.

#### Step 1: Install System Dependencies
```bash
# Update Ubuntu packages
sudo apt update && sudo apt upgrade -y

# Install Node.js 20, Nginx, Git, Certbot
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs nginx git certbot python3-certbot-nginx
sudo npm install -g pm2
```

#### Step 2: Clone & 1-Command Setup
```bash
git clone https://github.com/shrqbabu/ai-provider-hub.git
cd ai-provider-hub

# 1-Command Install & Build (Automatically creates .env, data dir, and builds frontend + server)
npm run setup
```

#### Step 3: Start Service with PM2
```bash
# Start in cluster mode
pm2 start ecosystem.config.cjs

# Save PM2 process list and configure auto-start on server reboot
pm2 save
pm2 startup
```

#### Step 4: Configure Domain & Free SSL (Let's Encrypt)
```bash
# Copy pre-configured Nginx config
sudo cp nginx.conf /etc/nginx/sites-available/ai-provider-hub
sudo ln -s /etc/nginx/sites-available/ai-provider-hub /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default

# Test and reload Nginx
sudo nginx -t
sudo systemctl reload nginx

# Issue Free Let's Encrypt SSL Certificate
sudo certbot --nginx -d ai-provider.duckdns.org
```

🎉 Your AI Provider Hub is now live with HTTPS at **`https://ai-provider.duckdns.org`**!

---

### 🐳 Method 2: Docker & Docker Compose (1-Command Startup)

If you prefer containerized deployment with persistent volume:

```bash
# 1. Clone repository
git clone https://github.com/shrqbabu/ai-provider-hub.git
cd ai-provider-hub

# 2. Configure environment
cp .env.example .env
nano .env

# 3. Start container with persistent storage
docker compose up -d --build
```
Your app will be live at `http://your-vps-ip:3000` (Data is persisted in `./data`).

---

## 📦 Data Backup & Restore (Import / Export)

You can backup and restore all your data anytime from the UI:

1. Open **Settings** (`/settings`) $\rightarrow$ **Data Storage & Backup**.
2. **Export Backup (JSON)**: Click **"Export Backup (JSON)"** to download `ai-provider-hub-backup-YYYY-MM-DD.json`.
3. **Import Backup (JSON)**: Click **"Import Backup (JSON)"** and select your backup file. All providers, models, combos, chats, and keys will be restored instantly!

---

## 🔑 Environment Variables (`.env`)

| Variable | Required | Description | Default / Example |
| :--- | :--- | :--- | :--- |
| `PORT` | Optional | Port for the production server | `3000` |
| `HOST` | Optional | Host bind address | `0.0.0.0` |
| `NODE_ENV` | Optional | Environment mode | `production` |
| `DATA_DIR` | Optional | Path for local SQLite / persistent database | `./data` |
| `GATEWAY_UPSTREAM_TTFB_MS` | Optional | Max wait for an upstream provider's first byte before falling back to the next key/combo member. Streams are never cut after headers arrive. `0` disables. | `60000` |
| `FIREBASE_SERVICE_ACCOUNT` | **Optional** | Firebase Admin SDK JSON (If not set, uses local VPS SQLite DB) | `{"type":"service_account",...}` |
| `ANTIGRAVITY_CLIENT_ID` | Optional | Google OAuth Client ID for Antigravity login | `10710...apps.googleusercontent.com` |
| `ANTIGRAVITY_CLIENT_SECRET` | Optional | Google OAuth Client Secret | `GOCSPX-...` |

---

## 📡 Gateway & Proxy API Endpoints

| Endpoint | Method | Description |
| :--- | :--- | :--- |
| `/v1/chat/completions` | `POST` | OpenAI-compatible Chat Completions (Translates to target provider) |
| `/v1/messages` | `POST` | Anthropic-compatible Messages API (Translates to target provider) |
| `/v1/models` | `GET` | List all available models & custom combos |
| `/api/proxy/*` | `ALL` | Web App CORS Proxy (Supports Google, Claude, OpenAI, OpenRouter) |
| `/api/keys` | `GET / POST / DELETE` | Create & manage Gateway API keys (`ah-...`) |
| `/api/backup` | `GET / POST` | Export and restore full database backup JSON |
| `/api/oauth/antigravity` | `POST` | Antigravity Google OAuth token exchange & refresh |
| `/api/ping` | `GET` | Server Health check endpoint |

---

## 🔄 Updating Your VPS Deployment

Whenever you push new updates to GitHub:

```bash
cd ai-provider-hub
git pull origin main
npm install
npm run build
pm2 restart ai-provider-hub
```
*(Or with Docker: `docker compose up -d --build`)*

---

## 📄 License
MIT License. Free for personal and commercial use.
