# Phase 6 — Deploy & Launch

> **Goal:** Take ArcAgents from `localhost:3000` to `https://arcagents.io` — public, secure, monitored, auto-restarting.

**Estimated time:** 3 hours
**Output:** Production deployment with HTTPS, systemd services, nginx reverse proxy, monitoring.

---

## 🎯 Outcomes of Phase 6

After this phase:

1. ✅ `https://arcagents.io` resolves and loads with SSL
2. ✅ Both web app and indexer run as systemd services (auto-restart on crash + reboot)
3. ✅ nginx reverse-proxies to Next.js with WebSocket support
4. ✅ Cloudflare DNS + DDoS protection active
5. ✅ UptimeRobot pings `/api/health` every 5 minutes
6. ✅ Log rotation configured
7. ✅ Production build optimized (smaller bundle, no dev artifacts)

---

## 📋 Pre-Phase Checklist

- [ ] Phase 5 complete (all pages working locally)
- [ ] Domain registered: `arcagents.io` (or your chosen domain)
- [ ] VPS public IP known: `curl ifconfig.me`
- [ ] Cloudflare account created
- [ ] Email ready for Let's Encrypt registration

---

## 🌐 Deployment Architecture

```
        Browser
           │
           │ HTTPS
           ▼
   ┌──────────────────────────┐
   │  Cloudflare (DNS + DDoS) │
   │  arcagents.io → VPS IP   │
   └────────────┬─────────────┘
                │
                │ HTTPS (Cloudflare → origin)
                ▼
   ┌──────────────────────────────────────┐
   │  Your VPS (Bangkok)                  │
   │  ┌────────────────────────────────┐  │
   │  │ nginx :443 (SSL via certbot)   │  │
   │  │  - /api/live → WebSocket       │  │
   │  │  - /api/*    → :3000           │  │
   │  │  - /*        → :3000           │  │
   │  └──────────────┬─────────────────┘  │
   │                 │                    │
   │                 ▼                    │
   │  ┌────────────────────────────────┐  │
   │  │  Next.js (systemd) :3000       │  │
   │  │  arc-agents-web.service        │  │
   │  └────────────────────────────────┘  │
   │                                      │
   │  ┌────────────────────────────────┐  │
   │  │  Indexer (systemd, no port)    │  │
   │  │  arc-agents-indexer.service    │  │
   │  └────────────────────────────────┘  │
   │                                      │
   │  ┌────────────────────────────────┐  │
   │  │  Postgres (Docker) :5432       │  │
   │  │  arc-pg container              │  │
   │  └────────────────────────────────┘  │
   │                                      │
   │  ┌────────────────────────────────┐  │
   │  │  Arc Node (existing)           │  │
   │  │  Reth + Malachite              │  │
   │  └────────────────────────────────┘  │
   └──────────────────────────────────────┘
```

---

## Step 6.1 — DNS Setup with Cloudflare (YOU, 15 min)

### Step 1: Add your domain

1. Log into Cloudflare → Add Site → enter `arcagents.io`
2. Choose Free plan
3. Note Cloudflare's two nameservers (e.g. `dani.ns.cloudflare.com`, `tom.ns.cloudflare.com`)
4. Go to your domain registrar → update nameservers to Cloudflare's
5. Wait for activation (usually 5–30 minutes)

### Step 2: Add DNS records

In Cloudflare DNS settings, add:

| Type | Name | Content | Proxy |
|---|---|---|---|
| A | `@` (root) | Your VPS IP | 🟠 Proxied |
| A | `www` | Your VPS IP | 🟠 Proxied |
| A | `api` (optional) | Your VPS IP | 🟠 Proxied |

### Step 3: SSL/TLS settings

