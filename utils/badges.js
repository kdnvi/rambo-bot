const BADGE_DEFS = [
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

/**
 * @param {Object} params
 * @param {string} params.userId
 * @param {Array} params.completedMatches - matches with hasResult && isCalculated, sorted by date
 * @param {Object} params.votes - full votes object from Firebase
 * @param {Object} params.playerData - { points, matches }
 * @param {Object} params.wagers - user's wagers object
 * @param {Object|null} params.allIn - user's all-in data
 * @returns {Array<{ icon: string, name: string }>}
 */
export function computeBadges({ userId, completedMatches, votes, playerData, wagers, allIn }) {
  const earned = [];
  const results = [];
  let runningBalance = 0;
  let wentNegative = false;
  let recoveredFromNegative = false;
  const matchDays = {};

  for (const match of completedMatches) {
    const key = `${match.id - 1}`;
    const winner = getWinner(match);
    let userVote = null;

    if (votes && key in votes && match.messageId && match.messageId in votes[key]) {
      const matchVotes = votes[key][match.messageId];
      if (userId in matchVotes) {
        userVote = matchVotes[userId].vote;
      }
    }

    if (userVote === null) continue;

    const isCorrect = userVote === winner;
    results.push({ matchId: match.id, isCorrect, date: match.date });

    const isMinority = checkMinority(votes, key, match.messageId, userVote);
    if (isCorrect && isMinority) {
      results[results.length - 1].minorityWin = true;
    }

    const day = match.date.slice(0, 10);
    if (!matchDays[day]) matchDays[day] = [];
    matchDays[day].push(isCorrect);

    runningBalance += isCorrect ? 10 : -10;
    if (runningBalance < 0) wentNegative = true;
    if (wentNegative && runningBalance > 0) recoveredFromNegative = true;
  }

  if (results.length > 0 && results.some((r) => r.isCorrect)) {
    earned.push('first_blood');
  }

  const maxStreak = longestStreak(results, true);
  if (maxStreak >= 5) earned.push('oracle');
  else if (maxStreak >= 3) earned.push('on_fire');

  const hadStreakOf3 = hasStreakThenLoss(results, 3);
  if (hadStreakOf3) earned.push('streak_breaker');

  const minorityWins = results.filter((r) => r.minorityWin).length;
  if (minorityWins >= 3) earned.push('underdog');

  if (wentNegative || playerData.points < 0) earned.push('bankrupt');
  if (recoveredFromNegative) earned.push('comeback');

  for (const [, dayResults] of Object.entries(matchDays)) {
    if (dayResults.length >= 2 && dayResults.every(Boolean)) {
      earned.push('perfect_day');
      break;
    }
  }

  if (allIn) earned.push('yolo');

  const ddCount = wagers ? Object.values(wagers).filter((w) => w.type === 'double-down').length : 0;
  if (ddCount >= 5) earned.push('double_trouble');

  return BADGE_DEFS.filter((b) => earned.includes(b.id));
}

export function formatBadges(badges) {
  if (badges.length === 0) return '';
  return badges.map((b) => b.icon).join(' ');
}

export function formatBadgesDetailed(badges) {
  if (badges.length === 0) return '*No badges yet*';
  return badges.map((b) => `${b.icon} **${b.name}** — ${b.desc}`).join('\n');
}

function getWinner(match) {
  if (match.result.home > match.result.away) return match.home;
  if (match.result.home < match.result.away) return match.away;
  return 'draw';
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

function checkMinority(votes, key, messageId, userVote) {
  if (!votes || !(key in votes) || !(messageId in votes[key])) return false;
  const matchVotes = votes[key][messageId];
  const allVotes = Object.values(matchVotes).map((v) => v.vote);
  const userVoteCount = allVotes.filter((v) => v === userVote).length;
  return userVoteCount < allVotes.length / 2;
}
