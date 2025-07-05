# rambo-bot
My Discord bot, its name is Rambo

## Requirements
In able to run project, make sure `node 22.2.0` or above is installed.

Clone repository by `git clone` to your local computer:
```shell script
$ git clone git@github.com:khoavi/rambo-bot.git
$ cd rambo-bot
```

You need to add these following values to `.env` file (recommended) or you can use `config.json` as an alternative
```
TOKEN=[your_bot_token]
APP_ID=[your_bot_application_id]
GUILD_ID=[your_guild_id]
CHANNEL_ID=[your_target_channel_id]
DEV_CHANNEL_ID=[your_development_channel_id]
FOOTBALL_CHANNEL_ID=[your_football_specific_channel_id]
VOICE_CHANNEL_ID=[your_target_voice_channel_id]
AUDITED_USERS=[list_of_users_separated_by_comma]
FIREBASE_DB_URL=[your_firebase_realtime_database_url]
FIREBASE_SERVICE_ACCOUNT_PATH=[path_to_firebase_service_account_json_file]
```

## Build and run
Install all dependencies:
```shell script
$ npm install
```
Compile and run your bot locally:
```shell script
$ npm start
```

## Release
TBA

## References
[discordjs](https://discordjs.guide)
