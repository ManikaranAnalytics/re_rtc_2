#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# deploy.sh — One-shot setup for RE-RTC Dispatch Optimizer on EC2 (Ubuntu 22.04+)
# Run once after cloning: bash deploy.sh
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")" && pwd)"
SERVICE_NAME="re-rtc"

echo ""
echo "════════════════════════════════════════════════════"
echo "  RE-RTC Dispatch Optimizer — EC2 Deployment Setup"
echo "════════════════════════════════════════════════════"
echo ""

# ── 1. System packages ────────────────────────────────────────────────────────
echo "▸ [1/6] Installing system packages..."
sudo apt-get update -qq
sudo apt-get install -y -qq python3-pip python3-venv curl

# ── 2. Node.js 20 LTS ────────────────────────────────────────────────────────
echo "▸ [2/6] Installing Node.js 20 LTS..."
if ! command -v node &>/dev/null || [[ "$(node -v)" != v20* ]]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - -qq
  sudo apt-get install -y -qq nodejs
fi
echo "    node $(node -v) | npm $(npm -v)"

# ── 3. Python virtual environment + dependencies ──────────────────────────────
echo "▸ [3/6] Setting up Python virtual environment..."
python3 -m venv "$APP_DIR/.venv"
source "$APP_DIR/.venv/bin/activate"
pip install --quiet --upgrade pip
pip install --quiet -r "$APP_DIR/requirements.txt"
echo "    Python deps installed."

# ── 4. Build the React frontend ───────────────────────────────────────────────
echo "▸ [4/6] Building React frontend..."
cd "$APP_DIR/frontend"
npm install --silent
npm run build --silent
cd "$APP_DIR"
echo "    Frontend built → frontend/dist/"

# ── 5. Install as a systemd service ──────────────────────────────────────────
echo "▸ [5/6] Installing systemd service '$SERVICE_NAME'..."
VENV_PYTHON="$APP_DIR/.venv/bin/python"

sudo tee /etc/systemd/system/${SERVICE_NAME}.service > /dev/null <<EOF
[Unit]
Description=RE-RTC Dispatch Optimizer (FastAPI)
After=network.target

[Service]
User=$USER
WorkingDirectory=$APP_DIR
ExecStart=$VENV_PYTHON -m uvicorn main:app --host 0.0.0.0 --port 8000 --workers 2
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable  "$SERVICE_NAME"
sudo systemctl restart "$SERVICE_NAME"

# ── 6. Open firewall port 8000 ────────────────────────────────────────────────
echo "▸ [6/6] Configuring firewall..."
if command -v ufw &>/dev/null; then
  sudo ufw allow 8000/tcp || true
fi

echo ""
echo "════════════════════════════════════════════════════"
echo "  ✓ Deployment complete!"
echo ""
echo "  App URL : http://$(curl -s --max-time 3 http://169.254.169.254/latest/meta-data/public-ipv4 2>/dev/null || hostname -I | awk '{print $1}'):8000"
echo "  API Docs: http://$(curl -s --max-time 3 http://169.254.169.254/latest/meta-data/public-ipv4 2>/dev/null || hostname -I | awk '{print $1}'):8000/docs"
echo ""
echo "  Service status : sudo systemctl status $SERVICE_NAME"
echo "  View logs      : sudo journalctl -u $SERVICE_NAME -f"
echo "  Restart        : sudo systemctl restart $SERVICE_NAME"
echo "════════════════════════════════════════════════════"