In Cloudflare → SSL/TLS:
- **Encryption mode**: `Full (strict)` — this requires a valid cert on your origin (we'll get one via certbot)
- **Always Use HTTPS**: On
- **Minimum TLS Version**: 1.2
- **Automatic HTTPS Rewrites**: On

### Step 4: Verify propagation

```bash
# From your laptop
dig arcagents.io +short
# Should return Cloudflare IPs (104.x.x.x or 172.x.x.x)
```

---

## Step 6.2 — Production Build (Claude Code, 30 min)

### CLAUDE CODE PROMPT #6.2 — Production-ready build

> Prepare the project for production deployment.
>
> ## Update `apps/web/next.config.ts`
>
> Add output optimization:
>
> ```typescript
> import type { NextConfig } from 'next';
>
> const nextConfig: NextConfig = {
>   reactStrictMode: true,
>   transpilePackages: ['@arc-agents/db'],
>   output: 'standalone',         // creates apps/web/.next/standalone for easy deploy
>   poweredByHeader: false,       // hide "X-Powered-By: Next.js"
>   compress: true,
>   images: {
>     remotePatterns: [
>       { protocol: 'https', hostname: 'api.dicebear.com' },
>       { protocol: 'https', hostname: 'ipfs.io' },
>       { protocol: 'https', hostname: 'cloudflare-ipfs.com' },
>     ],
>   },
>   experimental: {
>     serverActions: { allowedOrigins: ['arcagents.io', 'www.arcagents.io'] },
>   },
> };
>
> export default nextConfig;
> ```
>
> ## Update root `package.json` build script
>
> ```json
> "scripts": {
>   "build": "pnpm --filter @arc-agents/db build && pnpm --filter @arc-agents/indexer build && pnpm --filter web build",
>   "build:web": "pnpm --filter web build",
>   "build:indexer": "pnpm --filter @arc-agents/indexer build"
> }
> ```
>
> ## Add `apps/indexer/tsconfig.json` for emit
>
> ```json
> {
>   "extends": "../../tsconfig.base.json",
>   "compilerOptions": {
>     "outDir": "./dist",
>     "rootDir": "./src",
>     "module": "commonjs",
>     "target": "ES2022",
>     "moduleResolution": "node",
>     "noEmit": false,
>     "declaration": false
>   },
>   "include": ["src/**/*"]
> }
> ```
>
> ## Add proper `package.json` start scripts
>
> In `apps/web/package.json`:
> ```json
> "start": "next start -p 3000 -H 127.0.0.1"
> ```
> (Bind to localhost only — nginx will proxy from outside.)
>
> In `apps/indexer/package.json`:
> ```json
> "start:live": "node --enable-source-maps dist/live.js"
> ```
>
> Run `pnpm build` from root and confirm it completes without errors. Report bundle size.

### YOU: Build locally

```bash
cd ~/arc-agents-explorer
pnpm build

# Expected output:
# ✓ @arc-agents/db built
# ✓ @arc-agents/indexer built (dist/)
# ✓ web built (.next/, ~5-10 MB)
```

---

## Step 6.3 — nginx Configuration (Claude Code + YOU, 30 min)

### CLAUDE CODE PROMPT #6.3 — nginx config

> Create `deploy/nginx-arcagents.conf` — a production nginx config for arcagents.io.
>
> Requirements:
> - HTTP → HTTPS redirect
> - SSL with strong ciphers (TLSv1.2+)
> - Reverse proxy to Next.js on `127.0.0.1:3000`
> - WebSocket/SSE support for `/api/live` (disable buffering, long timeouts)
> - Static asset caching (1 year for hashed `/_next/static/`)
> - Rate limit: 60 req/min per IP for `/api/*`
> - Gzip compression for text content
> - Security headers (X-Frame-Options, X-Content-Type-Options, Referrer-Policy)
> - Custom 502 error page when web app is down
>
> ```nginx
> # Rate limit zone (shared across requests)
> limit_req_zone $binary_remote_addr zone=api_zone:10m rate=60r/m;
>
> # Upstream
> upstream arcagents_app {
>     server 127.0.0.1:3000;
>     keepalive 64;
> }
>
> # Redirect HTTP → HTTPS
> server {
>     listen 80;
>     listen [::]:80;
>     server_name arcagents.io www.arcagents.io;
>     return 301 https://arcagents.io$request_uri;
> }
>
> # Redirect www → root
> server {
>     listen 443 ssl http2;
>     listen [::]:443 ssl http2;
>     server_name www.arcagents.io;
>
>     ssl_certificate /etc/letsencrypt/live/arcagents.io/fullchain.pem;
>     ssl_certificate_key /etc/letsencrypt/live/arcagents.io/privkey.pem;
>
>     return 301 https://arcagents.io$request_uri;
> }
>
> # Main server
> server {
>     listen 443 ssl http2;
>     listen [::]:443 ssl http2;
>     server_name arcagents.io;
>
>     # SSL
>     ssl_certificate /etc/letsencrypt/live/arcagents.io/fullchain.pem;
>     ssl_certificate_key /etc/letsencrypt/live/arcagents.io/privkey.pem;
>     ssl_protocols TLSv1.2 TLSv1.3;
>     ssl_ciphers 'ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384';
>     ssl_prefer_server_ciphers on;
>     ssl_session_cache shared:SSL:10m;
>     ssl_session_timeout 1d;
>     ssl_stapling on;
>     ssl_stapling_verify on;
>
>     # Security headers
>     add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
>     add_header X-Frame-Options "SAMEORIGIN" always;
>     add_header X-Content-Type-Options "nosniff" always;
>     add_header Referrer-Policy "strict-origin-when-cross-origin" always;
>     add_header Permissions-Policy "camera=(), microphone=(), geolocation=()" always;
>
>     # Gzip
>     gzip on;
>     gzip_vary on;
>     gzip_min_length 1024;
>     gzip_types text/plain text/css text/xml application/json application/javascript application/xml+rss application/atom+xml image/svg+xml;
>
>     # Logging
>     access_log /var/log/nginx/arcagents-access.log;
>     error_log /var/log/nginx/arcagents-error.log warn;
>
>     # SSE/WebSocket endpoint — NO buffering, long timeout
>     location /api/live {
>         proxy_pass http://arcagents_app;
>         proxy_http_version 1.1;
>         proxy_set_header Upgrade $http_upgrade;
>         proxy_set_header Connection 'keep-alive';
>         proxy_set_header Host $host;
>         proxy_set_header X-Real-IP $remote_addr;
>         proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
>         proxy_set_header X-Forwarded-Proto https;
>
>         # Critical for SSE
>         proxy_buffering off;
>         proxy_cache off;
>         proxy_read_timeout 24h;
>         proxy_send_timeout 24h;
>         chunked_transfer_encoding on;
>     }
>
>     # API routes — rate limited
>     location /api/ {
>         limit_req zone=api_zone burst=30 nodelay;
>         limit_req_status 429;
>
>         proxy_pass http://arcagents_app;
>         proxy_http_version 1.1;
>         proxy_set_header Host $host;
>         proxy_set_header X-Real-IP $remote_addr;
>         proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
>         proxy_set_header X-Forwarded-Proto https;
>     }
>
>     # Static asset caching
>     location /_next/static/ {
>         proxy_pass http://arcagents_app;
>         proxy_http_version 1.1;
>         proxy_set_header Host $host;
>         add_header Cache-Control "public, max-age=31536000, immutable" always;
>     }
>
>     # Everything else
>     location / {
>         proxy_pass http://arcagents_app;
>         proxy_http_version 1.1;
>         proxy_set_header Upgrade $http_upgrade;
>         proxy_set_header Connection "upgrade";
>         proxy_set_header Host $host;
>         proxy_set_header X-Real-IP $remote_addr;
>         proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
>         proxy_set_header X-Forwarded-Proto https;
>         proxy_redirect off;
>     }
>
>     # Custom 502 page
>     error_page 502 503 504 /50x.html;
>     location = /50x.html {
>         root /var/www/arcagents-errors;
>         internal;
>     }
> }
> ```
>
> Also create a friendly `deploy/50x.html` error page (dark themed, simple).

### YOU: Install nginx + certbot

```bash
# If not already installed
sudo apt update
sudo apt install -y nginx certbot python3-certbot-nginx

# Install the config
sudo cp ~/arc-agents-explorer/deploy/nginx-arcagents.conf /etc/nginx/sites-available/arcagents

# Install the 502 page
sudo mkdir -p /var/www/arcagents-errors
sudo cp ~/arc-agents-explorer/deploy/50x.html /var/www/arcagents-errors/

# Enable the site
sudo ln -s /etc/nginx/sites-available/arcagents /etc/nginx/sites-enabled/

# Disable default site
sudo rm -f /etc/nginx/sites-enabled/default

# Test config (will fail until SSL certs exist — that's OK)
sudo nginx -t
```

### YOU: Get SSL certificate

Before certbot can work, you need a basic HTTP-only config so it can complete the ACME challenge. Create a temporary config:

```bash
sudo tee /etc/nginx/sites-available/arcagents-temp <<'EOF'
server {
    listen 80;
    listen [::]:80;
    server_name arcagents.io www.arcagents.io;
    root /var/www/html;
    location /.well-known/acme-challenge/ { allow all; }
    location / { return 200 'temp\n'; }
}
EOF

sudo rm /etc/nginx/sites-enabled/arcagents
sudo ln -s /etc/nginx/sites-available/arcagents-temp /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

**IMPORTANT — Cloudflare proxy:**
Cloudflare's proxy will intercept the HTTP-01 challenge. Temporarily disable the proxy:
1. Cloudflare → DNS → for the `A @` record, toggle Proxy to ☁️ DNS only (gray cloud)
2. Wait 1 minute for propagation

Now get the cert:

```bash
sudo certbot --nginx -d arcagents.io -d www.arcagents.io \
  --email your-email@example.com \
  --agree-tos --no-eff-email --redirect
```

✅ Certbot will print `Successfully received certificate`.

Re-enable Cloudflare proxy (toggle back to 🟠 Proxied).

Now swap to the real config:

```bash
sudo rm /etc/nginx/sites-enabled/arcagents-temp
sudo ln -s /etc/nginx/sites-available/arcagents /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

### YOU: Set up auto-renewal

```bash
# Certbot installs a systemd timer for this automatically
sudo systemctl status certbot.timer

# Test the renewal process
sudo certbot renew --dry-run
```

---

## Step 6.4 — systemd Services for Web + Indexer (YOU, 30 min)

### Web service

```bash
sudo tee /etc/systemd/system/arc-agents-web.service <<'EOF'
[Unit]
Description=ArcAgents Web App (Next.js)
After=network-online.target arc-agents-indexer.service
Wants=network-online.target

[Service]
Type=simple
User=huicom
WorkingDirectory=/home/huicom/arc-agents-explorer
EnvironmentFile=/home/huicom/arc-agents-explorer/.env

ExecStart=/usr/bin/pnpm --filter web start

Restart=always
RestartSec=5s
StartLimitIntervalSec=300
StartLimitBurst=5

StandardOutput=append:/var/log/arc-agents-web.log
StandardError=append:/var/log/arc-agents-web-err.log

# Hardening
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ReadWritePaths=/home/huicom/arc-agents-explorer /var/log

[Install]
WantedBy=multi-user.target
EOF
```

### Indexer service

You already have `arc-agents-indexer.service` from Phase 3. Update it to use the built version:

```bash
sudo tee /etc/systemd/system/arc-agents-indexer.service <<'EOF'
[Unit]
Description=ArcAgents Live Indexer
After=network-online.target docker.service
Wants=network-online.target

[Service]
Type=simple
User=huicom
WorkingDirectory=/home/huicom/arc-agents-explorer
EnvironmentFile=/home/huicom/arc-agents-explorer/.env

ExecStart=/usr/bin/pnpm --filter @arc-agents/indexer start:live

Restart=always
RestartSec=10s
StartLimitIntervalSec=300
StartLimitBurst=5

StandardOutput=append:/var/log/arc-indexer.log
StandardError=append:/var/log/arc-indexer-err.log

NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF
```

### Create log files

```bash
sudo touch /var/log/arc-agents-web.log /var/log/arc-agents-web-err.log
sudo chown huicom:huicom /var/log/arc-agents-web*.log
```

### Enable + start

```bash
sudo systemctl daemon-reload
sudo systemctl enable arc-agents-web arc-agents-indexer
sudo systemctl restart arc-agents-indexer
sudo systemctl start arc-agents-web

# Check status
sudo systemctl status arc-agents-web
sudo systemctl status arc-agents-indexer
```

Both should be `active (running)`.

---

## Step 6.5 — Verify Public Access (YOU, 10 min)

```bash
# Test from your VPS
curl -I https://arcagents.io
# Should return 200 OK with HSTS header

# Test the health endpoint
curl https://arcagents.io/api/health | jq

# Test SSE (let it run for 30s)
curl -N https://arcagents.io/api/live
```

Open `https://arcagents.io` in your browser. Verify:
- [ ] HTTPS lock icon
- [ ] Homepage loads with stats
- [ ] Click into `/agents` → list loads
- [ ] Click into your agent `/agents/14176` → detail loads
- [ ] Visit `/live` → events stream
- [ ] Mobile loads correctly (test on phone via 4G, NOT same WiFi)

---

## Step 6.6 — Log Rotation (YOU, 10 min)

Without rotation, log files will fill the disk in a few months.

```bash
sudo tee /etc/logrotate.d/arc-agents <<'EOF'
/var/log/arc-agents-web.log
/var/log/arc-agents-web-err.log
/var/log/arc-indexer.log
/var/log/arc-indexer-err.log
{
    daily
    rotate 14
    compress
    delaycompress
    missingok
    notifempty
    create 0644 huicom huicom
    sharedscripts
    postrotate
        systemctl reload arc-agents-web arc-agents-indexer > /dev/null 2>&1 || true
    endscript
}

/var/log/nginx/arcagents-access.log
/var/log/nginx/arcagents-error.log
{
    daily
    rotate 30
    compress
    delaycompress
    missingok
    notifempty
    create 0644 www-data adm
    sharedscripts
    postrotate
        nginx -s reopen > /dev/null 2>&1
    endscript
}
EOF

# Test config
sudo logrotate -d /etc/logrotate.d/arc-agents
```

---

## Step 6.7 — Monitoring with UptimeRobot (YOU, 10 min)

Free, no install needed.

1. Sign up at https://uptimerobot.com (free plan: 50 monitors, 5-min intervals)

2. Add monitor:
   - **Type:** HTTPS
   - **URL:** `https://arcagents.io/api/health`
   - **Monitoring interval:** 5 minutes
   - **Alert contacts:** Your email
   - **Friendly name:** ArcAgents Health

3. Add a second monitor:
   - **Type:** Keyword
   - **URL:** `https://arcagents.io/api/health`
   - **Keyword:** `"healthy":true`
   - **Alert when:** Keyword NOT exists
   - **Friendly name:** ArcAgents Indexer Freshness

This will email you if either:
- The site goes down (first monitor)
- The indexer stops processing blocks for > 60 seconds (second monitor)

---

## Step 6.8 — Cloudflare Hardening (Optional, 15 min)

Quick wins from Cloudflare's free tier:

### Speed → Optimization
- Auto Minify: HTML, CSS, JS — On
- Brotli: On
- Early Hints: On

### Caching → Configuration
- Browser Cache TTL: 4 hours
- Always Online: On

### Security → Settings
- Security Level: Medium
- Bot Fight Mode: On
- Challenge Passage: 30 minutes

### Page Rules (free plan: 3 rules)
1. `arcagents.io/_next/static/*` → Cache Level: Cache Everything, Edge Cache TTL: 1 month
2. `arcagents.io/api/*` → Cache Level: Bypass
3. `arcagents.io/api/live` → Cache Level: Bypass, Disable Performance (no Rocket Loader)

---

## Step 6.9 — Smoke Test (YOU, 10 min)

Final end-to-end test from a fresh browser/incognito:

- [ ] `https://arcagents.io` loads in < 3 seconds
- [ ] Homepage shows live stats with real numbers
- [ ] Live feed widget shows recent events
- [ ] `/agents` paginates correctly
- [ ] Search for "translation" or your agent name returns results
- [ ] Your agent #14176 detail page loads completely
- [ ] All 4 tabs (Overview, Reputation, Jobs, Validations) work
- [ ] `/jobs` filter by status works
- [ ] Job #20049 shows full timeline
- [ ] `/live` SSE stream stays connected for > 60 seconds
- [ ] `/stats` charts render
- [ ] Mobile site works (real phone, not browser devtools)
- [ ] Light/dark mode (if implemented) toggle works
- [ ] `https://arcagents.io/api/health` returns `"healthy": true`
- [ ] SSL Labs grade: visit https://www.ssllabs.com/ssltest/analyze.html?d=arcagents.io → at least **A**

### Stress test (optional)

```bash
# Install bombardier
go install github.com/codesenberg/bombardier@latest
# Or use docker: docker run --rm alpine/bombardier ...

# Hit the homepage for 30 seconds with 50 concurrent connections
bombardier -c 50 -d 30s https://arcagents.io/

# Hit the API
bombardier -c 50 -d 30s https://arcagents.io/api/stats
```

Should sustain 500+ req/s for `/api/stats` (cached) and 100+ req/s for uncached pages.

---

## ✅ Phase 6 Definition of Done

- [ ] `https://arcagents.io` resolves with valid SSL cert
- [ ] Cloudflare DNS active + proxied
- [ ] nginx config installed and reloaded
- [ ] `arc-agents-web.service` running as `huicom`
- [ ] `arc-agents-indexer.service` running as `huicom`
- [ ] Both services restart automatically after `sudo reboot`
- [ ] Log rotation configured
- [ ] UptimeRobot monitoring 2 endpoints
- [ ] Mobile + desktop both work
- [ ] SSL Labs grade ≥ A
- [ ] Committed to Git
- [ ] Deploy docs in `deploy/README.md`

### Git commit

```bash
cd ~/arc-agents-explorer
git add deploy/
git commit -m "feat: production deployment configs (Phase 6)

- nginx reverse proxy with SSL + WebSocket support
- Rate limiting (60 req/min for /api/*)
- systemd services for web + indexer
- Log rotation (logrotate)
- Cloudflare DNS + proxy ready
- UptimeRobot monitors configured
- HSTS + security headers"
git push
```

---

## 🔥 Common Issues & Fixes

### SSL cert fails to issue
- **Cause:** Cloudflare proxy intercepting ACME challenge
- **Fix:** Toggle Cloudflare proxy OFF, run certbot, toggle back ON

### "502 Bad Gateway" on arcagents.io
- **Cause:** Next.js not running on :3000
- **Fix:**
  ```bash
  sudo systemctl status arc-agents-web
  sudo journalctl -u arc-agents-web -n 50
  ```

### SSE drops after 60 seconds
- **Cause:** nginx default `proxy_read_timeout` is 60s
- **Fix:** Confirm the `/api/live` location has `proxy_read_timeout 24h;`

### Indexer can't connect to Postgres after reboot
- **Cause:** `arc-agents-indexer` starts before docker is ready
- **Fix:** Add `After=docker.service` and `Wants=docker.service` to the unit file

### "Permission denied" reading `.env`
```bash
chmod 644 /home/huicom/arc-agents-explorer/.env
chown huicom:huicom /home/huicom/arc-agents-explorer/.env
```

### Cloudflare shows "522 Connection timed out"
- Your VPS firewall is blocking Cloudflare IPs
- Check: `sudo ufw status`
- Allow HTTPS: `sudo ufw allow 443/tcp`

### High memory usage in Next.js (>2 GB)
Add to systemd unit:
```ini
Environment="NODE_OPTIONS=--max-old-space-size=1024"
```
Restart: `sudo systemctl restart arc-agents-web`

---

## 🎯 Bonus: Deploy Helper Script

Create `deploy/deploy.sh` for one-command updates:

```bash
#!/usr/bin/env bash
set -e

echo "🔄 Pulling latest..."
cd ~/arc-agents-explorer
git pull origin main

echo "📦 Installing deps..."
pnpm install --frozen-lockfile

echo "🗃 Running migrations..."
pnpm db:migrate

echo "🛠 Building..."
pnpm build

echo "♻️ Restarting services..."
sudo systemctl restart arc-agents-indexer arc-agents-web

echo "⏱ Waiting for services to come up..."
sleep 5

echo "🩺 Health check..."
curl -fsS https://arcagents.io/api/health | jq

echo "✅ Deploy complete"
```

Make it executable:
```bash
chmod +x deploy/deploy.sh
```

Now every update is just:
```bash
git push   # from laptop
ssh huicom@vps "cd ~/arc-agents-explorer && ./deploy/deploy.sh"
```

---

**Next →** Open `07_PHASE_7_LAUNCH.md` to plant the flag publicly.
