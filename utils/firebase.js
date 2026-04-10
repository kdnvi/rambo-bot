import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import { getCached, getSubkey, setCached, bustPrefix, getGeneration } from './cache.js';
import logger from './logger.js';

initializeApp({
  credential: applicationDefault(),
  databaseURL: process.env.FIREBASE_DB_URL,
});
const db = getDatabase();

async function cachedRead(cacheKey, refPath) {
  const hit = getCached(cacheKey);
  if (hit !== undefined) return hit;
  const gen = getGeneration(cacheKey);
  const snapshot = await db.ref(refPath).once('value');
  const val = snapshot.val();
  setCached(cacheKey, val, gen);
  return val;
}

export async function readTournamentConfig() {
  return cachedRead('config', 'tournament/config');
}

export async function readTournamentData(path) {
  return cachedRead(path, `tournament/${path}`);
}

export async function updateMatch(matchIndex, content) {
  const ref = db.ref(`tournament/matches/${matchIndex}`);
  await ref.update(content);
  bustPrefix('matches');
  logger.info(`Updated match index [${matchIndex}]: ${Object.keys(content).join(', ')}`);
}

export async function updateMatchResult(matchIndex, homeScore, awayScore) {
  try {
    const ref = db.ref(`tournament/matches/${matchIndex}`);
    const snapshot = await ref.once('value');
    if (snapshot.val() === null) {
      return { success: false, error: 'not_found' };
    }

    const match = snapshot.val();
    if (match.hasResult) {
      return { success: false, error: 'already_exists', match };
    }

    await ref.update({
      hasResult: true,
      isCalculated: false,
      result: {
        home: homeScore,
        away: awayScore,
      },
    });

    bustPrefix('matches');
    logger.info(`Updated match index [${matchIndex}] with result ${homeScore} - ${awayScore}`);
    return { success: true, match };
  } catch (err) {
    logger.error(err);
    throw err;
  }
}

export async function readPlayers() {
  return cachedRead('players', 'tournament/players');
}

export async function registerPlayer(userId) {
  try {
    const ref = db.ref(`tournament/players/${userId}`);
    const snapshot = await ref.once('value');
    if (snapshot.val() !== null) {
      return { success: false, message: 'Đăng ký rồi mà, vô lại làm gì nữa.' };
    } else {
      await ref.set({
        points: 0,
        matches: 0,
      });
      bustPrefix('players');
      logger.info(`User [${userId}] successfully set`);
      return { success: true, message: 'Registered successfully.' };
    }
  } catch (err) {
    logger.error(err);
    throw err;
  }
}

export async function updatePlayers(content) {
  const ref = db.ref('tournament/players');
  await ref.update(content);
  bustPrefix('players');
  logger.info(`Updated ${Object.keys(content).length} player(s)`);
}

export async function readAllVotes() {
  return cachedRead('votes', 'tournament/votes');
}

export async function updateMatchVote(matchId, userId, vote, messageId) {
  const ref = db.ref(`tournament/votes/${matchId - 1}/${messageId}/${userId}`);
  await ref.update({ vote: vote });
  bustPrefix('votes');
  logger.info(`Updated votes match ID [${matchId}] with message ID [${messageId}] of user ${userId}`);
}

export async function removeMatchVote(matchId, userId, messageId) {
  const ref = db.ref(`tournament/votes/${matchId - 1}/${messageId}/${userId}`);
  await ref.remove();
  bustPrefix('votes');
  logger.info(`Removed vote for match ID [${matchId}] message ID [${messageId}] of user ${userId}`);
}

export async function readMatchVotes(matchId, messageId) {
  const cacheKey = `votes/${matchId}/${messageId}`;
  const hit = getCached(cacheKey);
  if (hit !== undefined) return hit;
  const parentHit = getSubkey('votes', `${matchId - 1}/${messageId}`);
  if (parentHit !== undefined && parentHit !== null) {
    setCached(cacheKey, parentHit);
    return parentHit;
  }
  const gen = getGeneration(cacheKey);
  const ref = db.ref(`tournament/votes/${matchId - 1}/${messageId}`);
  const snapshot = await ref.once('value');
  const val = snapshot.val();
  setCached(cacheKey, val, gen);
  return val;
}

