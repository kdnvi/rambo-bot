import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import logger from './logger.js';

initializeApp({
  credential: applicationDefault(),
  databaseURL: process.env.FIREBASE_DB_URL,
});
const db = getDatabase();

export async function readTournamentConfig() {
  const ref = db.ref('tournament/config');
  return (await ref.once('value')).val();
}

export async function readTournamentData(path) {
  return db.ref(`tournament/${path}`).once('value');
}

export async function updateMatch(matchIndex, content) {
  const ref = db.ref(`tournament/matches/${matchIndex}`);
  await ref.update(content);
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
      }
    });

    logger.info(`Updated match index [${matchIndex}] with result ${homeScore} - ${awayScore}`);
    return { success: true, match };
  } catch (err) {
    logger.error(err);
    throw err;
  }
}

export async function readPlayers() {
  const ref = db.ref('tournament/players');
  return ref.once('value');
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
  logger.info(`Updated ${Object.keys(content).length} player(s)`);
}

export async function readAllVotes() {
  const ref = db.ref('tournament/votes');
  return (await ref.once('value')).val();
}

export async function updateMatchVote(matchId, userId, vote, messageId) {
  const ref = db.ref(`tournament/votes/${matchId - 1}/${messageId}/${userId}`);
  await ref.update({ vote: vote });
  logger.info(`Updated votes match ID [${matchId}] with message ID [${messageId}] of user ${userId}`);
}

export async function readMatchVotes(matchId, messageId) {
  const ref = db.ref(`tournament/votes/${matchId - 1}/${messageId}`);
  return ref.once('value');
}

export async function readPlayerWagers() {
  const ref = db.ref('tournament/wagers');
  return (await ref.once('value')).val() || {};
}

export async function readUserWagers(userId) {
  const ref = db.ref(`tournament/wagers/${userId}`);
  return (await ref.once('value')).val() || {};
}

export async function setPlayerWager(userId, matchId, type) {
  const ref = db.ref(`tournament/wagers/${userId}/${matchId}`);
  await ref.set({ type });
  logger.info(`Set ${type} wager for user [${userId}] on match [${matchId}]`);
}

export async function readPlayerAllIns(userId) {
  const ref = db.ref(`tournament/allins/${userId}`);
  return (await ref.once('value')).val() || {};
}

export async function readAllAllIns() {
  const ref = db.ref('tournament/allins');
  return (await ref.once('value')).val() || {};
}

export async function setPlayerAllIn(userId, matchId, amount) {
  const ref = db.ref(`tournament/allins/${userId}/${matchId}`);
  await ref.set({ amount });
  logger.info(`Set all-in for user [${userId}] on match [${matchId}] with amount [${amount}]`);
}

export async function readCurses() {
  const ref = db.ref('tournament/curses');
  return (await ref.once('value')).val() || {};
}

export async function setCurse(curserId, targetId, matchId) {
  const ref = db.ref(`tournament/curses/${matchId}/${curserId}`);
  await ref.set({ target: targetId });
  logger.info(`Curse set: [${curserId}] cursed [${targetId}] on match [${matchId}]`);
}

export async function removeCurse(curserId, matchId) {
  const ref = db.ref(`tournament/curses/${matchId}/${curserId}`);
  await ref.remove();
  logger.info(`Curse removed: [${curserId}] on match [${matchId}]`);
}

export async function removePlayerWager(userId, matchId) {
  const ref = db.ref(`tournament/wagers/${userId}/${matchId}`);
  await ref.remove();
  logger.info(`Removed wager for user [${userId}] on match [${matchId}]`);
}

export async function removePlayerAllIn(userId, matchId) {
  const ref = db.ref(`tournament/allins/${userId}/${matchId}`);
  await ref.remove();
  logger.info(`Removed all-in for user [${userId}] on match [${matchId}]`);
}

export async function readPlayerBadges(userId) {
  const ref = db.ref(`tournament/badges/${userId}`);
  return (await ref.once('value')).val() || {};
}

export async function readAllBadges() {
  const ref = db.ref('tournament/badges');
  return (await ref.once('value')).val() || {};
}

export async function awardBadge(userId, badgeId, meta = {}) {
  const ref = db.ref(`tournament/badges/${userId}/${badgeId}`);
  const existing = (await ref.once('value')).val();
  if (existing) return false;
  await ref.set({ earnedAt: Date.now(), ...meta });
  logger.info(`Badge awarded: [${badgeId}] to user [${userId}]`);
  return true;
}

export async function incrementVoteChange(matchId, userId) {
  const ref = db.ref(`tournament/voteChanges/${matchId}/${userId}`);
  const result = await ref.transaction((current) => (current || 0) + 1);
  return result.snapshot.val();
}
