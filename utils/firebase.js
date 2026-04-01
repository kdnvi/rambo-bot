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

export async function updateMatch(match, content) {
  try {
    const ref = db.ref(`tournament/matches/${match.id - 1}`);
    await ref.update(content);
    logger.info(`Updated match ID [${match.id}] between ${match.home} and ${match.away}`);
  } catch (err) {
    logger.error(err);
  }
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

export async function registerPlayer(userId) {
  try {
    const ref = db.ref(`tournament/players/${userId}`);
    const snapshot = await ref.once('value');
    if (snapshot.val() !== null) {
      return 'You are already registered';
    } else {
      await ref.set({
        points: 0,
        matches: 0,
      });
      logger.info(`User [${userId}] successfully set`);
      return 'Registered successfully';
    }
  } catch (err) {
    logger.error(err);
  }

  return 'Something wrong happened!';
}

export async function updatePlayers(content) {
  try {
    const ref = db.ref('tournament/players');
    await ref.update(content);
    logger.info(`Updated players with content ${content}`);
  } catch (err) {
    logger.error(err);
  }
}

export async function updateMatchResult(matchId, homeScore, awayScore) {
  try {
    const ref = db.ref(`tournament/matches/${matchId}`);
    const snapshot = await ref.once('value');
    if (snapshot.val() === null) {
      return `Match \`${matchId}\` does not exist!`;
    } else {
      const match = snapshot.val();
      if (match.hasResult) {
        return `Match \`${matchId}\` result exist!`;
      }

      await ref.update({
        hasResult: true,
        result: {
          home: homeScore,
          away: awayScore,
        }
      });

      logger.info(`Updated match ID [${matchId}] with result ${homeScore} - ${awayScore}`);
      return 'Match result is updated successfully';
    }
  } catch (err) {
    logger.error(err);
  }

  return 'Something wrong happened!';
}

export async function readPlayers() {
  const ref = db.ref('tournament/players');
  return ref.orderByChild('points').once('value');
}
