import logger from './logger.js';
import { CronJob } from 'cron';

export function getWinner(match) {
  if (match.result.home > match.result.away) return match.home;
  if (match.result.home < match.result.away) return match.away;
  return 'draw';
}

export function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

export const VND_FORMATTER = new Intl.NumberFormat('vi-VN', {
  style: 'currency',
  currency: 'VND',
});

export function findNextMatch(allMatches) {
  const now = Date.now();
  let match = allMatches
    .filter((m) => m.messageId && Date.parse(m.date) > now)
    .sort((a, b) => Date.parse(a.date) - Date.parse(b.date))[0];
  if (!match) {
    match = allMatches
      .filter((m) => Date.parse(m.date) > now)
      .sort((a, b) => Date.parse(a.date) - Date.parse(b.date))[0];
  }
  return match || null;
}

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
    const userIds = (process.env.AUDITED_USERS || '').split(',').filter(Boolean);
    if (userIds.length === 0) {
      logger.warn('AUDITED_USERS is empty, skipping user fetch');
      return {};
    }
    const guildMembers = await guild.members.fetch({ user: userIds });
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
