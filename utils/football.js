import logger from './logger.js';
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import { readTournamentData, readTournamentConfig, updateMatch, updatePlayers, readMatchVotes } from './firebase.js';
import { CronJob } from 'cron';

const MATCH_POST_BEFORE_MS = (parseInt(process.env.MATCH_POST_BEFORE_MINS) || 720) * 60 * 1000;
const VOTE_REMINDER_BEFORE_MS = (parseInt(process.env.VOTE_REMINDER_BEFORE_MINS) || 30) * 60 * 1000;
const RESULT_REMINDER_AFTER_MS = (parseInt(process.env.RESULT_REMINDER_AFTER_MINS) || 180) * 60 * 1000;
const RESULT_REMINDER_INTERVAL_MS = (parseInt(process.env.RESULT_REMINDER_INTERVAL_MINS) || 30) * 60 * 1000;

export function matchPostJob(client) {
  return CronJob.from({
    cronTime: '0 */15 * * * *',
    onTick: async () => {
      try {
        const config = await readTournamentConfig();
        const resp = await readTournamentData('matches');
        const now = Date.now();

        const matches = resp.val().filter((match) => {
          if (match.messageId) return false;
          const kickoff = Date.parse(match.date);
          const timeUntil = kickoff - now;
          return timeUntil > 0 && timeUntil <= MATCH_POST_BEFORE_MS;
        });

        if (matches.length === 0) return;

        const channelId = config?.channelId || process.env.FOOTBALL_CHANNEL_ID;
        const channel = await client.channels.fetch(channelId);

        for (const match of matches) {
          const message = matchVoteMessageComponent(match, config);
          const msg = await channel.send(message);
          logger.info(`Match between ${match.home} and ${match.away} is sent with message ID [${msg.id}]`);
          await updateMatch(match, { 'messageId': msg.id });
        }
      } catch (err) {
        logger.error(err);
      }
    },
    start: true,
    timeZone: 'utc',
  });
}

export function voteReminderJob(client) {
  return CronJob.from({
    cronTime: '0 */15 * * * *',
    onTick: async () => {
      try {
        const config = await readTournamentConfig();
        const resp = await readTournamentData('matches');
        const now = Date.now();

        const matches = resp.val().filter((match) => {
          if (!match.messageId || match.reminded) return false;
          const kickoff = Date.parse(match.date);
          const timeUntil = kickoff - now;
          return timeUntil > 0 && timeUntil <= VOTE_REMINDER_BEFORE_MS;
        });

        if (matches.length === 0) return;

        const players = (await readTournamentData('players')).val();
        if (!players) return;

        const channelId = config?.channelId || process.env.FOOTBALL_CHANNEL_ID;
        const channel = await client.channels.fetch(channelId);
        const allPlayerIds = Object.keys(players);

        for (const match of matches) {
          const votes = (await readMatchVotes(match.id, match.messageId)).val();
          const votedIds = votes ? Object.keys(votes) : [];
          const unvoted = allPlayerIds.filter((id) => !votedIds.includes(id));

          if (unvoted.length === 0) {
            await updateMatch(match, { reminded: true });
            continue;
          }

          const mentions = unvoted.map((id) => `<@${id}>`).join(' ');
          const ts = Math.floor(Date.parse(match.date) / 1000);

          const embed = new EmbedBuilder()
            .setTitle(`⏰  Vote Reminder — Match #${match.id}`)
            .setDescription(
              `**${match.home.toUpperCase()} vs ${match.away.toUpperCase()}**\n` +
              `Kickoff <t:${ts}:R> — vote now or your pick will be **randomized**!`
            )
            .setColor(0xFEE75C);

          await channel.send({ content: mentions, embeds: [embed] });
          await updateMatch(match, { reminded: true });
          logger.info(`Sent vote reminder for match ${match.id} to ${unvoted.length} player(s)`);
        }
      } catch (err) {
        logger.error(err);
      }
    },
    start: true,
    timeZone: 'utc',
  });
}

export function resultReminderJob(client) {
  return CronJob.from({
    cronTime: '0 */15 * * * *',
    onTick: async () => {
      try {
        const config = await readTournamentConfig();
        const resp = await readTournamentData('matches');
        const now = Date.now();

        const matches = resp.val().filter((match) => {
          if (match.hasResult) return false;
          const kickoff = Date.parse(match.date);
          const elapsed = now - kickoff;
          if (elapsed < RESULT_REMINDER_AFTER_MS) return false;
          const lastReminded = match.resultRemindedAt ? Date.parse(match.resultRemindedAt) : 0;
          return now - lastReminded >= RESULT_REMINDER_INTERVAL_MS;
        });

        if (matches.length === 0) return;

        const channelId = config?.channelId || process.env.FOOTBALL_CHANNEL_ID;
        const channel = await client.channels.fetch(channelId);

        for (const match of matches) {
          const elapsed = Math.floor((now - Date.parse(match.date)) / 60000);
          const hours = Math.floor(elapsed / 60);
          const mins = elapsed % 60;

          const embed = new EmbedBuilder()
            .setTitle(`🔔  Result Pending — Match #${match.id}`)
            .setDescription(
              `**${match.home.toUpperCase()} vs ${match.away.toUpperCase()}**\n` +
              `Kicked off **${hours}h ${mins}m ago** — please update the result.\n\n` +
              `Use \`/update-result match-id:${match.id} home-score:? away-score:?\``
            )
            .setColor(0xED4245);

          await channel.send({ embeds: [embed] });
          await updateMatch(match, { resultRemindedAt: new Date().toISOString() });
          logger.info(`Sent result reminder for match ${match.id}`);
        }
      } catch (err) {
        logger.error(err);
      }
    },
    start: true,
    timeZone: 'utc',
  });
}

