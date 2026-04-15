import { jest } from '@jest/globals';

jest.unstable_mockModule('./firebase.js', () => ({
  awardBadge: jest.fn(),
}));

jest.unstable_mockModule('./helper.js', () => ({
  getWinner: jest.fn(),
  getMatchDay: jest.fn(),
  getMatchVote: jest.fn(),
  getMatchVotes: jest.fn(),
}));

jest.unstable_mockModule('./logger.js', () => ({
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const { awardBadge } = await import('./firebase.js');
const helperMock = await import('./helper.js');

const {
  BADGE_DEFS,
  checkAndAwardBadges,
  formatBadges,
  formatBadgesDetailed,
} = await import('./badges.js');

beforeEach(() => {
  jest.clearAllMocks();
  awardBadge.mockResolvedValue(true);
});

describe('BADGE_DEFS', () => {
  test('contains expected badge ids', () => {
    const ids = BADGE_DEFS.map((b) => b.id);
    expect(ids).toContain('first_blood');
    expect(ids).toContain('oracle');
    expect(ids).toContain('on_fire');
    expect(ids).toContain('bankrupt');
  });
});

describe('formatBadges', () => {
  test('returns empty string when no badges', () => {
    expect(formatBadges({})).toBe('');
    expect(formatBadges(null)).toBe('');
  });

  test('returns icons for known badges', () => {
    const result = formatBadges({ first_blood: true, oracle: true });
    expect(result).toContain('🩸');
    expect(result).toContain('🔮');
  });

  test('ignores unknown badge ids', () => {
    const result = formatBadges({ unknown_badge: true });
    expect(result).toBe('');
  });
});

describe('formatBadgesDetailed', () => {
  test('returns placeholder when no badges', () => {
    expect(formatBadgesDetailed({})).toBe('*Chưa có gì cả*');
    expect(formatBadgesDetailed(null)).toBe('*Chưa có gì cả*');
  });

  test('includes badge name and desc for known badges', () => {
    const result = formatBadgesDetailed({ first_blood: true });
    expect(result).toContain('Máu Đầu');
    expect(result).toContain('🩸');
  });

  test('returns empty string when all badge ids are unknown', () => {
    const result = formatBadgesDetailed({ unknown_badge: true });
    expect(result).toBe('');
  });
});

describe('checkAndAwardBadges', () => {
  const makeMatch = (id, home, away, result, date = '2026-06-14T17:00:00Z', messageId = `msg${id}`) => ({
    id,
    home,
    away,
    result,
    date,
    messageId,
  });

  const makeVotes = (matchIndex, messageId, userVotes) => ({
    [matchIndex]: { [messageId]: userVotes },
  });

  beforeEach(() => {
    helperMock.getWinner.mockImplementation((match) => {
      if (!match.result) return null;
      if (match.result.home > match.result.away) return match.home;
      if (match.result.home < match.result.away) return match.away;
      return 'draw';
    });

    helperMock.getMatchVote.mockImplementation((votes, key, messageId, userId) => {
      if (!votes || !(key in votes) || !messageId || !(messageId in votes[key])) return null;
      return votes[key][messageId]?.[userId]?.vote ?? null;
    });

    helperMock.getMatchVotes.mockImplementation((votes, key, messageId) => {
      if (!votes || !(key in votes) || !messageId || !(messageId in votes[key])) return null;
      return votes[key][messageId] || null;
    });

    helperMock.getMatchDay.mockImplementation((dateStr) => {
      return new Date(dateStr).toISOString().slice(0, 10);
    });
  });

  test('awards first_blood badge on first correct vote', async () => {
    const match = makeMatch(1, 'Brazil', 'Argentina', { home: 2, away: 1 });
    const votes = makeVotes('0', 'msg1', { user1: { vote: 'Brazil' } });

    const result = await checkAndAwardBadges({
      players: { user1: { points: 10 } },
      completedMatches: [match],
      votes,
      wagers: {},
      existingBadges: {},
    });

    expect(result.user1).toBeDefined();
    expect(result.user1.map((b) => b.id)).toContain('first_blood');
  });

  test('does not re-award existing badge', async () => {
    const match = makeMatch(1, 'Brazil', 'Argentina', { home: 2, away: 1 });
    const votes = makeVotes('0', 'msg1', { user1: { vote: 'Brazil' } });

    const result = await checkAndAwardBadges({
      players: { user1: { points: 10 } },
      completedMatches: [match],
      votes,
      wagers: {},
      existingBadges: { user1: { first_blood: true } },
    });

    const ids = result.user1?.map((b) => b.id) || [];
    expect(ids).not.toContain('first_blood');
  });

  test('awards bankrupt badge when points < 0', async () => {
    const result = await checkAndAwardBadges({
      players: { user1: { points: -5 } },
      completedMatches: [],
      votes: {},
      wagers: {},
      existingBadges: {},
    });

    expect(result.user1?.map((b) => b.id)).toContain('bankrupt');
  });

  test('awards comeback badge when positive after negative balance', async () => {
    const result = await checkAndAwardBadges({
      players: { user1: { points: 5, hadNegativeBalance: true } },
      completedMatches: [],
      votes: {},
      wagers: {},
      existingBadges: {},
    });

    expect(result.user1?.map((b) => b.id)).toContain('comeback');
  });

  test('awards on_fire badge for 3-win streak', async () => {
    const matches = [
      makeMatch(1, 'Brazil', 'Arg', { home: 1, away: 0 }, '2026-06-14T10:00:00Z', 'msg1'),
      makeMatch(2, 'Brazil', 'Arg', { home: 1, away: 0 }, '2026-06-15T10:00:00Z', 'msg2'),
      makeMatch(3, 'Brazil', 'Arg', { home: 1, away: 0 }, '2026-06-16T10:00:00Z', 'msg3'),
    ];
    const votes = {
      '0': { 'msg1': { user1: { vote: 'Brazil' } } },
      '1': { 'msg2': { user1: { vote: 'Brazil' } } },
      '2': { 'msg3': { user1: { vote: 'Brazil' } } },
    };

    const result = await checkAndAwardBadges({
      players: { user1: { points: 30 } },
      completedMatches: matches,
      votes,
      wagers: {},
      existingBadges: {},
    });

    expect(result.user1?.map((b) => b.id)).toContain('on_fire');
  });

  test('awards oracle badge for 5-win streak', async () => {
    const matches = Array.from({ length: 5 }, (_, i) =>
      makeMatch(i + 1, 'Brazil', 'Arg', { home: 1, away: 0 }, `2026-06-${14 + i}T10:00:00Z`, `msg${i + 1}`),
    );
    const votes = Object.fromEntries(
      matches.map((m, i) => [`${i}`, { [`msg${i + 1}`]: { user1: { vote: 'Brazil' } } }]),
    );

    const result = await checkAndAwardBadges({
      players: { user1: { points: 50 } },
      completedMatches: matches,
      votes,
      wagers: {},
      existingBadges: {},
    });

    const ids = result.user1?.map((b) => b.id) || [];
    expect(ids).toContain('oracle');
  });

  test('awards double_trouble when 5+ double-downs used', async () => {
    const wagers = {
      user1: {
        1: { doubleDown: true },
        2: { doubleDown: true },
        3: { doubleDown: true },
        4: { doubleDown: true },
        5: { doubleDown: true },
      },
    };

    const result = await checkAndAwardBadges({
      players: { user1: { points: 0 } },
      completedMatches: [],
      votes: {},
      wagers,
      existingBadges: {},
    });

    expect(result.user1?.map((b) => b.id)).toContain('double_trouble');
  });

  test('awards streak_breaker badge', async () => {
    const matches = [
      makeMatch(1, 'Brazil', 'Arg', { home: 1, away: 0 }, '2026-06-14T10:00:00Z', 'msg1'),
      makeMatch(2, 'Brazil', 'Arg', { home: 1, away: 0 }, '2026-06-15T10:00:00Z', 'msg2'),
      makeMatch(3, 'Brazil', 'Arg', { home: 1, away: 0 }, '2026-06-16T10:00:00Z', 'msg3'),
      makeMatch(4, 'Brazil', 'Arg', { home: 0, away: 1 }, '2026-06-17T10:00:00Z', 'msg4'),
    ];
    const votes = {
      '0': { 'msg1': { user1: { vote: 'Brazil' } } },
      '1': { 'msg2': { user1: { vote: 'Brazil' } } },
      '2': { 'msg3': { user1: { vote: 'Brazil' } } },
      '3': { 'msg4': { user1: { vote: 'Brazil' } } },
    };

    const result = await checkAndAwardBadges({
      players: { user1: { points: 10 } },
      completedMatches: matches,
      votes,
      wagers: {},
      existingBadges: {},
    });

    const ids = result.user1?.map((b) => b.id) || [];
    expect(ids).toContain('streak_breaker');
  });

  test('awards perfect_day when all matches in a day are correct', async () => {
    const matches = [
      makeMatch(1, 'Brazil', 'Arg', { home: 1, away: 0 }, '2026-06-14T10:00:00Z', 'msg1'),
      makeMatch(2, 'France', 'Spain', { home: 2, away: 1 }, '2026-06-14T14:00:00Z', 'msg2'),
    ];
    const votes = {
      '0': { 'msg1': { user1: { vote: 'Brazil' } } },
      '1': { 'msg2': { user1: { vote: 'France' } } },
    };

    const result = await checkAndAwardBadges({
      players: { user1: { points: 20 } },
      completedMatches: matches,
      votes,
      wagers: {},
      existingBadges: {},
    });

    const ids = result.user1?.map((b) => b.id) || [];
    expect(ids).toContain('perfect_day');
  });

  test('does not award perfect_day for single-match days', async () => {
    const matches = [
      makeMatch(1, 'Brazil', 'Arg', { home: 1, away: 0 }, '2026-06-14T10:00:00Z', 'msg1'),
    ];
    const votes = {
      '0': { 'msg1': { user1: { vote: 'Brazil' } } },
    };

    const result = await checkAndAwardBadges({
      players: { user1: { points: 10 } },
      completedMatches: matches,
      votes,
      wagers: {},
      existingBadges: {},
    });

    const ids = result.user1?.map((b) => b.id) || [];
    expect(ids).not.toContain('perfect_day');
  });

  test('awards underdog badge for 3 minority wins', async () => {
    const makeMinoritySetup = (matchIdx, msgId, winner, userVote, otherVotes) => {
      const voteMap = { user1: { vote: userVote } };
      for (const [uid, v] of Object.entries(otherVotes)) {
        voteMap[uid] = { vote: v };
      }
      return { matchIdx, msgId, voteMap, winner };
    };

    const scenarios = [
      makeMinoritySetup('0', 'msg1', 'Brazil', 'Brazil', { u2: 'Arg', u3: 'Arg', u4: 'Arg' }),
      makeMinoritySetup('1', 'msg2', 'France', 'France', { u2: 'Spain', u3: 'Spain', u4: 'Spain' }),
      makeMinoritySetup('2', 'msg3', 'England', 'England', { u2: 'draw', u3: 'draw', u4: 'draw' }),
    ];

    const matches = scenarios.map((s, i) => {
      const [home, ...rest] = s.winner === 'draw' ? ['England', 'Germany'] : [s.winner, 'Opponent'];
      return makeMatch(i + 1, home, rest[0], { home: 1, away: 0 }, `2026-06-${14 + i}T10:00:00Z`, s.msgId);
    });

    const votes = {};
    for (const s of scenarios) {
      votes[s.matchIdx] = { [s.msgId]: s.voteMap };
    }

    const result = await checkAndAwardBadges({
      players: { user1: { points: 30 } },
      completedMatches: matches,
      votes,
      wagers: {},
      existingBadges: {},
    });

    const ids = result.user1?.map((b) => b.id) || [];
    expect(ids).toContain('underdog');
  });

  test('returns empty object when no badges earned', async () => {
    const result = await checkAndAwardBadges({
      players: { user1: { points: 10 } },
      completedMatches: [],
      votes: {},
      wagers: {},
      existingBadges: {},
    });

    expect(result).toEqual({});
  });

  test('handles awardBadge returning false (already awarded externally)', async () => {
    awardBadge.mockResolvedValue(false);
    const result = await checkAndAwardBadges({
      players: { user1: { points: -5 } },
      completedMatches: [],
      votes: {},
      wagers: {},
      existingBadges: {},
    });

    expect(result).toEqual({});
  });
});
