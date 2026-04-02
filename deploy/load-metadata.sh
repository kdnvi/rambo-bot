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

fetch_meta_or() {
  curl -sf -H "$HEADER" "$METADATA_URL/$1" 2>/dev/null || echo "$2"
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
MATCH_POST_BEFORE_MINS=$(fetch_meta_or match-post-before-mins 720)
VOTE_REMINDER_BEFORE_MINS=$(fetch_meta_or vote-reminder-before-mins 30)
RESULT_REMINDER_AFTER_MINS=$(fetch_meta_or result-reminder-after-mins 180)
RESULT_REMINDER_INTERVAL_MINS=$(fetch_meta_or result-reminder-interval-mins 30)
EOF

chown rambo:rambo "$ENV_FILE"
chmod 600 "$ENV_FILE"
