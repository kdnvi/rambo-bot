import { getWinner } from './helper.js';
import { awardBadge } from './firebase.js';
import logger from './logger.js';

export const BADGE_DEFS = [
  { id: 'first_blood', icon: '🩸', name: 'First Blood', desc: 'Won your very first prediction' },
  { id: 'oracle', icon: '🔮', name: 'Oracle', desc: '5 correct predictions in a row' },
  { id: 'on_fire', icon: '🔥', name: 'On Fire', desc: '3 correct predictions in a row' },
  { id: 'underdog', icon: '🐺', name: 'Underdog Hunter', desc: 'Correctly predicted 3 minority picks' },
  { id: 'bankrupt', icon: '💀', name: 'Bankrupt', desc: 'Went below zero balance' },
  { id: 'comeback', icon: '🦅', name: 'Comeback King', desc: 'Recovered to positive after going negative' },
  { id: 'perfect_day', icon: '💎', name: 'Perfect Day', desc: 'Got every prediction right on a matchday' },
  { id: 'yolo', icon: '🎰', name: 'YOLO', desc: 'Used all-in' },
  { id: 'double_trouble', icon: '⏫', name: 'Double Trouble', desc: 'Used double-down 5 times' },
  { id: 'streak_breaker', icon: '💔', name: 'Streak Breaker', desc: 'Lost after a 3+ win streak' },
];

const BADGE_MAP = Object.fromEntries(BADGE_DEFS.map((b) => [b.id, b]));

/**
 * Check and award new badges for all players after match calculation.
 * Returns a map of userId -> array of newly earned badge defs.
 */
export async function checkAndAwardBadges({ players, completedMatches, votes, wagers, allIns, existingBadges }) {
  const newBadges = {};

  for (const userId of Object.keys(players)) {
    const playerBadges = existingBadges[userId] || {};
    const has = (id) => id in playerBadges;

    const results = [];
    const matchDays = {};

    for (const match of completedMatches) {
      const key = `${match.id - 1}`;
      const winner = getWinner(match);
      let userVote = getUserVote(votes, key, match.messageId, userId);
      if (userVote === null) continue;

      const isCorrect = userVote === winner;
      results.push({ matchId: match.id, isCorrect, date: match.date });

      if (isCorrect && isMinorityPick(votes, key, match.messageId, userVote)) {
        results[results.length - 1].minorityWin = true;
      }

      const day = match.date.slice(0, 10);
      if (!matchDays[day]) matchDays[day] = [];
      matchDays[day].push(isCorrect);
    }

    const earned = [];

    if (!has('first_blood') && results.some((r) => r.isCorrect)) {
      earned.push('first_blood');
    }

    const maxWinStreak = longestStreak(results, true);
    if (!has('oracle') && maxWinStreak >= 5) earned.push('oracle');
    if (!has('on_fire') && maxWinStreak >= 3) earned.push('on_fire');

    if (!has('streak_breaker') && hasStreakThenLoss(results, 3)) {
      earned.push('streak_breaker');
    }

    const minorityWins = results.filter((r) => r.minorityWin).length;
    if (!has('underdog') && minorityWins >= 3) earned.push('underdog');

    if (!has('bankrupt') && players[userId].points < 0) {
      earned.push('bankrupt');
    }

    if (!has('comeback') && players[userId].hadNegativeBalance && players[userId].points > 0) {
      earned.push('comeback');
    }

    if (!has('perfect_day')) {
      for (const dayResults of Object.values(matchDays)) {
        if (dayResults.length >= 2 && dayResults.every(Boolean)) {
          earned.push('perfect_day');
          break;
        }
      }
    }

    const userAllIns = allIns?.[userId] || {};
    if (!has('yolo') && Object.keys(userAllIns).length > 0) {
      earned.push('yolo');
    }

    const userWagers = wagers?.[userId] || {};
    const ddCount = Object.values(userWagers).filter((w) => w.type === 'double-down').length;
    if (!has('double_trouble') && ddCount >= 5) {
      earned.push('double_trouble');
    }

    if (earned.length > 0) {
      newBadges[userId] = [];
      for (const badgeId of earned) {
        const matchId = completedMatches[completedMatches.length - 1]?.id;
        const awarded = await awardBadge(userId, badgeId, { matchId });
        if (awarded) {
          newBadges[userId].push(BADGE_MAP[badgeId]);
          logger.info(`New badge [${badgeId}] for user [${userId}]`);
        }
      }
      if (newBadges[userId].length === 0) delete newBadges[userId];
    }
  }

  return newBadges;
}

export function formatBadges(storedBadges) {
  if (!storedBadges || Object.keys(storedBadges).length === 0) return '';
  return Object.keys(storedBadges)
    .filter((id) => id in BADGE_MAP)
    .map((id) => BADGE_MAP[id].icon)
    .join(' ');
}

export function formatBadgesDetailed(storedBadges) {
  if (!storedBadges || Object.keys(storedBadges).length === 0) return '*No badges yet*';
  return Object.keys(storedBadges)
    .filter((id) => id in BADGE_MAP)
    .map((id) => `${BADGE_MAP[id].icon} **${BADGE_MAP[id].name}** — ${BADGE_MAP[id].desc}`)
    .join('\n');
}

function getUserVote(votes, key, messageId, userId) {
  if (!votes || !(key in votes) || !messageId || !(messageId in votes[key])) return null;
  const mv = votes[key][messageId];
  return (userId in mv) ? mv[userId].vote : null;
}

function isMinorityPick(votes, key, messageId, userVote) {
  if (!votes || !(key in votes) || !(messageId in votes[key])) return false;
  const matchVotes = votes[key][messageId];
  const allVotes = Object.values(matchVotes).map((v) => v.vote);
  const count = allVotes.filter((v) => v === userVote).length;
  return count < allVotes.length / 2;
}

function longestStreak(results, correctValue) {
  let max = 0;
  let current = 0;
  for (const r of results) {
    if (r.isCorrect === correctValue) {
      current++;
      if (current > max) max = current;
    } else {
      current = 0;
    }
  }
  return max;
}

function hasStreakThenLoss(results, minStreak) {
  let streak = 0;
  for (const r of results) {
    if (r.isCorrect) {
      streak++;
    } else {
      if (streak >= minStreak) return true;
      streak = 0;
    }
  }
  return false;
}
