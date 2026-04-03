import logger from './logger.js';
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import { readTournamentData, readTournamentConfig, updateMatch, updatePlayers, readMatchVotes, readAllVotes, readPlayers, readPlayerWagers, readAllAllIns, readCurses } from './firebase.js';
import { CronJob } from 'cron';

const STAGE_STAKES = [
  { minId: 1, maxId: 72, stake: 10 },
  { minId: 73, maxId: 88, stake: 10 },
  { minId: 89, maxId: 96, stake: 15 },
  { minId: 97, maxId: 100, stake: 20 },
  { minId: 101, maxId: 102, stake: 30 },
  { minId: 103, maxId: 104, stake: 50 },
];

export function getMatchStake(matchId) {
  const entry = STAGE_STAKES.find((s) => matchId >= s.minId && matchId <= s.maxId);
  return entry?.stake || 10;
}

const MATCH_POST_BEFORE_MS = (parseInt(process.env.MATCH_POST_BEFORE_MINS) || 720) * 60 * 1000;
const VOTE_REMINDER_BEFORE_MS = (parseInt(process.env.VOTE_REMINDER_BEFORE_MINS) || 30) * 60 * 1000;
const RESULT_REMINDER_AFTER_MS = 3 * 60 * 60 * 1000;

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
          await checkMatchdayMVP(client, allMatches, uncalculated);
        }

        const pending = allMatches.filter((match) => {
          if (match.hasResult || match.resultReminded) return false;
          const kickoff = Date.parse(match.date);
          return now - kickoff >= RESULT_REMINDER_AFTER_MS;
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
          await updateMatch(match.id - 1, { resultReminded: true });
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

async function checkMatchdayMVP(client, allMatches, justCalculated) {
  try {
    const matchDays = new Set(justCalculated.map((m) => m.date.slice(0, 10)));

    for (const day of matchDays) {
      const dayMatches = allMatches.filter((m) => m.date.startsWith(day));
      const allDone = dayMatches.every((m) => m.hasResult && m.isCalculated);
      if (!allDone || dayMatches.length < 2) continue;

      const alreadyAnnounced = dayMatches.some((m) => m.mvpAnnounced);
      if (alreadyAnnounced) continue;

      const votes = await readAllVotes();
      const players = (await readPlayers()).val();
      if (!players) continue;

      const scores = {};
      for (const userId of Object.keys(players)) {
        scores[userId] = 0;
      }

      for (const match of dayMatches) {
        const winner = matchWinner(match);
        const key = `${match.id - 1}`;
        const stake = getMatchStake(match.id);

        if (votes && key in votes && match.messageId && match.messageId in votes[key]) {
          const matchVotes = votes[key][match.messageId];
          for (const [userId, v] of Object.entries(matchVotes)) {
            if (!(userId in scores)) continue;
            scores[userId] += v.vote === winner ? stake : -stake;
          }
        }
      }

      const ranked = Object.entries(scores)
        .map(([id, pts]) => ({ id, pts }))
        .sort((a, b) => b.pts - a.pts);

      if (ranked.length === 0 || ranked[0].pts <= 0) continue;

      const mvp = ranked[0];
      const config = await readTournamentConfig();
      const channelId = config?.channelId || process.env.FOOTBALL_CHANNEL_ID;
      const channel = await client.channels.fetch(channelId);
      const users = client.cachedUsers;
      const nickname = users[mvp.id]?.nickname || 'Unknown';

      const embed = new EmbedBuilder()
        .setTitle('⭐  Matchday MVP')
        .setDescription(
          `**${nickname}** dominated today's ${dayMatches.length} match(es) ` +
          `with a net gain of **+${mvp.pts}** points!`
        )
        .setColor(0xFFD700)
        .setTimestamp();

      if (users[mvp.id]?.avatarURL) {
        embed.setThumbnail(users[mvp.id].avatarURL);
      }

      await channel.send({ embeds: [embed] });

      const rivalryEmbed = await checkRivalry(allMatches, votes, players, users);
      if (rivalryEmbed) {
        await channel.send({ embeds: [rivalryEmbed] });
      }

      for (const match of dayMatches) {
        await updateMatch(match.id - 1, { mvpAnnounced: true });
      }
      logger.info(`Announced matchday MVP for ${day}: ${nickname}`);
    }
  } catch (err) {
    logger.error('Failed to check matchday MVP:', err);
  }
}

async function checkRivalry(allMatches, votes, players, users) {
  try {
    const completed = allMatches.filter((m) => m.hasResult && m.isCalculated);
    if (completed.length < 5) return null;

    const playerIds = Object.keys(players);
    if (playerIds.length < 2) return null;

    const disagreements = {};

    for (const match of completed) {
      const key = `${match.id - 1}`;
      if (!votes || !(key in votes) || !match.messageId || !(match.messageId in votes[key])) continue;
      const mv = votes[key][match.messageId];

      for (let i = 0; i < playerIds.length; i++) {
        for (let j = i + 1; j < playerIds.length; j++) {
          const a = playerIds[i];
          const b = playerIds[j];
          if (!(a in mv) || !(b in mv)) continue;
          const pairKey = [a, b].sort().join('|');
          if (!disagreements[pairKey]) disagreements[pairKey] = { count: 0, total: 0 };
          disagreements[pairKey].total++;
          if (mv[a].vote !== mv[b].vote) disagreements[pairKey].count++;
        }
      }
    }

    let topPair = null;
    let topCount = 0;
    for (const [pair, data] of Object.entries(disagreements)) {
      if (data.total >= 5 && data.count > topCount) {
        topCount = data.count;
        topPair = { ids: pair.split('|'), ...data };
      }
    }

    if (!topPair || topCount < 3) return null;

    const pct = Math.round((topPair.count / topPair.total) * 100);
    if (pct < 50) return null;

    const nameA = users[topPair.ids[0]]?.nickname || 'Unknown';
    const nameB = users[topPair.ids[1]]?.nickname || 'Unknown';

    const RIVAL_LINES = [
      `Can't agree on anything. Official enemies.`,
      `If one says left, the other says right.`,
      `The rivalry is REAL. 🍿`,
      `Somebody get these two a boxing ring.`,
      `They'd disagree on what day it is.`,
    ];

    return new EmbedBuilder()
      .setTitle('⚔️  Rivalry Alert')
      .setDescription(
        `**${nameA}** and **${nameB}** have disagreed on **${topPair.count}** out of **${topPair.total}** matches (**${pct}%**)!\n\n` +
        RIVAL_LINES[Math.floor(Math.random() * RIVAL_LINES.length)]
      )
      .setColor(0x9B59B6)
      .setTimestamp();
  } catch (err) {
    logger.error('Failed to check rivalry:', err);
    return null;
  }
}

const calculationLock = new Set();

export async function calculateMatches(matches) {
  const toProcess = matches.filter((m) => !calculationLock.has(m.id));
  if (toProcess.length === 0) {
    logger.info('All matches already being calculated, skipping');
    return;
  }
  for (const m of toProcess) calculationLock.add(m.id);

  try {
    const votingObj = await readAllVotes();
    const players = (await readPlayers()).val();
    if (!players) {
      logger.warn('No players registered, skipping calculation');
      return;
    }

    const wagers = await readPlayerWagers();
    const allIns = await readAllAllIns();
    const curses = await readCurses();

    const calculatedIds = [];

    for (const match of toProcess) {
      if (!match.messageId) {
        logger.warn(`Skipped match ${match.id} due to empty message ID, consider to update manually.`);
        continue;
      }

      const key = `${match.id - 1}`;
      const votes = (votingObj && key in votingObj && match.messageId in (votingObj[key] || {}))
        ? votingObj[key][match.messageId]
        : null;

      if (!votes) {
        logger.warn(`Match ${match.id} has no votes — all picks will be randomized`);
      }

      const { votedPlayers, randomPicks } = calculatePlayerPoints(players, votes, match, wagers, allIns);
      resolveCurses(players, curses, match, votingObj, votedPlayers, randomPicks);
      calculatedIds.push(match.id - 1);
      logger.info(`Calculated match ${match.id} successfully`);
    }

    if (calculatedIds.length > 0) {
      await updatePlayers(players);
      for (const idx of calculatedIds) {
        await updateMatch(idx, { isCalculated: true });
      }
      logger.info(`Marked ${calculatedIds.length} match(es) as calculated`);
    }
  } finally {
    for (const m of toProcess) calculationLock.delete(m.id);
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

  const stake = getMatchStake(match.id);
  const stakeNote = stake > 10 ? `\n💰 **Stake:** ${stake} points (knockout multiplier!)` : '';

  const embed = new EmbedBuilder()
    .setTitle(`⚽  ${match.home.toUpperCase()}  vs  ${match.away.toUpperCase()}`)
    .setDescription(
      `**${tournamentName}** — Match #${match.id}\n\n` +
      `🕐 **Kickoff:** ${timeStr} *(VN)* — <t:${timestamp}:R>\n` +
      `🏟️ **Venue:** ${match.location}` +
      stakeNote
    )
    .setColor(0x5865F2)
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

function calculatePlayerPoints(players, votes, match, wagers, allIns) {
  const winner = matchWinner(match);
  const outcomes = [match.home, 'draw', match.away];
  const baseStake = getMatchStake(match.id);
  const votedPlayers = [];
  const randomPicks = {};

  const picks = {};
  if (votes) {
    for (const [k, v] of Object.entries(votes)) {
      if (!(k in players)) continue;
      votedPlayers.push(k);
      picks[k] = v.vote;
    }
  }

  for (const k of Object.keys(players)) {
    if (votedPlayers.includes(k)) continue;
    const randomPick = outcomes[Math.floor(Math.random() * outcomes.length)];
    picks[k] = randomPick;
    randomPicks[k] = randomPick;
  }

  const playerStakes = {};
  for (const k of Object.keys(picks)) {
    let stake = baseStake;
    if (wagers?.[k]?.[match.id]?.type === 'double-down') {
      stake *= 2;
    }
    playerStakes[k] = stake;
  }

  const totalLoserStake = Object.entries(picks)
    .filter(([, pick]) => pick !== winner)
    .reduce((sum, [k]) => sum + playerStakes[k], 0);

  const totalWinnerStake = Object.entries(picks)
    .filter(([, pick]) => pick === winner)
    .reduce((sum, [k]) => sum + playerStakes[k], 0);

  for (const [k, pick] of Object.entries(picks)) {
    const isWinner = pick === winner;
    let delta;
    if (isWinner) {
      delta = totalWinnerStake > 0
        ? (playerStakes[k] / totalWinnerStake) * totalLoserStake
        : 0;
    } else {
      delta = -playerStakes[k];
    }

    const allIn = allIns?.[k]?.[match.id];
    if (allIn) {
      delta += isWinner ? allIn.amount : -allIn.amount;
    }

    players[k] = {
      ...players[k],
      matches: players[k].matches + 1,
      points: players[k].points + delta,
    };
  }

  return { votedPlayers, randomPicks };
}

function resolveCurses(players, curses, match, votingObj, votedPlayers, randomPicks) {
  const matchCurses = curses[match.id];
  if (!matchCurses) return;

  const winner = matchWinner(match);
  const key = `${match.id - 1}`;

  for (const [curserId, { target }] of Object.entries(matchCurses)) {
    if (!(curserId in players) || !(target in players)) continue;

    let targetVote = null;
    if (votingObj && key in votingObj && match.messageId in (votingObj[key] || {})) {
      const mv = votingObj[key][match.messageId];
      if (target in mv) targetVote = mv[target].vote;
    }
    if (targetVote === null) {
      targetVote = randomPicks[target] || null;
    }
    if (targetVote === null) continue;

    const targetCorrect = targetVote === winner;
    const CURSE_PTS = 5;

    if (targetCorrect) {
      players[curserId].points -= CURSE_PTS;
      players[target].points += CURSE_PTS;
    } else {
      players[curserId].points += CURSE_PTS;
      players[target].points -= CURSE_PTS;
    }

    logger.info(`Curse resolved: ${curserId} ${targetCorrect ? 'lost' : 'gained'} ${CURSE_PTS} pts (target: ${target}, match: ${match.id})`);
  }
}