export async function readPlayerWagers() {
  return (await cachedRead('wagers', 'tournament/wagers')) || {};
}

export async function readUserWagers(userId) {
  const cacheKey = `wagers/${userId}`;
  const hit = getCached(cacheKey);
  if (hit !== undefined) return hit || {};
  const parentHit = getSubkey('wagers', userId);
  if (parentHit !== undefined && parentHit !== null) {
    setCached(cacheKey, parentHit);
    return parentHit;
  }
  const gen = getGeneration(cacheKey);
  const snapshot = await db.ref(`tournament/wagers/${userId}`).once('value');
  const val = snapshot.val();
  setCached(cacheKey, val, gen);
  return val || {};
}

export async function setPlayerWager(userId, matchId, flag) {
  const ref = db.ref(`tournament/wagers/${userId}/${matchId}/${flag}`);
  await ref.set(true);
  bustPrefix('wagers');
  logger.info(`Set ${flag} wager for user [${userId}] on match [${matchId}]`);
}

export async function readCurses() {
  return (await cachedRead('curses', 'tournament/curses')) || {};
}

export async function setCurse(curserId, targetId, matchId) {
  const ref = db.ref(`tournament/curses/${matchId}/${curserId}`);
  await ref.set({ target: targetId });
  bustPrefix('curses');
  logger.info(`Curse set: [${curserId}] cursed [${targetId}] on match [${matchId}]`);
}

export async function removeCurse(curserId, matchId) {
  const ref = db.ref(`tournament/curses/${matchId}/${curserId}`);
  await ref.remove();
  bustPrefix('curses');
  logger.info(`Curse removed: [${curserId}] on match [${matchId}]`);
}

export async function removePlayerWager(userId, matchId, flag) {
  const ref = flag
    ? db.ref(`tournament/wagers/${userId}/${matchId}/${flag}`)
    : db.ref(`tournament/wagers/${userId}/${matchId}`);
  await ref.remove();
  bustPrefix('wagers');
  logger.info(`Removed ${flag || 'all'} wager(s) for user [${userId}] on match [${matchId}]`);
}

export async function readPlayerBadges(userId) {
  const cacheKey = `badges/${userId}`;
  const hit = getCached(cacheKey);
  if (hit !== undefined) return hit || {};
  const parentHit = getSubkey('badges', userId);
  if (parentHit !== undefined && parentHit !== null) {
    setCached(cacheKey, parentHit);
    return parentHit;
  }
  const gen = getGeneration(cacheKey);
  const snapshot = await db.ref(`tournament/badges/${userId}`).once('value');
  const val = snapshot.val();
  setCached(cacheKey, val, gen);
  return val || {};
}

export async function readAllBadges() {
  return (await cachedRead('badges', 'tournament/badges')) || {};
}

export async function awardBadge(userId, badgeId, meta = {}) {
  const ref = db.ref(`tournament/badges/${userId}/${badgeId}`);
  const existing = (await ref.once('value')).val();
  if (existing) return false;
  await ref.set({ earnedAt: Date.now(), ...meta });
  bustPrefix('badges');
  logger.info(`Badge awarded: [${badgeId}] to user [${userId}]`);
  return true;
}

export async function updateGroupTeam(groupKey, teamName, stats) {
  const ref = db.ref(`tournament/groups/${groupKey}/${teamName}`);
  await ref.update(stats);
  bustPrefix('groups');
  logger.info(`Updated group ${groupKey.toUpperCase()} team [${teamName}]: P${stats.played} W${stats.won} D${stats.drawn} L${stats.lost} GD${stats.goalDifference} Pts${stats.points}`);
}

export async function saveMatchRandomPicks(matchIndex, randomPicks) {
  if (!randomPicks || Object.keys(randomPicks).length === 0) return;
  const ref = db.ref(`tournament/matches/${matchIndex}/randomPicks`);
  await ref.set(randomPicks);
}

export async function incrementVoteChange(matchId, userId) {
  const ref = db.ref(`tournament/voteChanges/${matchId}/${userId}`);
  const result = await ref.transaction((current) => (current || 0) + 1);
  return result.snapshot.val();
}

export async function readFlavor() {
  return (await cachedRead('flavor', 'flavor')) || {};
}
