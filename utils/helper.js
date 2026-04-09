import logger from './logger.js';
import { EmbedBuilder } from 'discord.js';
import { readMatchVotes, readTournamentConfig } from './firebase.js';
import { CronJob } from 'cron';

export function getWinner(match) {
  if (!match.result) return null;
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

const VN_TZ = 'Asia/Ho_Chi_Minh';

export function getMatchDay(dateStr) {
  return new Date(dateStr).toLocaleDateString('sv-SE', { timeZone: VN_TZ });
}

export function getMatchVote(votes, matchIndex, messageId, userId) {
  if (!votes || !(matchIndex in votes) || !messageId || !(messageId in votes[matchIndex])) return null;
  return votes[matchIndex][messageId]?.[userId]?.vote ?? null;
}

export function getMatchVotes(votes, matchIndex, messageId) {
  if (!votes || !(matchIndex in votes) || !messageId || !(messageId in votes[matchIndex])) return null;
  return votes[matchIndex][messageId] || null;
}

export function findNextMatch(allMatches) {
  const now = Date.now();
  return allMatches
    .filter((m) => !m.hasResult && Date.parse(m.date) > now)
    .sort((a, b) => Date.parse(a.date) - Date.parse(b.date))[0] || null;
}

const VOTE_SEPARATOR = '\n\n📊 ';

export function buildPollEmbedUpdate(existingEmbed, match, votes) {
  const voteCount = votes ? Object.keys(votes).length : 0;

  const distribution = { [match.home]: 0, draw: 0, [match.away]: 0 };
  if (votes) {
    for (const v of Object.values(votes)) {
      if (v.vote in distribution) distribution[v.vote]++;
    }
  }
  const pct = (n) => voteCount > 0 ? Math.round((n / voteCount) * 100) : 0;
  const hp = pct(distribution[match.home]);
  const dp = pct(distribution.draw);
  const ap = pct(distribution[match.away]);

  const barText = `${match.home.toUpperCase()} ${hp}%  ·  Hoà ${dp}%  ·  ${match.away.toUpperCase()} ${ap}%`;

  const updatedEmbed = EmbedBuilder.from(existingEmbed)
    .setFooter({ text: `${voteCount} vote · Bấm bên dưới trước giờ đá!` });

  const baseDesc = (existingEmbed.description || '').split(VOTE_SEPARATOR)[0];
  updatedEmbed.setDescription(`${baseDesc}${VOTE_SEPARATOR}${barText}`);

  return updatedEmbed;
}

export async function updatePollEmbed(client, match) {
  const config = await readTournamentConfig();
  const channelId = config?.channelId || process.env.FOOTBALL_CHANNEL_ID;
  const channel = await client.channels.fetch(channelId);
  const pollMessage = await channel.messages.fetch(match.messageId);

  const votes = await readMatchVotes(match.id, match.messageId);
  const updatedEmbed = buildPollEmbedUpdate(pollMessage.embeds[0], match, votes);
  await pollMessage.edit({ embeds: [updatedEmbed] });
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
    logger.error(`Failed to fetch Discord users — all player names will show as "Unknown". Check GUILD_ID and bot permissions.`);
    logger.error(err);
  }

  return {};
}
