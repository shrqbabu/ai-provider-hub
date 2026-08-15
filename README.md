# ⚡ AI Provider Hub

A powerful, universal AI Gateway, Proxy, and Multi-Provider Management Platform. Connect OpenAI, Claude (Anthropic), Google AI Studio (Gemini), Antigravity (Google OAuth), NVIDIA NIM, OpenRouter, and custom endpoints with **automatic fallback combos, universal format translation, and live model testing**.

---

## ✨ Features

- **🌐 Universal Format Translation Bridge**:
  - Connect your Gateway key (`ah-...`) to Claude Desktop, Cursor, Cline, OpenCode, Aider, or any OpenAI/Anthropic SDK.
  - Automatically translates incoming requests:
    - **Anthropic (`/v1/messages`)** $\longleftrightarrow$ **OpenAI (`/v1/chat/completions`)** $\longleftrightarrow$ **Google Gemini (`generateContent` / `streamGenerateContent`)**.
  - Supports SSE streaming and tool calling across all providers.
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
- **🧪 Live Model Testing & Discovery**:
  - 1-Click model connectivity and latency testing.
  - Filter models by provider, tier (free/paid), favorite, or disconnected state.
- **🔒 Production Ready & Self-Hostable**:
  - Standalone Node.js server with built-in CORS, static SPA hosting, PM2, Docker, and Nginx support.

---

## 🚀 Quick Start (Local Development)

### 1. Prerequisites
- Node.js 18+ or 20+
- npm or pnpm

### 2. Installation
```bash
# Clone the repository
git clone https://github.com/shrqbabu/ai-provider-hub.git
cd ai-provider-hub

# Install dependencies
npm install

# Setup environment variables
cp .env.example .env
```

### 3. Start Development Server
```bash
npm run dev
```
Open `http://localhost:5173` in your browser.

---

## 🖥 VPS Deployment Guide

### Option 1: Docker Compose (Fastest & Recommended)

```bash
# 1. Clone repository
git clone https://github.com/shrqbabu/ai-provider-hub.git
cd ai-provider-hub

# 2. Configure environment
cp .env.example .env
nano .env

# 3. Build & start container in background
docker compose up -d --build
```
Your app will be live at `http://your-vps-ip:3000`.

---

### Option 2: Node.js + PM2 + Nginx (Standard VPS)

#### Step 1: Install System Dependencies
```bash
# Update Ubuntu packages
sudo apt update && sudo apt upgrade -y

# Install Node.js 20, Nginx, Git, Certbot
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs nginx git certbot python3-certbot-nginx
sudo npm install -g pm2
```

#### Step 2: Clone & Build Project
```bash
git clone https://github.com/shrqbabu/ai-provider-hub.git
cd ai-provider-hub

npm install
cp .env.example .env
nano .env

# Build both frontend and production server
npm run build

# Start with PM2 cluster
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup
```

#### Step 3: Configure Domain & SSL (e.g. `ai-provider.duckdns.org`)
```bash
# Copy pre-configured Nginx config
sudo cp nginx.conf /etc/nginx/sites-available/ai-provider-hub
sudo ln -s /etc/nginx/sites-available/ai-provider-hub /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default

# Test & reload Nginx
sudo nginx -t
sudo systemctl reload nginx

# Issue Free Let's Encrypt SSL Certificate
sudo certbot --nginx -d ai-provider.duckdns.org
```
Your application will be live at **`https://ai-provider.duckdns.org`** with automatic HTTPS!

---

## 🔑 Environment Variables (`.env`)

| Variable | Description | Example |
| :--- | :--- | :--- |
| `PORT` | Node.js Server Port | `3000` |
| `HOST` | Bind address | `0.0.0.0` |
| `NODE_ENV` | Environment mode | `production` |
| `VITE_FIREBASE_API_KEY` | Firebase Client API Key | `AIzaSy...` |
| `VITE_FIREBASE_AUTH_DOMAIN` | Firebase Auth Domain | `project.firebaseapp.com` |
| `VITE_FIREBASE_PROJECT_ID` | Firebase Project ID | `ai-provider-hub` |
| `FIREBASE_SERVICE_ACCOUNT` | Firebase Admin SDK Service Account JSON | `{"type":"service_account",...}` |
| `ANTIGRAVITY_CLIENT_ID` | Google OAuth Client ID (Optional) | `10710...apps.googleusercontent.com` |
| `ANTIGRAVITY_CLIENT_SECRET` | Google OAuth Client Secret (Optional) | `GOCSPX-...` |

---

## 📡 API Endpoints

| Endpoint | Method | Description |
| :--- | :--- | :--- |
| `/v1/chat/completions` | `POST` | OpenAI-compatible Chat Completions (Translates to target provider) |
| `/v1/messages` | `POST` | Anthropic-compatible Messages API (Translates to target provider) |
| `/v1/models` | `GET` | List all available models & combos |
| `/api/proxy/*` | `ALL` | Direct Web App CORS Proxy |
| `/api/keys` | `POST` | Create & verify gateway API keys |
| `/api/oauth/antigravity` | `POST` | Antigravity Google OAuth token exchange & refresh |
| `/api/ping` | `GET` | Health check endpoint |

---

## 🔄 Updating Your VPS Deployment

Whenever you push new changes to GitHub:

```bash
cd ai-provider-hub
git pull origin main
npm install
npm run build
pm2 restart ai-provider-hub
```
*(Or with Docker: `git pull && docker compose up -d --build`)*

---

## 📄 License
MIT License. Free for personal and commercial use.
