import logger from './logger.js';
import { CronJob } from 'cron';

export function syncDiscordUsersJob(client) {
  return CronJob.from({
    cronTime: '0 0 2 * * *',
    onTick: async () => {
      client.cachedUsers = await fetchDiscordUsers(client);
    },
    start: true,
    timeZone: 'utc',
  });
}

export async function fetchDiscordUsers(client) {
  try {
    const guild = await client.guilds.fetch(process.env.GUILD_ID);
    const guildMembers = await guild.members.fetch({ user: process.env.AUDITED_USERS.split(','), withPresences: true });
    const members = {};
    for (const [key, value] of guildMembers.entries()) {
      members[key] = {
        id: value.user.id,
        username: value.user.username,
        globalName: value.user.globalName,
        nickname: value.nickname,
        avatarURL: value.displayAvatarURL(),
      };
    }
    return members;
  } catch (err) {
    logger.error(err);
  }

  return {};
}
