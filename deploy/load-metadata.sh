#!/usr/bin/env bash
# Fetches bot configuration from GCP instance metadata and writes an env file.
# Called by the systemd service before the bot starts.

set -euo pipefail

METADATA_URL="http://metadata.google.internal/computeMetadata/v1/instance/attributes"
HEADER="Metadata-Flavor: Google"
ENV_FILE="/opt/rambo-bot/.env.runtime"

fetch_meta() {
  curl -sf -H "$HEADER" "$METADATA_URL/$1"
}

cat > "$ENV_FILE" <<EOF
TOKEN=$(fetch_meta token)
APP_ID=$(fetch_meta app-id)
GUILD_ID=$(fetch_meta guild-id)
CHANNEL_ID=$(fetch_meta channel-id)
DEV_CHANNEL_ID=$(fetch_meta dev-channel-id)
FOOTBALL_CHANNEL_ID=$(fetch_meta football-channel-id)
VOICE_CHANNEL_ID=$(fetch_meta voice-channel-id)
AUDITED_USERS=$(fetch_meta audited-users)
FIREBASE_DB_URL=$(fetch_meta firebase-db-url)
EOF

chmod 600 "$ENV_FILE"
