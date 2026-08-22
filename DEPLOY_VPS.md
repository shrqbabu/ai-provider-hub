# 🚀 VPS Hosting & Deployment Guide for AI Provider Hub

Aap apne AI Provider Hub ko kisi bhi VPS (Ubuntu, Debian, CentOS, etc. - jaise DigitalOcean, Hetzner, AWS EC2, Linode, Contabo, Vultr) par 2 tareeqon se host kar sakte hain:

---

## ⚡ Method 1: Docker Deployment (Sabse Aasan & Recommended)

Agar aapke VPS par Docker aur Docker Compose installed hain, toh aap sirf 1 command se deploy kar sakte hain.

### Step 1: VPS par Repository Clone Karein
```bash
git clone https://github.com/shrqbabu/ai-provider-hub.git
cd ai-provider-hub
```

### Step 2: Environment Variables Set Karein
```bash
cp .env.example .env
nano .env
```
Apni Firebase details aur secrets `.env` file mein daal kar save karein (`Ctrl+O`, `Enter`, `Ctrl+X`).

### Step 3: Container Start Karein
```bash
docker compose up -d --build
```
Aapka application `http://your-vps-ip:3000` par live ho jayega!

Container status check karne ke liye:
```bash
docker compose ps
docker compose logs -f
```

---

## 🛠 Method 2: Node.js + PM2 + Nginx Deployment (Standard VPS)

### Step 1: VPS Dependencies Install Karein (Node.js 20 & PM2)
```bash
# Update packages
sudo apt update && sudo apt upgrade -y

# Node.js 20 install karein
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs nginx git

# PM2 globally install karein
sudo npm install -g pm2
```

### Step 2: Project Clone aur Dependencies Install Karein
```bash
git clone https://github.com/shrqbabu/ai-provider-hub.git
cd ai-provider-hub

# Dependencies install karein
npm install
```

### Step 3: Environment File Configure Karein
```bash
cp .env.example .env
nano .env
```

### Step 4: Build aur Start Karein
```bash
# Frontend + Standalone Node Server Build karein
npm run build

# PM2 se background mein start karein
pm2 start ecosystem.config.cjs

# Server reboot hone par auto-start enable karein
pm2 save
pm2 startup
```

---

## 🔒 Step 5: Nginx Reverse Proxy & Free SSL (Let's Encrypt)

Apne domain (e.g. `ai.yourdomain.com`) ko port 3000 se connect karne ke liye:

### 1. Nginx Config Create Karein
```bash
sudo nano /etc/nginx/sites-available/ai-provider-hub
```

Niche diya gaya config paste karein (`your-domain.com` ko apne domain se replace karein):
```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;

        # WebSocket & Streaming Headers
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # SSE Streaming ke liye buffering disable karein
        proxy_buffering off;
        proxy_cache off;
        chunked_transfer_encoding on;

        proxy_read_timeout 300s;
        proxy_send_timeout 300s;
    }
}
```

### 2. Enable & Test Nginx
```bash
sudo ln -s /etc/nginx/sites-available/ai-provider-hub /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

### 3. Free SSL Certificate Install Karein (Certbot)
```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.com
```

---

## 🔄 Updates Kaise Karein (Future Deployments)
Jab bhi naya code push ho, VPS par sirf yeh commands run karein:

```bash
git pull origin main
# sirf tab chalayein jab package.json change hua ho:  npm ci --omit=dev
pm2 restart ai-provider-hub
```

> **⚠️ 1GB RAM VPS ke liye dhyan dein:** repo mein `dist/` (frontend) aur `dist-server/` (server bundle) pehle se built aur tracked hain — isliye VPS par `npm run build` chalane ki zaroorat **nahi** hai. PM2 chalte hue Vite build VPS ki poori RAM kha jaata hai (CPU 100%, build atak jaata hai). Agar kabhi VPS par build karna hi ho to pehle `pm2 stop ai-provider-hub` karein, phir `NODE_OPTIONS="--max-old-space-size=700" npm run build`, phir `pm2 restart ai-provider-hub`. Behtar: PC par `npm run build` karke `dist/`+`dist-server/` commit/push karein aur VPS par sirf pull karein.

*(Ya agar Docker use kar rahe hain: `git pull && docker compose up -d --build`)*
