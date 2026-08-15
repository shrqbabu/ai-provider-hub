#!/bin/bash
# ==============================================================================
# AI Provider Hub - 1-Line Automated VPS Installer
# ==============================================================================

set -e

echo "🚀 Starting 1-Line Setup for AI Provider Hub..."

# 1. Update packages and install prerequisites if on Ubuntu/Debian
if command -v apt-get >/dev/null 2>&1; then
  echo "📦 Updating system packages & installing Node.js, Git, PM2..."
  sudo apt-get update -y
  if ! command -v node >/dev/null 2>&1; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt-get install -y nodejs git
  fi
  if ! command -v pm2 >/dev/null 2>&1; then
    sudo npm install -g pm2
  fi
fi

# 2. Install dependencies
echo "📦 Installing npm dependencies..."
npm install

# 3. Setup environment and build
echo "🔨 Initializing config & building project..."
npm run setup

# 4. Start with PM2 if PM2 is available, otherwise normal start
if command -v pm2 >/dev/null 2>&1; then
  echo "🚀 Launching AI Provider Hub with PM2..."
  pm2 start ecosystem.config.cjs
  pm2 save
  echo "✔ AI Provider Hub is running in background on port 3000!"
else
  echo "🚀 Launching AI Provider Hub on port 3000..."
  npm start
fi
