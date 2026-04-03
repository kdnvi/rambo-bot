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
  try {
    const ref = db.ref(`tournament/matches/${matchIndex}`);
    await ref.update(content);
    logger.info(`Updated match index [${matchIndex}]: ${Object.keys(content).join(', ')}`);
  } catch (err) {
    logger.error(err);
  }
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
  return ref.orderByChild('points').once('value');
}

export async function registerPlayer(userId) {
  try {
    const ref = db.ref(`tournament/players/${userId}`);
    const snapshot = await ref.once('value');
    if (snapshot.val() !== null) {
      return { success: false, message: 'You are already registered for this tournament.' };
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
  try {
    const ref = db.ref('tournament/players');
    await ref.update(content);
    logger.info(`Updated ${Object.keys(content).length} player(s)`);
  } catch (err) {
    logger.error(err);
  }
}

export async function readAllVotes() {
  const ref = db.ref('tournament/votes');
  return (await ref.once('value')).val();
}

export async function updateMatchVote(matchId, userId, vote, messageId) {
  try {
    const ref = db.ref(`tournament/votes/${matchId - 1}/${messageId}/${userId}`);
    await ref.update({ vote: vote });
    logger.info(`Updated votes match ID [${matchId}] with message ID [${messageId}] of user ${userId}`);
  } catch (err) {
    logger.error(err);
  }
}

export async function readMatchVotes(matchId, messageId) {
  const ref = db.ref(`tournament/votes/${matchId - 1}/${messageId}`);
  return ref.once('value');
}
