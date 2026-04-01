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

Local development
-----

* Install dependencies:
npm install

* Dev bot locally (reads from .env):
npm run dev

* Serve:
npm start

GCP Deployment (e2-micro free tier)
-----

1. Create an e2-micro VM in us-central1 with a service account that has
   Firebase Realtime Database access. No credential key file is needed --
   the Firebase Admin SDK uses Application Default Credentials on GCP.

2. Set instance metadata (via console or gcloud CLI):
   gcloud compute instances add-metadata <INSTANCE> --zone <ZONE> --metadata \
     token=<BOT_TOKEN>,\
     app-id=<APP_ID>,\
     guild-id=<GUILD_ID>,\
     channel-id=<CHANNEL_ID>,\
     dev-channel-id=<DEV_CHANNEL_ID>,\
     football-channel-id=<FOOTBALL_CHANNEL_ID>,\
     voice-channel-id=<VOICE_CHANNEL_ID>,\
     audited-users=<COMMA_SEPARATED_USER_IDS>,\
     firebase-db-url=<FIREBASE_DB_URL>

3. SSH into the VM and run the setup script:
   curl -fsSL https://codeberg.org/khoan/rambo-bot/raw/branch/main/deploy/setup.sh | sudo bash

4. Start the bot:
   sudo systemctl start rambo-bot

5. View logs:
   sudo journalctl -fu rambo-bot

6. Deploy updates:
   cd /opt/rambo-bot && sudo git pull && sudo npm ci --omit=dev
   sudo systemctl restart rambo-bot

Tournament data
-----

* Tournament data (matches, groups, config) lives entirely in Firebase
  under the `tournament/` path. See templates/ for reference JSON files.

* To set up a new tournament, push the template data to Firebase via the
  console or a script -- no code changes needed.

References
-----

https://discord.js.org/docs/packages/discord.js/14.22.1
https://discordjs.guide