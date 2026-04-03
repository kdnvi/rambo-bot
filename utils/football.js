import logger from './logger.js';
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import { readTournamentData, readTournamentConfig, updateMatch, updatePlayers, readMatchVotes, readAllVotes, readPlayers } from './firebase.js';
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
        const allMatches = (await readTournamentData('matches')).val();
        if (!allMatches) return;
        const now = Date.now();

        const matches = allMatches.filter((match) => {
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
          await updateMatch(match.id - 1, { 'messageId': msg.id });
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
        const allMatches = (await readTournamentData('matches')).val();
        if (!allMatches) return;
        const now = Date.now();

        const matches = allMatches.filter((match) => {
          if (!match.messageId || match.reminded) return false;
          const kickoff = Date.parse(match.date);
          const timeUntil = kickoff - now;
          return timeUntil > 0 && timeUntil <= VOTE_REMINDER_BEFORE_MS;
        });

        if (matches.length === 0) return;

        const players = (await readPlayers()).val();
        if (!players) return;

        const channelId = config?.channelId || process.env.FOOTBALL_CHANNEL_ID;
        const channel = await client.channels.fetch(channelId);
        const allPlayerIds = Object.keys(players);

        for (const match of matches) {
          const votes = (await readMatchVotes(match.id, match.messageId)).val();
          const votedIds = votes ? Object.keys(votes) : [];
          const unvoted = allPlayerIds.filter((id) => !votedIds.includes(id));

          if (unvoted.length === 0) {
            await updateMatch(match.id - 1, { reminded: true });
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
          await updateMatch(match.id - 1, { reminded: true });
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

export function calculatingJob(client) {
  return CronJob.from({
    cronTime: '0 */30 * * * *',
    onTick: async () => {
      try {
        const allMatches = (await readTournamentData('matches')).val();
        if (!allMatches) return;
        const now = Date.now();

        const uncalculated = allMatches.filter((m) => m.hasResult && !m.isCalculated);
        if (uncalculated.length > 0) {
          await calculateMatches(uncalculated);
        }

        const pending = allMatches.filter((match) => {
          if (match.hasResult) return false;
          const kickoff = Date.parse(match.date);
          const elapsed = now - kickoff;
          if (elapsed < RESULT_REMINDER_AFTER_MS) return false;
          const lastReminded = match.resultRemindedAt ? Date.parse(match.resultRemindedAt) : 0;
          return now - lastReminded >= RESULT_REMINDER_INTERVAL_MS;
        });

        if (pending.length === 0) return;

        const config = await readTournamentConfig();
        const channelId = config?.channelId || process.env.FOOTBALL_CHANNEL_ID;
        const channel = await client.channels.fetch(channelId);

        for (const match of pending) {
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
          await updateMatch(match.id - 1, { resultRemindedAt: new Date().toISOString() });
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

export async function calculateMatches(matches) {
  const votingObj = await readAllVotes();
  const players = (await readPlayers()).val();
  if (!players) {
    logger.warn('No players registered, skipping calculation');
    return;
  }

  const calculatedIds = [];

  for (const match of matches) {
    if (!match.messageId) {
      logger.warn(`Skipped match ${match.id} due to empty message ID, consider to update manually.`);
      continue;
    }

    const key = `${match.id - 1}`;
    if (votingObj && key in votingObj) {
      if (match.messageId in votingObj[key]) {
        const votes = votingObj[key][match.messageId];
        const votedPlayers = calculatePlayerPoints(players, votes, match);
        calculateRemainingPlayerPoints(players, match, votedPlayers);
        calculatedIds.push(match.id - 1);
        logger.info(`Calculated match ${match.id} successfully`);
      } else {
        logger.warn(`Match ${match.id} message ID is not correct, consider to update manually!`);
      }
    } else {
      logger.warn(`Match ${match.id} has not been voted yet! All votes will be randomed!`);
      calculateRemainingPlayerPoints(players, match, []);
      calculatedIds.push(match.id - 1);
    }
  }

  if (calculatedIds.length > 0) {
    await updatePlayers(players);
    for (const idx of calculatedIds) {
      await updateMatch(idx, { isCalculated: true });
    }
    logger.info(`Marked ${calculatedIds.length} match(es) as calculated`);
  }
}

function matchVoteMessageComponent(match, config) {
  const home = new ButtonBuilder()
    .setCustomId(`${match.id}|${match.home}`)
    .setLabel(match.home.toUpperCase())
    .setStyle(ButtonStyle.Success);

  const draw = new ButtonBuilder()
    .setCustomId(`${match.id}|draw`)
    .setLabel('DRAW')
    .setStyle(ButtonStyle.Primary);

  const away = new ButtonBuilder()
    .setCustomId(`${match.id}|${match.away}`)
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

function calculatePlayerPoints(players, votes, match) {
  const winner = matchWinner(match);
  const odds = winnerOdds(match, winner);
  const votedPlayers = [];

  for (const [k, v] of Object.entries(votes)) {
    if (!(k in players)) continue;
    votedPlayers.push(k);
    players[k] = {
      ...players[k],
      matches: players[k].matches + 1,
      points: v.vote === winner ? players[k].points + odds * 10 : players[k].points - 10,
    };
  }

  return votedPlayers;
}

function calculateRemainingPlayerPoints(players, match, votedPlayers) {
  const result = [match.home, 'draw', match.away];

  const winner = matchWinner(match);
  const odds = winnerOdds(match, winner);

  for (const [k, v] of Object.entries(players)) {
    if (votedPlayers.includes(k)) continue;
    const rand = result[Math.floor(Math.random() * result.length)];
    players[k] = {
      ...v,
      matches: v.matches + 1,
      points: rand === winner ? v.points + odds * 10 : v.points - 10,
    };
  }
}
