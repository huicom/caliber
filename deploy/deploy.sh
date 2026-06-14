#!/usr/bin/env bash
set -euo pipefail

# Always run from the repo root, no matter where the user invoked us from.
# Without this, `cd deploy && ./deploy.sh` resolves `deploy/*.service`
# paths against `deploy/deploy/*` and bails with "no such file".
cd "$(dirname "$0")/.."

export PATH="$HOME/.npm-global/bin:$PATH"

echo "🏗️  Building..."
pnpm --filter @arc-agents/indexer build
pnpm --filter web build

echo "📋 Installing service files..."
sudo cp deploy/arc-indexer-live.service /etc/systemd/system/
sudo cp deploy/arc-web.service /etc/systemd/system/
sudo cp deploy/arc-rating.service /etc/systemd/system/
sudo cp deploy/caliber-snapshot.service /etc/systemd/system/
sudo cp deploy/caliber-snapshot.timer /etc/systemd/system/
sudo cp deploy/caliber-embed-pending.service /etc/systemd/system/
sudo cp deploy/caliber-embed-pending.timer /etc/systemd/system/
sudo cp deploy/caliber-hirebot.service /etc/systemd/system/
sudo cp deploy/caliber-hirebot.timer /etc/systemd/system/
sudo cp deploy/caliber-broker.service /etc/systemd/system/
sudo cp deploy/caliber-steward.service /etc/systemd/system/
sudo cp deploy/caliber-redteam.service /etc/systemd/system/

echo "📋 Installing nginx config (for arcagents.poko.blue only — rating uses Cloudflare Tunnel)..."
sudo cp deploy/nginx-arcagents.conf /etc/nginx/sites-available/arcagents
sudo ln -sf /etc/nginx/sites-available/arcagents /etc/nginx/sites-enabled/arcagents
# deploy/nginx-rating.conf is kept as an alternative if you ever stop using Cloudflare Tunnel.

echo "🔧 Creating log files..."
sudo touch /var/log/arc-indexer.log /var/log/arc-indexer-err.log
sudo touch /var/log/arc-web.log     /var/log/arc-web-err.log
sudo touch /var/log/arc-rating.log  /var/log/arc-rating-err.log
sudo touch /var/log/caliber-snapshot.log /var/log/caliber-snapshot-err.log
sudo touch /var/log/caliber-embed-pending.log /var/log/caliber-embed-pending-err.log
sudo touch /var/log/caliber-hirebot.log /var/log/caliber-hirebot-err.log
sudo touch /var/log/caliber-broker.log /var/log/caliber-broker-err.log
sudo touch /var/log/caliber-steward.log /var/log/caliber-steward-err.log
sudo touch /var/log/caliber-redteam.log /var/log/caliber-redteam-err.log
sudo chown huicom:huicom /var/log/arc-indexer*.log /var/log/arc-web*.log /var/log/arc-rating*.log /var/log/caliber-snapshot*.log /var/log/caliber-embed-pending*.log /var/log/caliber-hirebot*.log /var/log/caliber-broker*.log /var/log/caliber-steward*.log /var/log/caliber-redteam*.log

echo "🔧 Reloading systemd..."
sudo systemctl daemon-reload

echo "🔧 Testing nginx config..."
sudo nginx -t

echo "🔧 Reloading nginx..."
sudo systemctl reload nginx

echo "▶️  Starting services..."
sudo systemctl enable arc-indexer-live arc-web arc-rating
sudo systemctl restart arc-indexer-live arc-web arc-rating

echo "▶️  Enabling Caliber daily snapshot timer (Wave 3)..."
sudo systemctl enable --now caliber-snapshot.timer

echo "▶️  Enabling Caliber embed-pending timer (Phase 2 / Track 4) — fires every 15 min..."
sudo systemctl enable --now caliber-embed-pending.timer

echo "▶️  Enabling HireBot timer (Lepton Phase 1 / A4) — fires every 10 min..."
sudo systemctl enable --now caliber-hirebot.timer

echo "▶️  Starting Bonded Broker service (Lepton Phase 2 / B2-B3) on :3200..."
sudo systemctl enable caliber-broker
sudo systemctl restart caliber-broker

echo "▶️  Starting Steward service (CFO layer) on :3300..."
sudo systemctl enable caliber-steward
sudo systemctl restart caliber-steward

echo "▶️  Starting Steward red-team fixture (detector demos) on :3400..."
sudo systemctl enable caliber-redteam
sudo systemctl restart caliber-redteam

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
