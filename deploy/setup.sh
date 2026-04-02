#!/usr/bin/env bash
# One-time setup for a fresh GCP e2-micro VM (Debian/Ubuntu).
#
# Run directly:  sudo bash setup.sh
# Or via curl:   curl -fsSL https://raw.githubusercontent.com/kdnvi/rambo-bot/main/deploy/setup.sh | sudo bash

set -euo pipefail

REPO_URL="https://github.com/kdnvi/rambo-bot.git"
APP_DIR="/opt/rambo-bot"
NODE_MAJOR=22

BOLD='\033[1m' RESET='\033[0m'
step() { echo -e "\n${BOLD}[$1/$TOTAL] $2${RESET}"; }
TOTAL=6

step 1 "Installing prerequisites"
apt-get update -y < /dev/null
apt-get install -y curl git < /dev/null

step 2 "Installing Node.js ${NODE_MAJOR}.x"
curl -fsSL -o /tmp/nodesource_setup.sh https://deb.nodesource.com/setup_${NODE_MAJOR}.x
bash /tmp/nodesource_setup.sh < /dev/null
rm -f /tmp/nodesource_setup.sh
apt-get install -y nodejs < /dev/null

step 3 "Creating rambo user"
id -u rambo &>/dev/null || useradd -r -s /usr/sbin/nologin rambo

step 4 "Cloning repository"
if [ -d "$APP_DIR" ]; then
  echo "    $APP_DIR already exists, pulling latest"
  git -C "$APP_DIR" pull
else
  git clone "$REPO_URL" "$APP_DIR"
fi

step 5 "Installing dependencies"
cd "$APP_DIR"
npm ci --omit=dev

step 6 "Setting up systemd service"
chown -R rambo:rambo "$APP_DIR"
ln -sf "$APP_DIR/deploy/rambo-bot.service" /etc/systemd/system/rambo-bot.service
systemctl daemon-reload
systemctl enable rambo-bot

echo -e "\n${BOLD}Done!${RESET} Set your instance metadata, then start with:"
echo "    sudo systemctl start rambo-bot"
echo "    sudo journalctl -fu rambo-bot"