export function dailyCalculatingJob() {
  return CronJob.from({
    cronTime: '0 0 * * * *',
    onTick: async () => {
      try {
        const resp = await readTournamentData('matches');
        const matches = resp.val().filter((match) => {
          return match.hasResult && !match.isCalculated;
        });

        if (matches.length === 0) {
          logger.warn('No match to calculate!');
          return;
        }

        const votingObj = (await readTournamentData('votes')).val();
        const players = (await readTournamentData('players')).val();

        for (const match of matches) {
          if (!match.messageId) {
            logger.warn(`Skipped match ${match.id} due to empty message ID, consider to update manually.`);
            continue;
          }

          const key = `${match.id - 1}`;
          if (key in votingObj) {
            if (match.messageId in votingObj[key]) {
              const votes = votingObj[key][match.messageId];
              const votedPlayers = await calculatePlayerPoints(players, votes, match);
              await calculateRemainingPlayerPoints(players, match, votedPlayers);
              await updateMatch(match, { isCalculated: true });
              logger.info(`Calculated match ${match.id} successfully`);
            } else {
              logger.warn(`Match ${match.id} message ID is not correct, consider to update manually!`);
            }
          } else {
            logger.warn(`Match ${match.id} has not been voted yet! All votes will be randomed!`);
            const votedPlayers = [];
            await calculateRemainingPlayerPoints(players, match, votedPlayers);
          }
        }
        await updatePlayers(players);
        logger.info('Players updated');
      } catch (err) {
        logger.error(err);
      }
    },
    start: true,
    timeZone: 'utc',
  });
}

function matchVoteMessageComponent(match, config) {
  const home = new ButtonBuilder()
    .setCustomId(`${match.home}_${match.id}_${match.date}`)
    .setLabel(match.home.toUpperCase())
    .setStyle(ButtonStyle.Success);

  const draw = new ButtonBuilder()
    .setCustomId(`draw_${match.id}_${match.date}`)
    .setLabel('DRAW')
    .setStyle(ButtonStyle.Primary);

  const away = new ButtonBuilder()
    .setCustomId(`${match.away}_${match.id}_${match.date}`)
    .setLabel(match.away.toUpperCase())
    .setStyle(ButtonStyle.Danger);

  const tournamentName = config?.name || 'Tournament';
  const kickoff = new Date(match.date);
  const timeStr = kickoff.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
  const timestamp = Math.floor(kickoff.getTime() / 1000);

  const embed = new EmbedBuilder()
    .setTitle(`⚽  ${match.home.toUpperCase()}  vs  ${match.away.toUpperCase()}`)
    .setDescription(
      `**${tournamentName}** — Match #${match.id}\n\n` +
      `🕐 **Kickoff:** ${timeStr} *(VN)* — <t:${timestamp}:R>\n` +
      `🏟️ **Venue:** ${match.location}`
    )
    .setColor(0x5865F2)
    .addFields(
      { name: '🏠 Home', value: `\`${match.odds.home}\``, inline: true },
      { name: '🤝 Draw', value: `\`${match.odds.draw}\``, inline: true },
      { name: '✈️ Away', value: `\`${match.odds.away}\``, inline: true },
    )
    .setFooter({ text: 'Vote below before kickoff!' })
    .setTimestamp(kickoff);

  const row = new ActionRowBuilder()
    .addComponents(home, draw, away);

  return {
    embeds: [embed],
    components: [row],
  };
}

function matchWinner(match) {
  if (match.result.home > match.result.away) {
    return match.home;
  } else if (match.result.home < match.result.away) {
    return match.away;
  } else {
    return 'draw';
  }
}

function winnerOdds(match, winner) {
  if (winner === match.home) {
    return match.odds.home;
  } else if (winner === match.away) {
    return match.odds.away;
  }
  return match.odds.draw;
}

async function calculatePlayerPoints(players, votes, match) {
  const winner = matchWinner(match);
  const odds = winnerOdds(match, winner);
  const votedPlayers = [];

  for (const [k, v] of Object.entries(votes)) {
    votedPlayers.push(k);
    players[k] = {
      matches: players[k].matches + 1,
      points: v.vote === winner ? players[k].points + odds * 10 : players[k].points - 10,
    };
  }

  return votedPlayers;
}

async function calculateRemainingPlayerPoints(players, match, votedPlayers) {
  const result = [match.home, 'draw', match.away];

  const winner = matchWinner(match);
  const odds = winnerOdds(match, winner);

  for (const [k, v] of Object.entries(players)) {
    const rand = result[Math.floor(Math.random() * result.length)];
    if (!votedPlayers.includes(k)) {
      players[k] = {
        matches: v.matches + 1,
        points: rand === winner ? v.points + odds * 10 : v.points - 10,
      };
    }
  }
}
