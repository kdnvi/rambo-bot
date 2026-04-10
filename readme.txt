Our Discord bot, its name is Rambo
-----

Environment variables
-----

Add to `.env` for local dev, or set as GCP instance metadata for production:

TOKEN=<your_bot_token>
APP_ID=<your_bot_application_id>
GUILD_ID=<your_guild_id>
CHANNEL_ID=<your_target_channel_id>
DEV_CHANNEL_ID=<your_development_channel_id>
FOOTBALL_CHANNEL_ID=<your_football_specific_channel_id>
VOICE_CHANNEL_ID=<your_target_voice_channel_id>
AUDITED_USERS=<list_of_users_separated_by_comma>
FIREBASE_DB_URL=<your_firebase_realtime_database_url>
MATCH_POST_BEFORE_MINS=720         (optional, default 720 — post match vote N mins before kickoff)
VOTE_REMINDER_BEFORE_MINS=30       (optional, default 30 — remind unvoted players N mins before kickoff)

Local development
-----

npm install
npm run dev                   # run bot locally (reads from .env)
npm run deploy:commands       # register slash commands with Discord

Docker (local)
-----

npm run docker:build          # build image
npm run docker:push           # push to ghcr.io
npm run docker:deploy         # build + push

CI/CD (GitHub Actions)
-----

Two workflows in .github/workflows/:
  build.yml  — builds and pushes Docker image to ghcr.io
               triggers on push to main, or manually
  deploy.yml — SSHs into the GCP VM, pulls latest image, restarts container
               triggers after a successful build, or manually

Trigger manually:
  gh workflow run build
  gh workflow run deploy

Required repo secret (Settings > Secrets and variables > Actions > Secrets):
  GCP_SA_KEY          — GCP service account JSON key

Required repo variables (Settings > Secrets and variables > Actions > Variables):
  GCE_INSTANCE        — GCP VM instance name
  GCE_ZONE            — GCP VM zone (e.g. us-central1-a)

Service account setup:
  gcloud iam service-accounts create github-deploy \
    --display-name="GitHub Actions Deploy"
  gcloud projects add-iam-policy-binding <PROJECT_ID> \
    --member="serviceAccount:github-deploy@<PROJECT_ID>.iam.gserviceaccount.com" \
    --role="roles/compute.instanceAdmin.v1"
  gcloud projects add-iam-policy-binding <PROJECT_ID> \
    --member="serviceAccount:github-deploy@<PROJECT_ID>.iam.gserviceaccount.com" \
    --role="roles/iam.serviceAccountUser"
  gcloud iam service-accounts keys create gcp-sa-key.json \
    --iam-account=github-deploy@<PROJECT_ID>.iam.gserviceaccount.com
  gh secret set GCP_SA_KEY < gcp-sa-key.json
  gh variable set GCE_INSTANCE --body "<INSTANCE>"
  gh variable set GCE_ZONE --body "<ZONE>"
  rm gcp-sa-key.json

GCP VM setup (one-time)
-----

Prerequisites: the VM and Firebase must be in the same GCP project.
The Docker image's entrypoint fetches config from GCP instance metadata on startup.
The deploy action installs Docker on the VM automatically if needed.

1. Find your VM's service account:
   gcloud compute instances describe <INSTANCE> --zone <ZONE> \
     --format='get(serviceAccounts[0].email)'

2. Grant it Firebase Realtime Database access:
   gcloud projects add-iam-policy-binding <PROJECT_ID> \
     --member="serviceAccount:<VM_SERVICE_ACCOUNT_EMAIL>" \
     --role="roles/firebasedatabase.admin"

3. Create an e2-micro VM (if not already created):
   gcloud compute instances create <INSTANCE> \
     --project=<PROJECT_ID> \
     --zone=<ZONE> \
     --machine-type=e2-micro \
     --image-family=debian-12 \
     --image-project=debian-cloud \
     --scopes=https://www.googleapis.com/auth/firebase.database,https://www.googleapis.com/auth/userinfo.email,https://www.googleapis.com/auth/logging.write

   If the VM already exists with default scopes, update them (requires stop/start):
   gcloud compute instances stop <INSTANCE> --zone=<ZONE>
   gcloud compute instances set-service-account <INSTANCE> --zone=<ZONE> \
     --scopes=https://www.googleapis.com/auth/firebase.database,https://www.googleapis.com/auth/userinfo.email,https://www.googleapis.com/auth/logging.write
   gcloud compute instances start <INSTANCE> --zone=<ZONE>

4. Set instance metadata:
   gcloud compute instances add-metadata <INSTANCE> --zone <ZONE> --metadata \
     token=<BOT_TOKEN>,\
     app-id=<APP_ID>,\
     guild-id=<GUILD_ID>,\
     channel-id=<CHANNEL_ID>,\
     dev-channel-id=<DEV_CHANNEL_ID>,\
     football-channel-id=<FOOTBALL_CHANNEL_ID>,\
     voice-channel-id=<VOICE_CHANNEL_ID>,\
     audited-users=<COMMA_SEPARATED_USER_IDS>,\
     firebase-db-url=<FIREBASE_DB_URL>,\
     match-post-before-mins=720,\
     vote-reminder-before-mins=30

5. View logs:
   gcloud compute ssh <INSTANCE> --zone <ZONE> --command 'docker logs -f rambo-bot'

Tournament data
-----

Tournament data lives in Firebase under `tournament/`.

Upload tournament data:
  firebase database:set /tournament templates/worldcup2026.json --project <PROJECT_ID>

Upload test data:
  firebase database:set /tournament templates/worldcup2026-test.json --project <PROJECT_ID>

Validate a template before pushing:
  node validate-playoff.js

Flavor text (bot personality)
-----

All flavor text (roasts, curse lines, hype lines, etc.) is stored in
Firebase under `flavor/` and cached for 24 hours.

Seed or reset flavor text:
  firebase database:set /flavor templates/flavor.json --project <PROJECT_ID>

To update lines without redeploying, edit directly in the Firebase console.
Changes take effect within 24 hours (or immediately on restart).

Available keys (see templates/flavor.json):
  drunk, last_sec, reply, mention, leader, bottom, all_win, all_lose,
  curse_win, curse_lose, curse, relief, roast, hype, chicken, random, rival

References
-----

https://discord.js.org/docs/packages/discord.js/14.22.1
https://discordjs.guide
