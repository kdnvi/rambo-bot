#!/bin/sh
# Fetches bot configuration from GCP instance metadata and exports as env vars.
# Falls back to existing env vars if metadata service is unreachable (local dev).

METADATA_URL="http://metadata.google.internal/computeMetadata/v1/instance/attributes"
HEADER="Metadata-Flavor: Google"

fetch_meta() {
  curl -sf -H "$HEADER" "$METADATA_URL/$1" 2>/dev/null
}

if curl -sf -H "$HEADER" "$METADATA_URL/" >/dev/null 2>&1; then
  export TOKEN=$(fetch_meta token)
  export APP_ID=$(fetch_meta app-id)
  export GUILD_ID=$(fetch_meta guild-id)
  export CHANNEL_ID=$(fetch_meta channel-id)
  export DEV_CHANNEL_ID=$(fetch_meta dev-channel-id)
  export FOOTBALL_CHANNEL_ID=$(fetch_meta football-channel-id)
  export VOICE_CHANNEL_ID=$(fetch_meta voice-channel-id)
  export AUDITED_USERS=$(fetch_meta audited-users)
  export FIREBASE_DB_URL=$(fetch_meta firebase-db-url)
  export MATCH_POST_BEFORE_MINS=$(fetch_meta match-post-before-mins || echo 720)
  export VOTE_REMINDER_BEFORE_MINS=$(fetch_meta vote-reminder-before-mins || echo 30)
fi

exec "$@"
