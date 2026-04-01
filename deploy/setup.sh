#!/usr/bin/env bash
# One-time setup for a fresh GCP e2-micro VM (Debian/Ubuntu).
#
# Run directly:  sudo bash setup.sh
# Or via curl:   curl -fsSL https://codeberg.org/khoan/rambo-bot/raw/branch/main/deploy/setup.sh | sudo bash

set -euo pipefail

REPO_URL="https://codeberg.org/khoan/rambo-bot.git"
APP_DIR="/opt/rambo-bot"
NODE_MAJOR=22

echo "==> Installing prerequisites"
apt-get update -y < /dev/null
apt-get install -y curl git < /dev/null

echo "==> Installing Node.js ${NODE_MAJOR}.x"
curl -fsSL https://deb.nodesource.com/setup_${NODE_MAJOR}.x | bash - < /dev/null
apt-get install -y nodejs < /dev/null

echo "==> Creating rambo user"
id -u rambo &>/dev/null || useradd -r -s /usr/sbin/nologin rambo

echo "==> Cloning repository"
if [ -d "$APP_DIR" ]; then
  echo "    $APP_DIR already exists, pulling latest"
  git -C "$APP_DIR" pull
else
  git clone "$REPO_URL" "$APP_DIR"
fi

echo "==> Installing dependencies"
cd "$APP_DIR"
npm ci --omit=dev

echo "==> Setting ownership"
chown -R rambo:rambo "$APP_DIR"

echo "==> Installing systemd service"
cp "$APP_DIR/deploy/rambo-bot.service" /etc/systemd/system/
systemctl daemon-reload
systemctl enable rambo-bot

echo "==> Done! Set your instance metadata, then start with:"
echo "    sudo systemctl start rambo-bot"
echo "    sudo journalctl -fu rambo-bot"
