Our Discord bot, its name is Rambo
-----

* Environment variables (add to `.env` for local dev, or set as GCP instance metadata for production):
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

* Install dependencies:
npm install

* Dev bot locally (reads from .env):
npm run dev

* Deploy slash commands:
npm run deploy:commands

Docker
-----

* Build and push via GitHub Actions (automatic on push to main):
  Or trigger manually from the Actions tab / CLI:
  gh workflow run build

* Build and push locally:
npm run docker:deploy

* Or separately:
npm run docker:build
npm run docker:push

GCP Deployment (e2-micro free tier)
-----

Prerequisites: the VM and Firebase must be in the same GCP project.
The Docker image's entrypoint automatically fetches config from GCP instance metadata.

1. Find your VM's service account:
   gcloud compute instances describe <INSTANCE> --zone <ZONE> --format='get(serviceAccounts[0].email)'

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

4. Set instance metadata (via console or gcloud CLI):
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

5. SSH into the VM, install Docker, and run the bot:
   curl -fsSL https://get.docker.com | sh
   docker run -d --restart unless-stopped --name rambo-bot ghcr.io/kdnvi/rambo-bot:latest

6. View logs:
   docker logs -f rambo-bot

7. Deploy updates (from your local machine, then on the VM):
   npm run docker:deploy
   docker pull ghcr.io/kdnvi/rambo-bot:latest && docker rm -f rambo-bot && docker run -d --restart unless-stopped --name rambo-bot ghcr.io/kdnvi/rambo-bot:latest

Tournament data
-----

* Tournament data (matches, groups, config) lives entirely in Firebase
  under the `tournament/` path. See templates/ for reference JSON files.

* To set up a new tournament, push the template to Firebase:
  firebase database:set /tournament templates/worldcup2026.json --project <PROJECT_ID>

* Template files:
  templates/worldcup2026.json       — production (full 104-match bracket)
  templates/worldcup2026-test.json  — testing (same structure, smaller dataset)

* A template contains:
  - config    — tournament name, rules text, channel overrides
  - groups    — 12 groups (A–L) with 4 teams each, zeroed standings
  - matches   — all matches (group stage + knockout), with dates, venues, and team codes

* Validate a template before pushing:
  node validate-playoff.js

* To update config (e.g. rulesText, channelId) without resetting the whole
  tournament, edit directly in the Firebase console under tournament/config.

Flavor text (bot personality)
-----

* All flavor text (roasts, curse lines, hype lines, etc.) is stored in
  Firebase under the `flavor/` path and cached for 24 hours.

* To seed or reset flavor text from the template:
  firebase database:set /flavor templates/flavor.json --project <PROJECT_ID>

* To update lines without redeploying, edit directly in the Firebase
  console. Changes take effect within 24 hours (or immediately on restart).

* See templates/flavor.json for all available keys:
  drunk, last_sec, reply, mention, leader, bottom, all_win, all_lose,
  curse_win, curse_lose, curse, relief, roast, hype, chicken, random, rival

References
-----

https://discord.js.org/docs/packages/discord.js/14.22.1
https://discordjs.guide