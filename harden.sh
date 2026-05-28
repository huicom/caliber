#!/usr/bin/env bash
#
# Server-hardening script for the Caliber stack (caliber.poko.blue +
# caliber-api.poko.blue + Arc node + Postgres + indexer + rating + web).
#
# Usage:
#   bash harden.sh '<ssh-public-key>' <new-ssh-port> [<tunnel-host-lan-ip>]
#
# Example (no tunnel host):
#   bash harden.sh 'ssh-ed25519 AAAA…' 22022
#
# Example (with Cloudflare Tunnel on another LAN host at 192.168.1.42):
#   bash harden.sh 'ssh-ed25519 AAAA…' 22022 192.168.1.42
#
# When the third arg is set, UFW allows inbound to :3000 (web) and :3100
# (rating) FROM that LAN IP only. Everything else still blocked.
#
# What this does:
#   1. Adds the provided pubkey to ~/.ssh/authorized_keys (idempotent).
#   2. Disables password auth + root login + removes cloud-init override.
#   3. Moves SSH off port 22 to the requested port.
#   4. Enables UFW with the MINIMUM ports the Caliber stack needs:
#        - 80/tcp   (nginx HTTP → 301 redirect + certbot HTTP-01 renewals)
#        - 443/tcp  (nginx HTTPS → caliber.poko.blue, caliber-api.poko.blue)
#        - $SSH_PORT/tcp with rate-limit
#      Everything else (3000, 3100, 5432, 8546, 30303 …) is implicitly
#      blocked at the firewall — internal services stay reachable on
#      localhost so nginx, web→rating, and Postgres-via-Docker keep working.
#   5. Enables fail2ban on the new SSH port.
#   6. Enables unattended security updates (no auto-reboot).
#   7. Audits services that bind 0.0.0.0 and SHOULD have been on 127.0.0.1
#      (Postgres in Docker is the big one — Docker's iptables rules can
#      bypass UFW so we warn but do not auto-rebind, since that requires
#      a docker-compose edit and container restart that breaks the
#      indexer.)

set -e

PUBKEY="$1"
SSH_PORT="$2"
TUNNEL_HOST_IP="${3:-}"   # optional — LAN IP of the Cloudflare Tunnel host
CURRENT_USER=$(whoami)

# Validate the tunnel host IP if provided. Must be a private LAN range.
if [ -n "$TUNNEL_HOST_IP" ]; then
    if ! echo "$TUNNEL_HOST_IP" | grep -qE '^(10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[0-1])\.)[0-9.]+$'; then
        echo "ERROR: Tunnel host IP '$TUNNEL_HOST_IP' is not a private LAN address."
        echo "Expected 10.x.x.x, 192.168.x.x, or 172.16-31.x.x"
        exit 1
    fi
fi

# --- Detect SSH service name ---
if systemctl list-units --type=service --all | grep -q "sshd.service"; then
    SSH_SERVICE="sshd"
elif systemctl list-units --type=service --all | grep -q "ssh.service"; then
    SSH_SERVICE="ssh"
else
    echo "ERROR: Cannot find SSH service"
    exit 1
fi

# --- Safety checks ---
if [ -z "$PUBKEY" ] || [ -z "$SSH_PORT" ]; then
    echo "ERROR: Usage: bash $0 'ssh-key-string' port_number"
    echo "Example: bash $0 'sk-ssh-ed25519@openssh.com AAAA...' 2222"
    exit 1
fi

if [ "$CURRENT_USER" = "root" ]; then
    echo "ERROR: Don't run as root. Run as your normal user (e.g., huicom)"
    exit 1
fi

# Refuse common ports that conflict with the Caliber stack.
case "$SSH_PORT" in
    22|80|443|3000|3100|5432|8545|8546|8551|9001|29000|30303|31000)
        echo "ERROR: SSH_PORT=$SSH_PORT conflicts with a Caliber service port."
        echo "Pick something else (recommended: 2222, 2200, 22022, or a random 49152-65535)."
        exit 1
        ;;
esac

echo "=== Hardening $(hostname) ==="
echo "User:         $CURRENT_USER"
echo "Hostname:     $(hostname)"
echo "Current IP:   $(hostname -I | awk '{print $1}')"
echo "SSH port:     22 → $SSH_PORT"
echo "SSH service:  $SSH_SERVICE"
if [ -n "$TUNNEL_HOST_IP" ]; then
    echo "Tunnel host:  $TUNNEL_HOST_IP (LAN — will be allowed inbound to :3000, :3100)"
else
    echo "Tunnel host:  none (UFW will block all access to :3000, :3100 — nginx-via-localhost only)"
fi
echo ""
echo "Caliber services that must stay reachable after this runs:"
echo "  - caliber.poko.blue       (nginx :443 → next-server :3000)"
if [ -n "$TUNNEL_HOST_IP" ]; then
    echo "  - caliber-api.poko.blue   (Cloudflare Tunnel @ $TUNNEL_HOST_IP → this server :3100)"
