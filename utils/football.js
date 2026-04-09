import logger from './logger.js';
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import { readTournamentData, readTournamentConfig, updateMatch, updatePlayers, readMatchVotes, readAllVotes, readPlayers, readPlayerWagers, readCurses, readAllBadges, updateGroupTeam } from './firebase.js';
import { getWinner, getMatchDay, getMatchVotes } from './helper.js';
import { checkAndAwardBadges } from './badges.js';
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

        const config = await readTournamentConfig();
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

        const config = await readTournamentConfig();
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
            .setTitle(`⏰  Nhắc vote — Trận #${match.id}`)
            .setDescription(
              `**${match.home.toUpperCase()} vs ${match.away.toUpperCase()}**\n` +
              `Còn <t:${ts}:R> là đá — vote đi không thì bị gán **đội ít vote nhất**!`,
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
          for (const m of uncalculated) {
            await updateGroupStandings(m);
          }
          await calculateMatches(uncalculated, client);
          const freshMatches = (await readTournamentData('matches')).val();
          await checkMatchdayMVP(client, freshMatches || allMatches, uncalculated);
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
            .setTitle(`🔔  Chờ kết quả — Trận #${match.id}`)
            .setDescription(
              `**${match.home.toUpperCase()} vs ${match.away.toUpperCase()}**\n` +
              `Đá được **${hours}h ${mins}m** rồi — cập nhật kết quả đi!\n\n` +
              `Gõ \`/update-result match-id:${match.id} home-score:? away-score:?\``,
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
    const matchDays = new Set(justCalculated.map((m) => getMatchDay(m.date)));

    for (const day of matchDays) {
      const dayMatches = allMatches.filter((m) => getMatchDay(m.date) === day);
      const allDone = dayMatches.every((m) => m.hasResult && m.isCalculated);
      if (!allDone || dayMatches.length < 2) continue;

      const alreadyAnnounced = dayMatches.some((m) => m.mvpAnnounced);
      if (alreadyAnnounced) continue;

      const [votes, players, wagers, config] = await Promise.all([
        readAllVotes(),
        readPlayers().then((s) => s.val()),
        readPlayerWagers(),
        readTournamentConfig(),
      ]);
      if (!players) continue;

      const WAGER_MULTIPLIERS = { 'double-down': 2 };

      const scores = {};
      for (const userId of Object.keys(players)) {
        scores[userId] = 0;
      }

      for (const match of dayMatches) {
        const winner = getWinner(match);
        if (!winner) continue;
        const key = `${match.id - 1}`;
        const baseStake = getMatchStake(match.id);
        const matchVotes = getMatchVotes(votes, key, match.messageId) || {};

        const playerVotes = {};
        for (const userId of Object.keys(players)) {
          const userVote = matchVotes[userId]?.vote ?? null;
          if (userVote === null) continue;
          playerVotes[userId] = userVote;
        }

        const allCorrect = Object.values(playerVotes).every((v) => v === winner);
        const allWrong = Object.values(playerVotes).every((v) => v !== winner);
        if (allCorrect || allWrong) continue;

        for (const [userId, userVote] of Object.entries(playerVotes)) {
          const multiplier = WAGER_MULTIPLIERS[wagers?.[userId]?.[match.id]?.type] || 1;
          const stake = baseStake * multiplier;
          scores[userId] += userVote === winner ? stake : -stake;
        }
      }

      const ranked = Object.entries(scores)
        .map(([id, pts]) => ({ id, pts }))
        .sort((a, b) => b.pts - a.pts);

      if (ranked.length === 0 || ranked[0].pts <= 0) continue;

      const mvp = ranked[0];
      const channelId = config?.channelId || process.env.FOOTBALL_CHANNEL_ID;
      const channel = await client.channels.fetch(channelId);
      const users = client.cachedUsers;
      const nickname = users[mvp.id]?.nickname || 'Unknown';

      const embed = new EmbedBuilder()
        .setTitle('⭐  MVP hôm nay')
        .setDescription(
          `**${nickname}** cân hết ${dayMatches.length} trận hôm nay ` +
          `với **+${mvp.pts}** điểm!`,
        )
        .setColor(0xFFD700)
        .setTimestamp();

      if (users[mvp.id]?.avatarURL) {
        embed.setThumbnail(users[mvp.id].avatarURL);
      }

      await channel.send({ embeds: [embed] });

      const rivalryEmbed = checkRivalry(allMatches, votes, players, users);
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

function checkRivalry(allMatches, votes, players, users) {
  try {
    const completed = allMatches.filter((m) => m.hasResult && m.isCalculated);
    if (completed.length < 5) return null;

    const playerIds = Object.keys(players);
    if (playerIds.length < 2) return null;

    const disagreements = {};

    for (const match of completed) {
      const key = `${match.id - 1}`;
      const mv = getMatchVotes(votes, key, match.messageId);
      if (!mv) continue;

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
      'Cái gì cũng chọn ngược nhau. Sinh ra để ghét nhau.',
      'Một thằng nói trái, thằng kia nói phải. Kinh điển.',
      'Kình địch là THẬT luôn. 🍿',
      'Ai kiếm cái võ đài cho hai đứa này đi.',
      'Hỏi hôm nay thứ mấy chắc cũng cãi nhau.',
      'Chắc kiếp trước là Tom & Jerry.',
      'Một người chọn trắng, người kia chọn đen. Mọi trận.',
      'Nếu có giải "bất đồng quan điểm" thì hai đứa này vô địch.',
      'Không cần xem trận, chỉ cần xem hai đứa này chọn gì là đủ drama.',
      'Đặt cạnh nhau là có chuyện. Như nam châm cùng cực.',
    ];

    return new EmbedBuilder()
      .setTitle('⚔️  Kình địch phát hiện')
      .setDescription(
        `**${nameA}** và **${nameB}** bất đồng **${topPair.count}** trong **${topPair.total}** trận (**${pct}%**)!\n\n` +
        RIVAL_LINES[Math.floor(Math.random() * RIVAL_LINES.length)],
      )
      .setColor(0x9B59B6)
      .setTimestamp();
  } catch (err) {
    logger.error('Failed to check rivalry:', err);
    return null;
  }
}

const calculationLock = new Set();

export async function calculateMatches(matches, client) {
  const toProcess = matches.filter((m) => !calculationLock.has(m.id));
  if (toProcess.length === 0) {
    logger.info('All matches already being calculated, skipping');
    return;
  }
  for (const m of toProcess) calculationLock.add(m.id);

  try {
    const [votingObj, playersSnap, wagers, curses] = await Promise.all([
      readAllVotes(),
      readPlayers(),
      readPlayerWagers(),
      readCurses(),
    ]);
    const players = playersSnap.val();
    if (!players) {
      logger.warn('No players registered, skipping calculation');
      return;
    }

    const calculatedIds = [];
    const matchDeltas = {};

    for (const match of toProcess) {
      if (!match.messageId) {
        logger.warn(`Skipped match ${match.id} due to empty message ID, consider to update manually.`);
        continue;
      }

      const key = `${match.id - 1}`;
      const votes = getMatchVotes(votingObj, key, match.messageId);

      if (!votes) {
        logger.warn(`Match ${match.id} has no votes — all picks will be randomized`);
      }

      const { votedPlayers, randomPicks, deltas } = calculatePlayerPoints(players, votes, match, wagers);
      resolveCurses(players, curses, match, votingObj, votedPlayers, randomPicks, deltas);

      matchDeltas[match.id] = deltas;

      await updatePlayers(players);
      await updateMatch(match.id - 1, { isCalculated: true });
      calculatedIds.push(match.id - 1);
      logger.info(`Calculated and persisted match ${match.id} successfully`);
    }

    if (calculatedIds.length > 0) {
      logger.info(`Calculated ${calculatedIds.length} match(es) total`);

      const allMatches = (await readTournamentData('matches')).val() || [];
      const completedMatches = allMatches
        .filter((m) => m.hasResult && (m.isCalculated || calculatedIds.includes(m.id - 1)))
        .sort((a, b) => Date.parse(a.date) - Date.parse(b.date));

      const existingBadges = await readAllBadges();
      const newBadges = await checkAndAwardBadges({
        players,
        completedMatches,
        votes: votingObj,
        wagers,
        existingBadges,
      });

      if (client && Object.keys(newBadges).length > 0) {
        await announceBadges(client, newBadges);
      }
    }

    return matchDeltas;
  } finally {
    for (const m of toProcess) calculationLock.delete(m.id);
  }
}

async function announceBadges(client, newBadges) {
  try {
    const config = await readTournamentConfig();
    const channelId = config?.channelId || process.env.FOOTBALL_CHANNEL_ID;
    const channel = await client.channels.fetch(channelId);
    const users = client.cachedUsers;

    const lines = [];
    for (const [userId, badges] of Object.entries(newBadges)) {
      const name = users[userId]?.nickname || 'Unknown';
      for (const badge of badges) {
        lines.push(`${badge.icon} **${name}** mở khoá **${badge.name}**! — *${badge.desc}*`);
      }
    }

    if (lines.length === 0) return;

    const embed = new EmbedBuilder()
      .setTitle('🏅  Achievement mới!')
      .setDescription(lines.join('\n'))
      .setColor(0xFFD700)
      .setTimestamp();

    await channel.send({ embeds: [embed] });
  } catch (err) {
    logger.error('Failed to announce badges:', err);
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
  const stakeNote = stake > 10 ? `\n💰 **Cược:** ${stake} điểm (vòng knockout nên mức cược cao!)` : '';

  const embed = new EmbedBuilder()
    .setTitle(`⚽  ${match.home.toUpperCase()}  vs  ${match.away.toUpperCase()}`)
    .setDescription(
      `**${tournamentName}** — Match #${match.id}\n\n` +
      `🕐 **Kickoff:** ${timeStr} *(VN)* — <t:${timestamp}:R>\n` +
      `🏟️ **Venue:** ${match.location}` +
      stakeNote,
    )
    .setColor(0x5865F2)
    .setFooter({ text: 'Bấm bên dưới để vote trước giờ đá!' })
    .setTimestamp(kickoff);

  const row = new ActionRowBuilder()
    .addComponents(home, draw, away);

  return {
    embeds: [embed],
    components: [row],
  };
}


function getLeastVotedOutcome(outcomes, picks) {
  const counts = {};
  for (const o of outcomes) counts[o] = 0;
  for (const vote of Object.values(picks)) {
    if (vote in counts) counts[vote]++;
  }
  const minCount = Math.min(...Object.values(counts));
  const leastVoted = outcomes.filter((o) => counts[o] === minCount);
  return leastVoted[Math.floor(Math.random() * leastVoted.length)];
}

function calculatePlayerPoints(players, votes, match, wagers) {
  const winner = getWinner(match);
  if (!winner) {
    logger.warn(`Match ${match.id} has no result, skipping point calculation`);
    return { votedPlayers: [], randomPicks: {}, deltas: {} };
  }
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

  const unvoted = Object.keys(players).filter((k) => !votedPlayers.includes(k));
  if (unvoted.length > 0) {
    const leastPicked = getLeastVotedOutcome(outcomes, picks);
    for (const k of unvoted) {
      const usesRandom = wagers?.[k]?.[match.id]?.type === 'random';
      const pick = usesRandom
        ? outcomes[Math.floor(Math.random() * outcomes.length)]
        : leastPicked;
      picks[k] = pick;
      randomPicks[k] = pick;
    }
  }

  const WAGER_MULTIPLIERS = { 'double-down': 2 };
  const playerStakes = {};
  for (const k of Object.keys(picks)) {
    const wagerType = wagers?.[k]?.[match.id]?.type;
    const multiplier = WAGER_MULTIPLIERS[wagerType] || 1;
    playerStakes[k] = baseStake * multiplier;
  }

  const winnerEntries = Object.entries(picks).filter(([, pick]) => pick === winner);
  const loserEntries = Object.entries(picks).filter(([, pick]) => pick !== winner);

  const allWin = loserEntries.length === 0;
  const allLose = winnerEntries.length === 0;

  const totalLoserStake = loserEntries.reduce((sum, [k]) => sum + playerStakes[k], 0);
  const totalWinnerStake = winnerEntries.reduce((sum, [k]) => sum + playerStakes[k], 0);

  const deltas = {};
  for (const [k, pick] of Object.entries(picks)) {
    const isWinner = pick === winner;
    let delta;
    if (allWin || allLose) {
      delta = 0;
    } else if (isWinner) {
      delta = totalWinnerStake > 0
        ? (playerStakes[k] / totalWinnerStake) * totalLoserStake
        : 0;
    } else {
      delta = -playerStakes[k];
    }

    deltas[k] = { delta, pick, isWinner, stake: playerStakes[k], random: k in randomPicks };

    const newPoints = players[k].points + delta;
    players[k] = {
      ...players[k],
      matches: players[k].matches + 1,
      points: newPoints,
      ...(newPoints < 0 && { hadNegativeBalance: true }),
    };
  }

  return { votedPlayers, randomPicks, deltas };
}

const MAX_GROUP_STAGE_ID = 72;

export async function updateGroupStandings(match) {
  if (match.id > MAX_GROUP_STAGE_ID) return;
  if (!match.hasResult || match.result == null) return;
  if (match.groupUpdated) return;

  const groups = (await readTournamentData('groups')).val();
  if (!groups) return;

  let groupKey = null;
  for (const [key, teams] of Object.entries(groups)) {
    if (match.home in teams && match.away in teams) {
      groupKey = key;
      break;
    }
  }

  if (!groupKey) {
    logger.warn(`Could not find group for match ${match.id}: ${match.home} vs ${match.away}`);
    return;
  }

  const homeGoals = match.result.home;
  const awayGoals = match.result.away;
  const homeTeam = groups[groupKey][match.home];
  const awayTeam = groups[groupKey][match.away];

  const homeWon = homeGoals > awayGoals ? 1 : 0;
  const awayWon = awayGoals > homeGoals ? 1 : 0;
  const drawn = homeGoals === awayGoals ? 1 : 0;

  const updatedHome = {
    played: homeTeam.played + 1,
    won: homeTeam.won + homeWon,
    drawn: homeTeam.drawn + drawn,
    lost: homeTeam.lost + awayWon,
    for: homeTeam.for + homeGoals,
    against: homeTeam.against + awayGoals,
    goalDifference: homeTeam.goalDifference + homeGoals - awayGoals,
    points: homeTeam.points + (homeWon ? 3 : drawn ? 1 : 0),
  };

  const updatedAway = {
    played: awayTeam.played + 1,
    won: awayTeam.won + awayWon,
    drawn: awayTeam.drawn + drawn,
    lost: awayTeam.lost + homeWon,
    for: awayTeam.for + awayGoals,
    against: awayTeam.against + homeGoals,
    goalDifference: awayTeam.goalDifference + awayGoals - homeGoals,
    points: awayTeam.points + (awayWon ? 3 : drawn ? 1 : 0),
  };

  await updateGroupTeam(groupKey, match.home, updatedHome);
  await updateGroupTeam(groupKey, match.away, updatedAway);
  await updateMatch(match.id - 1, { groupUpdated: true });
  logger.info(`Updated group ${groupKey.toUpperCase()} standings for match ${match.id}`);
}

function resolveCurses(players, curses, match, votingObj, votedPlayers, randomPicks, deltas) {
  const matchCurses = curses[match.id];
  if (!matchCurses) return;

  const winner = getWinner(match);
  if (!winner) return;
  const key = `${match.id - 1}`;

  for (const [curserId, { target }] of Object.entries(matchCurses)) {
    if (!(curserId in players) || !(target in players)) continue;

    const matchVotes = getMatchVotes(votingObj, key, match.messageId);
    let targetVote = matchVotes?.[target]?.vote ?? null;
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

    if (deltas[curserId]) deltas[curserId].delta += targetCorrect ? -CURSE_PTS : CURSE_PTS;
    if (deltas[target]) deltas[target].delta += targetCorrect ? CURSE_PTS : -CURSE_PTS;

    logger.info(`Curse resolved: ${curserId} ${targetCorrect ? 'lost' : 'gained'} ${CURSE_PTS} pts (target: ${target}, match: ${match.id})`);
  }
}
