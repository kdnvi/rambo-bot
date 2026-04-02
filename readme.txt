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
RESULT_REMINDER_AFTER_MINS=180     (optional, default 180 — start nagging for result N mins after kickoff)
RESULT_REMINDER_INTERVAL_MINS=30   (optional, default 30 — repeat result reminder every N mins)

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

Prerequisites: the VM and Firebase must be in the same GCP project.

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
     vote-reminder-before-mins=30,\
     result-reminder-after-mins=180,\
     result-reminder-interval-mins=30

5. SSH into the VM and run the setup script:
   curl -fsSL https://raw.githubusercontent.com/kdnvi/rambo-bot/main/deploy/setup.sh | sudo bash

6. Start the bot:
   sudo systemctl start rambo-bot

7. View logs:
   sudo journalctl -fu rambo-bot

8. Deploy updates:
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