rambo-bot
=========

Discord bot for World Cup 2026 prediction game. Built in Go, uses Discord Gateway API
directly (no discordgo), Firebase Realtime Database, and deploys as a Docker container.


PREREQUISITES
-------------

  - Go 1.23+
  - Docker
  - A Discord application with a bot token (https://discord.com/developers/applications)
  - A Firebase project with Realtime Database enabled
  - Google Cloud credentials (for Firebase access)


ENVIRONMENT VARIABLES
---------------------

Create a .env file (never commit it) or export these before running:

  TOKEN                   Discord bot token
  APP_ID                  Discord application ID
  GUILD_ID                Discord server (guild) ID
  FIREBASE_DB_URL         Firebase Realtime Database URL
                          e.g. https://my-project-default-rtdb.firebaseio.com
  DEV_CHANNEL_ID          Discord channel ID for bot start/stop notifications
  FOOTBALL_CHANNEL_ID     Discord channel ID where match votes are posted
                          (fallback if not stored in Firebase config)
  AUDITED_USERS           Comma-separated Discord user IDs of registered players
                          e.g. 123456789,987654321
  DOCKER_HUB_USER         Your Docker Hub username (used by Makefile)

  Optional tuning:
  MATCH_POST_BEFORE_MINS  Minutes before kickoff to post vote embed (default: 720 = 12h)
  VOTE_REMINDER_BEFORE_MINS  Minutes before kickoff to send vote reminder (default: 30)

Firebase authentication uses Application Default Credentials (ADC). Locally this means
either GOOGLE_APPLICATION_CREDENTIALS pointing to a service account JSON key, or running
`gcloud auth application-default login`.


LOCAL DEVELOPMENT
-----------------

1. Clone the repo and install Go dependencies:

     git clone https://github.com/kdnvi/rambo-bot
     cd rambo-bot
     go mod download

2. Set up credentials:

     export GOOGLE_APPLICATION_CREDENTIALS=/path/to/firebase-service-account.json

   Or use gcloud ADC:

     gcloud auth application-default login

3. Create a .env file at the repo root (already in .gitignore):

     cp .env.example .env

   Minimal .env contents:

     TOKEN=your-discord-bot-token
     APP_ID=your-app-id
     GUILD_ID=your-guild-id
     FIREBASE_DB_URL=https://your-project-default-rtdb.firebaseio.com
     DEV_CHANNEL_ID=your-dev-channel-id
     FOOTBALL_CHANNEL_ID=your-football-channel-id
     AUDITED_USERS=user-id-1,user-id-2
     GOOGLE_APPLICATION_CREDENTIALS=/path/to/firebase-service-account.json

   For fish, create a .env.fish file instead (also covered by .gitignore via .env.*):

     set -x TOKEN "your-discord-bot-token"
     set -x APP_ID "your-app-id"
     set -x GUILD_ID "your-guild-id"
     set -x FIREBASE_DB_URL "https://your-project-default-rtdb.firebaseio.com"
     set -x DEV_CHANNEL_ID "your-dev-channel-id"
     set -x FOOTBALL_CHANNEL_ID "your-football-channel-id"
     set -x AUDITED_USERS "user-id-1,user-id-2"
     set -x GOOGLE_APPLICATION_CREDENTIALS "/path/to/firebase-service-account.json"

   Load it into your shell before running any make target.

   bash/zsh:
     set -a && source .env && set +a

   fish:
     source .env.fish

4. Register slash commands with Discord (only needed once, or when commands change):

   bash/zsh:
     set -a && source .env && set +a && make deploy-commands

   fish:
     source .env.fish && make deploy-commands

5. Run the bot:

   bash/zsh:
     set -a && source .env && set +a && make run

   fish:
     source .env.fish && make run

6. Other useful make targets:

     make build       # compile binary to ./rambo-bot
     make fmt         # gofmt all Go files
     make vet         # run go vet


SEEDING FIREBASE DATA
---------------------

The templates/ directory contains the tournament data to seed into Firebase:

  templates/worldcup2026.json       Full World Cup 2026 schedule + groups
  templates/worldcup2026-test.json  Same structure with near-term test dates
  templates/flavor.json             Bot flavor text lines (loaded at runtime)

You need to import these into your Firebase Realtime Database before the bot will work.

Using the Firebase console (https://console.firebase.google.com):
  1. Navigate to your Realtime Database
  2. Click the three-dot menu → Import JSON
  3. Import worldcup2026.json (or worldcup2026-test.json for local testing) at path:
       tournament/
  4. Import flavor.json at path:
       tournament/flavor/

Using the Firebase CLI:
  firebase database:set /tournament templates/worldcup2026.json
  firebase database:set /tournament/flavor templates/flavor.json


DOCKER
------

Build the image locally:

  make docker-build
  # expands to: docker build -t $DOCKER_HUB_USER/rambo-bot:latest .

Build with a specific tag:

  make docker-build TAG=v1.2.3

Run the container locally (pass env vars via --env-file or -e flags):

  docker run --rm \
    -e TOKEN=... \
    -e APP_ID=... \
    -e GUILD_ID=... \
    -e FIREBASE_DB_URL=... \
    -e DEV_CHANNEL_ID=... \
    -e FOOTBALL_CHANNEL_ID=... \
    -e AUDITED_USERS=... \
    -e GOOGLE_APPLICATION_CREDENTIALS=/creds/sa.json \
    -v /path/to/sa.json:/creds/sa.json:ro \
    $DOCKER_HUB_USER/rambo-bot:latest

Push to Docker Hub:

  docker login
  make docker-push          # push :latest
  make docker-push TAG=v1.2.3

Build and push in one step:

  make deploy               # build + push :latest
  make deploy TAG=v1.2.3


GCP DEPLOYMENT (Cloud Run)
--------------------------

The recommended production setup is a Docker container on Cloud Run with
Workload Identity Federation so no service account key file is needed inside
the container.

1. Authenticate to GCP and configure Docker:

     gcloud auth login
     gcloud config set project YOUR_PROJECT_ID
     gcloud auth configure-docker

   Or use Artifact Registry instead of Docker Hub (recommended):
     gcloud auth configure-docker REGION-docker.pkg.dev

2. Build and push to Artifact Registry:

     IMAGE=REGION-docker.pkg.dev/YOUR_PROJECT_ID/REPO/rambo-bot:latest
     docker build -t $IMAGE .
     docker push $IMAGE

   Or keep using Docker Hub and just reference the public image in Cloud Run.

3. Create a service account for the bot (if not already done):

     gcloud iam service-accounts create rambo-bot \
       --display-name "Rambo Bot"

4. Grant it Firebase / Realtime Database access:

     gcloud projects add-iam-policy-binding YOUR_PROJECT_ID \
       --member="serviceAccount:rambo-bot@YOUR_PROJECT_ID.iam.gserviceaccount.com" \
       --role="roles/firebasedatabase.admin"

5. Deploy to Cloud Run:

     gcloud run deploy rambo-bot \
       --image IMAGE_URL \
       --region REGION \
       --service-account rambo-bot@YOUR_PROJECT_ID.iam.gserviceaccount.com \
       --no-allow-unauthenticated \
       --min-instances 1 \
       --max-instances 1 \
       --set-env-vars "TOKEN=...,APP_ID=...,GUILD_ID=...,FIREBASE_DB_URL=...,DEV_CHANNEL_ID=...,FOOTBALL_CHANNEL_ID=...,AUDITED_USERS=..." \
       --platform managed

   Important flags:
     --min-instances 1   keeps one instance always alive (bot must hold a persistent
                         WebSocket connection to Discord Gateway)
     --max-instances 1   only one instance should run at a time to avoid duplicate events

6. Store secrets securely with Secret Manager (recommended over --set-env-vars):

     echo -n "your-discord-token" | \
       gcloud secrets create discord-token --data-file=-

     gcloud run services update rambo-bot \
       --update-secrets TOKEN=discord-token:latest

   Repeat for each sensitive variable (TOKEN, FIREBASE_DB_URL, etc.).

7. View logs:

     gcloud run services logs read rambo-bot --region REGION --limit 100

   Or stream live:
     gcloud alpha run services logs tail rambo-bot --region REGION


GCP DEPLOYMENT (Compute Engine — simpler alternative)
------------------------------------------------------

If you prefer a plain VM running the container via Docker:

1. Create a small VM (e2-micro is enough):

     gcloud compute instances create rambo-bot \
       --machine-type e2-micro \
       --zone ZONE \
       --scopes cloud-platform \
       --service-account rambo-bot@YOUR_PROJECT_ID.iam.gserviceaccount.com \
       --image-family cos-stable \
       --image-project cos-cloud \
       --metadata-from-file user-data=cloud-init.yaml

2. Store env vars as instance metadata (do this once; values persist on the VM):

     gcloud compute instances add-metadata rambo-bot --zone ZONE \
       --metadata \
         TOKEN=your-discord-bot-token,\
         APP_ID=your-app-id,\
         GUILD_ID=your-guild-id,\
         FIREBASE_DB_URL=https://your-project-default-rtdb.firebaseio.com,\
         DEV_CHANNEL_ID=your-dev-channel-id,\
         FOOTBALL_CHANNEL_ID=your-football-channel-id,\
         AUDITED_USERS=user-id-1,user-id-2

   To update a single value later:
     gcloud compute instances add-metadata rambo-bot --zone ZONE \
       --metadata TOKEN=new-token-value

3. SSH in and run a startup script that reads metadata and launches the container.
   Save this as /etc/rambo-bot-start.sh on the VM:

     #!/bin/sh
     META="http://metadata.google.internal/computeMetadata/v1/instance/attributes"
     H="Metadata-Flavor: Google"

     get() { curl -sf -H "$H" "$META/$1"; }

     docker pull YOUR_IMAGE:latest

     docker stop rambo-bot 2>/dev/null; docker rm rambo-bot 2>/dev/null

     docker run -d --restart=unless-stopped \
       --name rambo-bot \
       -e TOKEN="$(get TOKEN)" \
       -e APP_ID="$(get APP_ID)" \
       -e GUILD_ID="$(get GUILD_ID)" \
       -e FIREBASE_DB_URL="$(get FIREBASE_DB_URL)" \
       -e DEV_CHANNEL_ID="$(get DEV_CHANNEL_ID)" \
       -e FOOTBALL_CHANNEL_ID="$(get FOOTBALL_CHANNEL_ID)" \
       -e AUDITED_USERS="$(get AUDITED_USERS)" \
       YOUR_IMAGE:latest

   Make it executable and run it:
     chmod +x /etc/rambo-bot-start.sh
     /etc/rambo-bot-start.sh

   The VM service account provides Firebase credentials automatically via ADC —
   no GOOGLE_APPLICATION_CREDENTIALS or key file needed inside the container.

4. To update the bot after pushing a new image, SSH in and re-run the script:

     gcloud compute ssh rambo-bot --zone ZONE
     /etc/rambo-bot-start.sh


UPDATING SLASH COMMANDS
-----------------------

If you add or change slash commands, re-register them:

  make deploy-commands

This does a PUT to Discord's bulk overwrite endpoint, which replaces all guild
commands atomically. It is safe to run multiple times.


PROJECT STRUCTURE
-----------------

  main.go                   Entry point, gateway connection, graceful shutdown
  register.go               Wires all commands and event handlers
  jobs_main.go              Starts background cron jobs

  bot/                      Bot struct, user cache, command dispatch
  commands/                 Slash command handlers
  interactions/             Button interaction + message mention handlers
  jobs/                     Background jobs (match post, vote reminder, calculation, sync)
  deploy-commands/          CLI tool to register slash commands with Discord

  internal/
    discord/                Gateway WS client, REST client, Discord types
    firebase/               Firebase Realtime Database client
    football/               Point calculation engine, group standings
    badges/                 Badge award logic
    flavor/                 Random flavor text picker
    notify/                 Dev channel lifecycle notifications

  templates/
    worldcup2026.json       Full tournament seed data
    worldcup2026-test.json  Test tournament seed data (near-term dates)
    flavor.json             Bot flavor text lines
