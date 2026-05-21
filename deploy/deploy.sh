#!/usr/bin/env bash
set -euo pipefail

export PATH="$HOME/.npm-global/bin:$PATH"

echo "🏗️  Building..."
pnpm --filter @arc-agents/indexer build
pnpm --filter web build

echo "📋 Installing service files..."
sudo cp deploy/arc-indexer-live.service /etc/systemd/system/
sudo cp deploy/arc-web.service /etc/systemd/system/
sudo cp deploy/arc-rating.service /etc/systemd/system/

echo "📋 Installing nginx config (for arcagents.poko.blue only — rating uses Cloudflare Tunnel)..."
sudo cp deploy/nginx-arcagents.conf /etc/nginx/sites-available/arcagents
sudo ln -sf /etc/nginx/sites-available/arcagents /etc/nginx/sites-enabled/arcagents
# deploy/nginx-rating.conf is kept as an alternative if you ever stop using Cloudflare Tunnel.

echo "🔧 Creating log files..."
sudo touch /var/log/arc-indexer.log /var/log/arc-indexer-err.log
sudo touch /var/log/arc-web.log     /var/log/arc-web-err.log
sudo touch /var/log/arc-rating.log  /var/log/arc-rating-err.log
sudo chown huicom:huicom /var/log/arc-indexer*.log /var/log/arc-web*.log /var/log/arc-rating*.log

echo "🔧 Reloading systemd..."
sudo systemctl daemon-reload

echo "🔧 Testing nginx config..."
sudo nginx -t

echo "🔧 Reloading nginx..."
sudo systemctl reload nginx

echo "▶️  Starting services..."
sudo systemctl enable arc-indexer-live arc-web arc-rating
sudo systemctl restart arc-indexer-live arc-web arc-rating

echo ""
echo "✅  Deploy complete. Check status:"
echo "   sudo systemctl status arc-indexer-live arc-web arc-rating"
echo "   curl https://arcagents.poko.blue/api/health"
echo "   curl http://192.168.1.41:3100/health   # LAN-direct test of rating service"
echo ""
echo "📋 Cloudflare Tunnel reminder — for rating-arcagents.poko.blue to work, add a"
echo "   public hostname on tunnel 980afb78-474d-476b-a506-6a95cd8ded2a:"
echo "     Zero Trust → Networks → Tunnels → [tunnel] → Public Hostname → Add"
echo "       Subdomain: rating-arcagents"
echo "       Domain:    poko.blue"
echo "       Service:   HTTP  →  http://192.168.1.41:3100"
echo "   (Flat-domain layout so Cloudflare Universal SSL covers it via *.poko.blue)"
echo "   Once added, test with: curl https://rating-arcagents.poko.blue/health"
