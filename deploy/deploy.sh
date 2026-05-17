#!/usr/bin/env bash
set -euo pipefail

export PATH="$HOME/.npm-global/bin:$PATH"

echo "🏗️  Building..."
pnpm build:indexer
pnpm build:web

echo "📋 Installing service files..."
sudo cp deploy/arc-indexer-live.service /etc/systemd/system/
sudo cp deploy/arc-web.service /etc/systemd/system/

echo "📋 Installing nginx config..."
sudo cp deploy/nginx-arcagents.conf /etc/nginx/sites-available/arcagents
sudo ln -sf /etc/nginx/sites-available/arcagents /etc/nginx/sites-enabled/arcagents

echo "🔧 Creating log files..."
sudo touch /var/log/arc-indexer.log /var/log/arc-indexer-err.log
sudo touch /var/log/arc-web.log /var/log/arc-web-err.log
sudo chown huicom:huicom /var/log/arc-indexer*.log /var/log/arc-web*.log

echo "🔧 Reloading systemd..."
sudo systemctl daemon-reload

echo "🔧 Testing nginx config..."
sudo nginx -t

echo "🔧 Reloading nginx..."
sudo systemctl reload nginx

echo "▶️  Starting services..."
sudo systemctl enable arc-indexer-live arc-web
sudo systemctl restart arc-indexer-live arc-web

echo ""
echo "✅  Deploy complete. Check status:"
echo "   sudo systemctl status arc-indexer-live arc-web"
echo "   curl https://arcagents.io/api/health"
echo ""
echo "📋 Run certbot after nginx is live:"
echo "   sudo certbot --nginx -d arcagents.io"
