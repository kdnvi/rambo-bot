import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import logger from './logger.js';
import { readFile } from 'fs/promises';

initializeApp({
  credential: applicationDefault(),
  databaseURL: process.env.FIREBASE_DB_URL,
});
const db = getDatabase();

// ONLY RUN WHEN INIT DB
export async function resetEuroData() {
  try {
    const euroData = JSON.parse(
      await readFile(
        new URL('../data/euro2024.json', import.meta.url)
      )
    );

    const ref = db.ref();
    const usersRef = ref.child('euro');

    usersRef.set(euroData);
    ref.once('value', () => {
      logger.info('Successfully create or update Euro data');
    });
  } catch (err) {
    logger.error(err);
  }
}


export async function readOnceEuroInfoByPath(path) {
  return db.ref(`euro/${path}`).once('value');
}

export async function updateEuroMatch(match, content) {
  try {
    const ref = db.ref(`euro/matches/${match.id - 1}`);
    await ref.update(content);
    logger.info(`Updated match ID [${match.id}] between ${match.home} and ${match.away}`);
  } catch (err) {
    logger.error(err);
  }
}

export async function updateEuroMatchVote(matchId, userId, vote, messageId) {
  try {
    const ref = db.ref(`euro/votes/${matchId - 1}/${messageId}/${userId}`);
    await ref.update({ vote: vote });
    logger.info(`Updated votes match ID [${matchId}] with message ID [${messageId}] of user ${userId}`);
  } catch (err) {
    logger.error(err);
  }
}

export async function readOnceEuroMatchVotes(matchId, messageId) {
  const ref = db.ref(`euro/votes/${matchId - 1}/${messageId}`);
  return ref.once('value');
}

export async function updatePlayerInfo(userId) {
  try {
    const ref = db.ref(`euro/players/${userId}`);
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

export async function updatePlayerPoints(content) {
  try {
    const ref = db.ref('euro/players');
    await ref.update(content);
    logger.info(`Updated players with content ${content}`);
  } catch (err) {
    logger.error(err);
  }
}

export async function updateEuroMatchResult(matchId, homeScore, awayScore) {
  try {
    const ref = db.ref(`euro/matches/${matchId}`);
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

export async function readOnceEuroPlayer() {
  const ref = db.ref(`euro/players`);
  return ref.orderByChild('points').once('value');
}
