# Steward — Go-Live Runbook (privileged steps)

All artifacts are prepared and the production web build passes. These steps need sudo
(passwordless sudo is not configured — run them yourself). Tunnel id:
`980afb78-474d-476b-a506-6a95cd8ded2a` (from `deploy/cloudflared-config.yml`).

```bash
cd /home/huicom/arc-agents-explorer

# 1. Install the two new unit files
sudo cp deploy/caliber-steward.service /etc/systemd/system/
sudo cp deploy/caliber-redteam.service /etc/systemd/system/

# 2. Create + own the log files
sudo touch /var/log/caliber-steward.log /var/log/caliber-steward-err.log \
           /var/log/caliber-redteam.log /var/log/caliber-redteam-err.log
sudo chown huicom:huicom /var/log/caliber-steward*.log /var/log/caliber-redteam*.log

# 3. Reload systemd, enable + start both services
sudo systemctl daemon-reload
sudo systemctl enable --now caliber-steward
sudo systemctl enable --now caliber-redteam

# 4. Restart the web app to pick up the new build (steward pages + middleware)
sudo systemctl restart arc-web

# 5. Route the new tunnel hostnames
cloudflared tunnel route dns 980afb78-474d-476b-a506-6a95cd8ded2a steward.poko.blue
cloudflared tunnel route dns 980afb78-474d-476b-a506-6a95cd8ded2a steward-api.poko.blue

# 6. Reload cloudflared to serve the new ingress rules
sudo systemctl restart cloudflared
```

## Verify

```bash
curl -s http://localhost:3300/health          # {"ok":true,"frozen":false}
curl -s http://localhost:3400/health          # redteam ok
curl -sI https://steward.poko.blue/ | head -n1     # 200, console
curl -s https://steward-api.poko.blue/health       # steward API via tunnel

# Full attack-demo rehearsal against the live services (same script as local):
pnpm demo:redteam
```

## Notes
- **Restart `caliber-steward` after any `services/steward` source change** — tsx loads
  source at boot; a stale process serves old pipeline code (observed during build).
- The steward treasury key (`STEWARD_PRIVATE_KEY`) currently reuses the TEST_FUNDER
  wallet (funded Gateway balance). Create a dedicated wallet before heavy dogfood use.
- If cloudflared is dashboard-managed, also add both public hostnames in
  Zero Trust → Networks → Tunnels (steward → :3000, steward-api → :3300).
