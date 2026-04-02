import logger from './logger.js';
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import { readTournamentData, readTournamentConfig, updateMatch, updatePlayers } from './firebase.js';
import { isOneDayAhead } from './helper.js';
import { CronJob } from 'cron';

export function dailyMatchPostJob(client) {
  return CronJob.from({
    cronTime: '0 30 1 * * *',
    onTick: async () => {
      try {
        const config = await readTournamentConfig();
        const resp = await readTournamentData('matches');
        const matches = resp.val().filter((match) => {
          const date = new Date(Date.parse(match.date));
          return isOneDayAhead(date);
        });
        const channelId = config?.channelId || process.env.FOOTBALL_CHANNEL_ID;
        const channel = await client.channels.fetch(channelId);
        matches.forEach((match) => {
          const message = matchVoteMessageComponent(match, config);
          channel.send(message).then((msg) => {
            logger.info(`Match between ${match.home} and ${match.away} is sent with message ID [${msg.id}]`);
            updateMatch(match, { 'messageId': msg.id });
          });
        });
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