fi
echo "  - SSH on port $SSH_PORT"
echo ""

# --- SSH Key (add BEFORE touching sshd config so we have a working key path) ---
mkdir -p ~/.ssh && chmod 700 ~/.ssh

if grep -qF "$PUBKEY" ~/.ssh/authorized_keys 2>/dev/null; then
    echo "[SSH] Provided pubkey already present in authorized_keys, skipping"
else
    echo "$PUBKEY" >> ~/.ssh/authorized_keys
    echo "[SSH] Pubkey added to authorized_keys"
fi
chmod 600 ~/.ssh/authorized_keys

# --- Remove cloud-init SSH override (re-enables password auth on most cloud VMs) ---
if [ -f /etc/ssh/sshd_config.d/50-cloud-init.conf ]; then
    sudo rm /etc/ssh/sshd_config.d/50-cloud-init.conf
    echo "[SSH] Removed 50-cloud-init.conf (was overriding password disable)"
fi

# --- SSH hardening config ---
sudo tee /etc/ssh/sshd_config.d/hardening.conf > /dev/null <<EOF
Port $SSH_PORT
PasswordAuthentication no
ChallengeResponseAuthentication no
KbdInteractiveAuthentication no
UsePAM no
PermitRootLogin no
MaxAuthTries 3
AllowUsers $CURRENT_USER
ClientAliveInterval 300
ClientAliveCountMax 2
X11Forwarding no
EOF

# Belt-and-suspenders: also force in main config so future upgrades don't reset.
sudo sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
sudo sed -i 's/^#\?UsePAM.*/UsePAM no/' /etc/ssh/sshd_config

echo "[SSH] Config written: port $SSH_PORT, key-only, allow $CURRENT_USER"

# --- Validate sshd config BEFORE restart (catches typos that lock us out) ---
if ! sudo sshd -t; then
    echo "ERROR: sshd config validation failed. Rolling back hardening.conf."
    sudo rm /etc/ssh/sshd_config.d/hardening.conf
    exit 1
fi
echo "[SSH] sshd -t passed (no config errors)"

# --- Test before restart ---
echo ""
echo "!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!"
echo "!!  SSH NOT RESTARTED YET — TEST KEY-BASED LOGIN FIRST          !!"
echo "!!                                                              !!"
echo "!!  In a NEW terminal on your client machine:                   !!"
echo "!!    ssh -p 22 $CURRENT_USER@$(hostname -I | awk '{print $1}')"
echo "!!  (test on port 22 — the new port becomes active AFTER restart) !!"
echo "!!                                                              !!"
echo "!!  Verify:                                                     !!"
echo "!!    1. Key auth works (no password prompt)                    !!"
echo "!!    2. You can read files: \`whoami && hostname\`               !!"
echo "!!                                                              !!"
echo "!!  If the test FAILS:                                          !!"
echo "!!    Ctrl+C here and run:                                      !!"
echo "!!    sudo rm /etc/ssh/sshd_config.d/hardening.conf             !!"
echo "!!                                                              !!"
echo "!!  If the test SUCCEEDS:                                       !!"
echo "!!    Press ENTER to restart sshd on port $SSH_PORT             !!"
echo "!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!"
echo ""
read -p "Press ENTER after confirmed, or Ctrl+C to abort..."

sudo systemctl restart $SSH_SERVICE
echo "[SSH] $SSH_SERVICE restarted on port $SSH_PORT"

# --- Verify new port is listening ---
sleep 2
if ss -tlnp | grep -q ":$SSH_PORT"; then
    echo "[SSH] Confirmed: port $SSH_PORT is listening"
else
    echo "[WARNING] Port $SSH_PORT not detected — check manually:"
    echo "          ss -tlnp | grep $SSH_PORT"
fi

# --- Firewall (UFW) ---
# Allow ONLY the ports the Caliber stack legitimately needs from outside.
# Everything else (3000, 3100, 5432, 8546, 30303) is implicitly blocked.
sudo apt install -y ufw

sudo ufw default deny incoming
sudo ufw default allow outgoing

# SSH with rate-limit (UFW blocks an IP that tries to connect >6 times / 30s).
sudo ufw limit $SSH_PORT/tcp comment "SSH (rate-limited)"

# nginx public web — caliber.poko.blue served on 443.
sudo ufw allow 80/tcp  comment "HTTP — nginx redirect + certbot HTTP-01"
sudo ufw allow 443/tcp comment "HTTPS — nginx → next-server :3000"

# Cloudflare Tunnel host on LAN — needs to reach rating :3100 (and optionally
# web :3000 if you ever tunnel caliber.poko.blue from the same host).
# Restricted to a single source IP, NOT the whole LAN, so a compromised LAN
# device can't reach internal services.
if [ -n "$TUNNEL_HOST_IP" ]; then
    sudo ufw allow from "$TUNNEL_HOST_IP" to any port 3100 proto tcp \
        comment "Cloudflare Tunnel @ $TUNNEL_HOST_IP → rating :3100"
    sudo ufw allow from "$TUNNEL_HOST_IP" to any port 3000 proto tcp \
        comment "Cloudflare Tunnel @ $TUNNEL_HOST_IP → web :3000 (optional)"
    echo "[UFW] Tunnel host $TUNNEL_HOST_IP allowed inbound to :3000, :3100"
fi

sudo ufw --force enable
echo "[UFW] Firewall enabled."
sudo ufw status numbered

# --- Fail2ban ---
sudo apt install -y fail2ban
sudo tee /etc/fail2ban/jail.local > /dev/null <<EOF
[sshd]
enabled = true
port = $SSH_PORT
maxretry = 3
bantime = 3600
findtime = 600
EOF
sudo systemctl enable fail2ban
sudo systemctl restart fail2ban
echo "[Fail2ban] Enabled on port $SSH_PORT (3 fails / 10 min → 1h ban)"

# --- Auto-updates ---
sudo apt install -y unattended-upgrades
sudo tee /etc/apt/apt.conf.d/50unattended-upgrades > /dev/null <<'UPGEOF'
Unattended-Upgrade::Allowed-Origins {
    "${distro_id}:${distro_codename}-security";
    "${distro_id}ESMApps:${distro_codename}-apps-security";
};
Unattended-Upgrade::AutoFixInterruptedDpkg "true";
// IMPORTANT: keep this "false". With "true", apt has been observed
// auto-removing nodejs (and ~300 node-* packages) during security upgrades,
// which kills the Caliber stack until nodejs is reinstalled. Verified
// 2026-05-27 on production. Leave services intact, accept some apt cruft.
Unattended-Upgrade::Remove-Unused-Dependencies "false";
Unattended-Upgrade::Automatic-Reboot "false";
UPGEOF

sudo tee /etc/apt/apt.conf.d/20auto-upgrades > /dev/null <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT::Periodic::Download-Upgradeable-Packages "1";
APT::Periodic::AutocleanInterval "7";
EOF

sudo systemctl enable unattended-upgrades
echo "[Auto-updates] Security updates enabled (no auto-reboot)"

# --- Post-flight audit: warn about services still on 0.0.0.0 that UFW will block ---
echo ""
echo "============================================"
echo "  HARDENING COMPLETE: $(hostname)"
echo "============================================"
echo "  SSH port:       $SSH_PORT  (service: $SSH_SERVICE)"
echo "  Allowed user:   $CURRENT_USER"
echo "  Password auth:  DISABLED"
echo "  Cloud-init:     REMOVED"
if [ -n "$TUNNEL_HOST_IP" ]; then
    echo "  UFW:            ENABLED (80, 443, $SSH_PORT, plus $TUNNEL_HOST_IP→3000/3100)"
else
    echo "  UFW:            ENABLED (80, 443, $SSH_PORT only)"
fi
echo "  Fail2ban:       ENABLED"
echo "  Auto-updates:   ENABLED"
echo ""
echo "Services still bound 0.0.0.0 — firewall blocks external access but"
echo "you should consider rebinding them to 127.0.0.1 long-term:"
ss -tlnp 2>/dev/null | awk '/LISTEN/ && /^[^:]*0\.0\.0\.0/ {print "  " $4}' | sort -u
echo ""
echo "Caliber-specific notes:"
echo "  - Postgres (Docker arc-pg): UFW blocks :5432 externally, but Docker's"
echo "    iptables rules can bypass UFW. To be safe, rebind to 127.0.0.1:5432"
echo "    in your docker-compose / docker run — and verify with:"
echo "      docker ps --format '{{.Names}}: {{.Ports}}'"
echo "  - Arc node :8546 (WS) and :30303 (devp2p): UFW blocks both. Arc node"
echo "    runs with --disable-discovery + --follow.endpoint so this is fine."
echo "  - Next.js :3000 + rating :3100: only reachable via nginx (443). Safe."
echo ""
echo "Add this to your client ~/.ssh/config:"
echo ""
echo "Host $(hostname)"
echo "    HostName $(hostname -I | awk '{print $1}')"
echo "    Port $SSH_PORT"
echo "    User $CURRENT_USER"
echo "    IdentityFile ~/.ssh/<YOUR-KEY-FILE>    # e.g. id_ledger_flex, id_ed25519, etc."
echo "    IdentitiesOnly yes"
echo ""
echo "Verify Caliber stack still works:"
echo "  curl -s https://caliber.poko.blue/api/health"
echo "  curl -s https://caliber-api.poko.blue/health"
if [ -n "$TUNNEL_HOST_IP" ]; then
    echo ""
    echo "From the tunnel host ($TUNNEL_HOST_IP), verify it can still reach this server:"
    echo "  curl -s http://$(hostname -I | awk '{print $1}'):3100/health"
fi
echo ""
