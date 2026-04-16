import { jest } from '@jest/globals';

jest.unstable_mockModule('./firebase.js', () => ({
  readTournamentData: jest.fn(),
  readTournamentConfig: jest.fn(),
  updateMatch: jest.fn(),
  updatePlayers: jest.fn(),
  readMatchVotes: jest.fn(),
  readAllVotes: jest.fn(),
  readPlayers: jest.fn(),
  readPlayerWagers: jest.fn(),
  readCurses: jest.fn(),
  readAllBadges: jest.fn(),
  updateGroupTeam: jest.fn(),
  saveMatchRandomPicks: jest.fn(),
}));

jest.unstable_mockModule('./helper.js', () => ({
  getWinner: jest.fn(),
  getMatchDay: jest.fn(),
  getMatchVotes: jest.fn(),
}));

jest.unstable_mockModule('./badges.js', () => ({
  checkAndAwardBadges: jest.fn().mockResolvedValue({}),
}));

jest.unstable_mockModule('./command.js', () => ({
  getChannelId: jest.fn().mockResolvedValue('channel123'),
  getTournamentName: jest.fn().mockResolvedValue('World Cup 2026'),
}));

jest.unstable_mockModule('./flavor.js', () => ({
  pickLine: jest.fn().mockResolvedValue(''),
}));

jest.unstable_mockModule('./logger.js', () => ({
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

jest.unstable_mockModule('cron', () => ({
  CronJob: { from: jest.fn().mockReturnValue({ stop: jest.fn() }) },
}));

jest.unstable_mockModule('discord.js', () => ({
  ActionRowBuilder: jest.fn().mockImplementation(() => ({
    addComponents: jest.fn().mockReturnThis(),
  })),
  ButtonBuilder: jest.fn().mockImplementation(() => ({
    setCustomId: jest.fn().mockReturnThis(),
    setLabel: jest.fn().mockReturnThis(),
    setStyle: jest.fn().mockReturnThis(),
  })),
  ButtonStyle: { Success: 1, Primary: 2, Danger: 3 },
  EmbedBuilder: jest.fn().mockImplementation(() => ({
    setTitle: jest.fn().mockReturnThis(),
    setDescription: jest.fn().mockReturnThis(),
    setColor: jest.fn().mockReturnThis(),
    setFooter: jest.fn().mockReturnThis(),
    setTimestamp: jest.fn().mockReturnThis(),
    setThumbnail: jest.fn().mockReturnThis(),
  })),
}));

const {
  getMatchStake,
  resolveMatchPicks,
  CURSE_PTS,
  calculateMatches,
  updateGroupStandings,
  matchPostJob,
  voteReminderJob,
  calculatingJob,
} = await import('./football.js');

const firebaseMock = await import('./firebase.js');
const helperMock = await import('./helper.js');
const { CronJob } = await import('cron');

beforeEach(() => {
  jest.clearAllMocks();
  helperMock.getWinner.mockImplementation((match) => {
    if (!match.result) return null;
    if (match.result.home > match.result.away) return match.home;
    if (match.result.home < match.result.away) return match.away;
    return 'draw';
  });
  helperMock.getMatchVotes.mockReturnValue(null);
  helperMock.getMatchDay.mockReturnValue('2026-06-14');
});

describe('CURSE_PTS', () => {
  test('is 5', () => {
    expect(CURSE_PTS).toBe(5);
  });
});

describe('getMatchStake', () => {
  test('returns 10 for group stage matches (1-72)', () => {
    expect(getMatchStake(1)).toBe(10);
    expect(getMatchStake(50)).toBe(10);
    expect(getMatchStake(72)).toBe(10);
  });

  test('returns 10 for round of 32 (73-88)', () => {
    expect(getMatchStake(73)).toBe(10);
    expect(getMatchStake(88)).toBe(10);
  });

  test('returns 15 for round of 16 (89-96)', () => {
    expect(getMatchStake(89)).toBe(15);
    expect(getMatchStake(96)).toBe(15);
  });

  test('returns 20 for quarter finals (97-100)', () => {
    expect(getMatchStake(97)).toBe(20);
    expect(getMatchStake(100)).toBe(20);
  });

  test('returns 30 for semi finals (101-102)', () => {
    expect(getMatchStake(101)).toBe(30);
    expect(getMatchStake(102)).toBe(30);
  });

  test('returns 50 for final/3rd place (103-104)', () => {
    expect(getMatchStake(103)).toBe(50);
    expect(getMatchStake(104)).toBe(50);
  });

  test('defaults to 10 for unknown match id', () => {
    expect(getMatchStake(999)).toBe(10);
  });
});

describe('resolveMatchPicks', () => {
  const match = { id: 1, home: 'Brazil', away: 'Argentina' };
  const playerIds = ['u1', 'u2', 'u3'];

  test('uses votes for players that voted', () => {
    const votes = { u1: { vote: 'Brazil' }, u2: { vote: 'draw' } };
    const { picks } = resolveMatchPicks(playerIds, votes, match, {});
    expect(picks.u1).toBe('Brazil');
    expect(picks.u2).toBe('draw');
  });

  test('assigns least-voted outcome for unvoted players', () => {
    const votes = {
      u1: { vote: 'Brazil' },
      u2: { vote: 'Brazil' },
    };
    const { picks, randomPicks } = resolveMatchPicks(playerIds, votes, match, {});
    expect(picks.u3).toBeDefined();
    expect(randomPicks).toHaveProperty('u3');
    expect(['Brazil', 'draw', 'Argentina']).toContain(picks.u3);
  });

  test('ignores votes from non-player ids', () => {
    const votes = { unknown: { vote: 'Brazil' } };
    const { picks } = resolveMatchPicks(playerIds, votes, match, {});
    expect(picks.unknown).toBeUndefined();
  });

  test('applies double-down multiplier to stake', () => {
    const votes = { u1: { vote: 'Brazil' }, u2: { vote: 'draw' }, u3: { vote: 'Argentina' } };
    const wagers = { u1: { 1: { doubleDown: true } } };
    const { playerStakes } = resolveMatchPicks(playerIds, votes, match, wagers);
    expect(playerStakes.u1).toBe(20); // 10 * 2
    expect(playerStakes.u2).toBe(10);
    expect(playerStakes.u3).toBe(10);
  });

  test('handles null votes — all players get random picks', () => {
    const { randomPicks } = resolveMatchPicks(playerIds, null, match, {});
    expect(Object.keys(randomPicks)).toHaveLength(3);
  });

  test('random wager uses random pick for that player', () => {
    const votes = {};
    const wagers = { u1: { 1: { random: true } } };
    const { picks } = resolveMatchPicks(playerIds, votes, match, wagers);
    expect(['Brazil', 'draw', 'Argentina']).toContain(picks.u1);
  });

  test('random picks are resolved before least-voted auto-assignment', () => {
    // u1 voted Brazil, u2 has random wager, u3 gets auto-assigned
    // u2's random pick should be included when computing least-voted for u3
    const votes = { u1: { vote: 'Brazil' } };
    const wagers = { u2: { 1: { random: true } } };

    const outcomes = ['Brazil', 'draw', 'Argentina'];
    const runCounts = { Brazil: 0, draw: 0, Argentina: 0 };

    // Run many times to observe what u3 gets assigned
    for (let i = 0; i < 300; i++) {
      const { picks } = resolveMatchPicks(playerIds, votes, match, wagers);
      runCounts[picks.u3]++;
    }

    // u3 should never be assigned Brazil alone if draw/Argentina are less voted;
    // more importantly u3 must always get a valid outcome
    const total = runCounts.Brazil + runCounts.draw + runCounts.Argentina;
    expect(total).toBe(300);
    // u3 should receive the least-voted outcome after u2's random pick is factored in,
    // so it should never be over-represented on Brazil (which u1 always picks)
    expect(runCounts.Brazil).toBeLessThan(300);
  });
});

describe('calculateMatches', () => {
  test('skips when no players', async () => {
    firebaseMock.readAllVotes.mockResolvedValue({});
    firebaseMock.readPlayerWagers.mockResolvedValue({});
    firebaseMock.readCurses.mockResolvedValue({});
    firebaseMock.readPlayers.mockResolvedValue(null);

    const match = { id: 1, home: 'Brazil', away: 'Argentina', result: { home: 2, away: 0 }, messageId: 'msg1' };
    const result = await calculateMatches([match], null);
    expect(result).toEqual({});
  });

  test('calculates match points and updates players', async () => {
    const match = {
      id: 1,
      home: 'Brazil',
      away: 'Argentina',
      result: { home: 2, away: 0 },
      messageId: 'msg1',
    };
    const players = { u1: { points: 0, matches: 0 }, u2: { points: 0, matches: 0 } };
    const votes = { '0': { msg1: { u1: { vote: 'Brazil' }, u2: { vote: 'Argentina' } } } };

    firebaseMock.readAllVotes.mockResolvedValue(votes);
    firebaseMock.readPlayerWagers.mockResolvedValue({});
    firebaseMock.readCurses.mockResolvedValue({});
    firebaseMock.readPlayers.mockResolvedValue({ ...players });
    firebaseMock.saveMatchRandomPicks.mockResolvedValue();
    firebaseMock.updateMatch.mockResolvedValue();
    firebaseMock.updatePlayers.mockResolvedValue();
    firebaseMock.readTournamentData.mockResolvedValue([match]);
    firebaseMock.readAllBadges.mockResolvedValue({});

    helperMock.getMatchVotes.mockReturnValue({ u1: { vote: 'Brazil' }, u2: { vote: 'Argentina' } });

    const result = await calculateMatches([match], null);
    expect(result).toHaveProperty('1');
    expect(firebaseMock.updatePlayers).toHaveBeenCalled();
  });

  test('skips duplicate match ids (calculationLock)', async () => {
    const match = { id: 200, home: 'A', away: 'B', result: { home: 1, away: 0 }, messageId: 'msg200' };
    const players = { u1: { points: 0, matches: 0 } };

    firebaseMock.readAllVotes.mockResolvedValue({});
    firebaseMock.readPlayerWagers.mockResolvedValue({});
    firebaseMock.readCurses.mockResolvedValue({});
    firebaseMock.readPlayers.mockResolvedValue({ ...players });
    firebaseMock.saveMatchRandomPicks.mockResolvedValue();
    firebaseMock.updateMatch.mockResolvedValue();
    firebaseMock.updatePlayers.mockResolvedValue();
    firebaseMock.readTournamentData.mockResolvedValue([match]);
    firebaseMock.readAllBadges.mockResolvedValue({});
    helperMock.getMatchVotes.mockReturnValue(null);

    const [res1, res2] = await Promise.all([
      calculateMatches([match], null),
      calculateMatches([match], null),
    ]);
    const total = (Object.keys(res1 || {}).length) + (Object.keys(res2 || {}).length);
    expect(total).toBe(1);
  });
});

describe('updateGroupStandings', () => {
  test('skips playoff matches (id > 72)', async () => {
    const match = { id: 73, home: 'Brazil', away: 'Arg', result: { home: 1, away: 0 }, hasResult: true };
    await updateGroupStandings(match);
    expect(firebaseMock.readTournamentData).not.toHaveBeenCalled();
  });

  test('skips matches without results', async () => {
    const match = { id: 1, home: 'Brazil', away: 'Arg', hasResult: false };
    await updateGroupStandings(match);
    expect(firebaseMock.readTournamentData).not.toHaveBeenCalled();
  });

  test('skips already updated matches', async () => {
    const match = { id: 1, home: 'Brazil', away: 'Arg', result: { home: 1, away: 0 }, hasResult: true, groupUpdated: true };
    await updateGroupStandings(match);
    expect(firebaseMock.readTournamentData).not.toHaveBeenCalled();
  });

  test('updates group standings for valid group match', async () => {
    const match = { id: 1, home: 'Brazil', away: 'Argentina', result: { home: 2, away: 1 }, hasResult: true };
    const freshMatch = { ...match, groupUpdated: false };
    const groups = {
      a: {
        Brazil: { played: 0, won: 0, drawn: 0, lost: 0, for: 0, against: 0, goalDifference: 0, points: 0 },
        Argentina: { played: 0, won: 0, drawn: 0, lost: 0, for: 0, against: 0, goalDifference: 0, points: 0 },
      },
    };

    firebaseMock.readTournamentData
      .mockResolvedValueOnce([freshMatch])
      .mockResolvedValueOnce(groups);
    firebaseMock.updateGroupTeam.mockResolvedValue();
    firebaseMock.updateMatch.mockResolvedValue();

    await updateGroupStandings(match);

    expect(firebaseMock.updateGroupTeam).toHaveBeenCalledWith('a', 'Brazil', expect.objectContaining({ won: 1, points: 3 }));
    expect(firebaseMock.updateGroupTeam).toHaveBeenCalledWith('a', 'Argentina', expect.objectContaining({ lost: 1, points: 0 }));
    expect(firebaseMock.updateMatch).toHaveBeenCalledWith(0, { groupUpdated: true });
  });

  test('handles draw correctly', async () => {
    const match = { id: 2, home: 'France', away: 'Spain', result: { home: 1, away: 1 }, hasResult: true };
    const freshMatch = { ...match, groupUpdated: false };
    const groups = {
      b: {
        France: { played: 0, won: 0, drawn: 0, lost: 0, for: 0, against: 0, goalDifference: 0, points: 0 },
        Spain: { played: 0, won: 0, drawn: 0, lost: 0, for: 0, against: 0, goalDifference: 0, points: 0 },
      },
    };

    firebaseMock.readTournamentData
      .mockResolvedValueOnce([freshMatch])
      .mockResolvedValueOnce(groups);
    firebaseMock.updateGroupTeam.mockResolvedValue();
    firebaseMock.updateMatch.mockResolvedValue();

    await updateGroupStandings(match);

    expect(firebaseMock.updateGroupTeam).toHaveBeenCalledWith('b', 'France', expect.objectContaining({ drawn: 1, points: 1 }));
    expect(firebaseMock.updateGroupTeam).toHaveBeenCalledWith('b', 'Spain', expect.objectContaining({ drawn: 1, points: 1 }));
  });

  test('warns when teams not found in any group', async () => {
    const loggerMock = await import('./logger.js');
    const match = { id: 3, home: 'Unknown1', away: 'Unknown2', result: { home: 1, away: 0 }, hasResult: true };
    const freshMatch = { ...match, groupUpdated: false };
    const groups = {
      a: {
        Brazil: { played: 0, won: 0, drawn: 0, lost: 0, for: 0, against: 0, goalDifference: 0, points: 0 },
      },
    };

    firebaseMock.readTournamentData
      .mockResolvedValueOnce([freshMatch])
      .mockResolvedValueOnce(groups);

    await updateGroupStandings(match);

    expect(loggerMock.default.warn).toHaveBeenCalledWith(expect.stringContaining('Could not find group'));
  });
});

// ---------------------------------------------------------------------------
// Helpers to capture CronJob onTick callbacks
// ---------------------------------------------------------------------------

function captureOnTick() {
  let captured = null;
  CronJob.from.mockImplementationOnce(({ onTick }) => {
    captured = onTick;
    return { stop: jest.fn() };
  });
  return () => captured;
}

function makeChannel(opts = {}) {
  const send = opts.send || jest.fn().mockResolvedValue({ id: 'msg99' });
  const messages = { fetch: jest.fn().mockResolvedValue({ embeds: [{}], edit: jest.fn().mockResolvedValue() }) };
  return { send, messages };
}

function makeClient(channel = makeChannel()) {
  return { channels: { fetch: jest.fn().mockResolvedValue(channel) }, cachedUsers: {} };
}

// ---------------------------------------------------------------------------
// matchPostJob
// ---------------------------------------------------------------------------

describe('matchPostJob', () => {
  test('creates a CronJob', () => {
    const client = makeClient();
    matchPostJob(client);
    expect(CronJob.from).toHaveBeenCalled();
  });

  test('tick does nothing when no matches data', async () => {
    const getOnTick = captureOnTick();
    matchPostJob(makeClient());
    const onTick = getOnTick();

    firebaseMock.readTournamentData.mockResolvedValue(null);
    await onTick();
    expect(firebaseMock.updateMatch).not.toHaveBeenCalled();
  });

  test('tick does nothing when no unposted upcoming matches', async () => {
    const getOnTick = captureOnTick();
    matchPostJob(makeClient());
    const onTick = getOnTick();

    const past = new Date(Date.now() - 3_600_000).toISOString();
    firebaseMock.readTournamentData.mockResolvedValue([
      { id: 1, home: 'A', away: 'B', date: past, messageId: null },
    ]);
    await onTick();
    expect(firebaseMock.updateMatch).not.toHaveBeenCalled();
  });

  test('tick posts upcoming unposted match and saves messageId', async () => {
    const getOnTick = captureOnTick();
    const send = jest.fn().mockResolvedValue({ id: 'newMsg' });
    const channel = { ...makeChannel({ send }), messages: undefined };
    const client = makeClient(channel);
    matchPostJob(client);
    const onTick = getOnTick();

    const soon = new Date(Date.now() + 60_000).toISOString();
    firebaseMock.readTournamentData.mockResolvedValue([
      { id: 1, home: 'Brazil', away: 'Argentina', date: soon, messageId: null, location: 'Stadium' },
    ]);
    firebaseMock.readTournamentConfig.mockResolvedValue({ channelId: 'ch1', name: 'WC' });
    firebaseMock.updateMatch.mockResolvedValue();

    await onTick();

    expect(send).toHaveBeenCalled();
    expect(firebaseMock.updateMatch).toHaveBeenCalledWith(0, { messageId: 'newMsg' });
  });

  test('tick catches and logs errors', async () => {
    const getOnTick = captureOnTick();
    matchPostJob(makeClient());
    const onTick = getOnTick();
    const loggerMock = await import('./logger.js');

    firebaseMock.readTournamentData.mockRejectedValue(new Error('db error'));
    await onTick();
    expect(loggerMock.default.error).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// voteReminderJob
// ---------------------------------------------------------------------------

describe('voteReminderJob', () => {
  test('creates a CronJob', () => {
    voteReminderJob(makeClient());
    expect(CronJob.from).toHaveBeenCalled();
  });

  test('tick does nothing when no matches data', async () => {
    const getOnTick = captureOnTick();
    voteReminderJob(makeClient());
    const onTick = getOnTick();

    firebaseMock.readTournamentData.mockResolvedValue(null);
    await onTick();
    expect(firebaseMock.updateMatch).not.toHaveBeenCalled();
  });

  test('tick skips when no eligible reminder matches', async () => {
    const getOnTick = captureOnTick();
    voteReminderJob(makeClient());
    const onTick = getOnTick();

    const far = new Date(Date.now() + 3_600_000).toISOString();
    firebaseMock.readTournamentData.mockResolvedValue([
      { id: 1, date: far, messageId: 'msg1', reminded: false },
    ]);
    await onTick();
    expect(firebaseMock.readPlayers).not.toHaveBeenCalled();
  });

  test('tick sends reminder to unvoted players', async () => {
    const getOnTick = captureOnTick();
    const send = jest.fn().mockResolvedValue();
    const channel = makeChannel({ send });
    const client = makeClient(channel);
    voteReminderJob(client);
    const onTick = getOnTick();

    const soon = new Date(Date.now() + 60_000).toISOString();
    firebaseMock.readTournamentData.mockResolvedValue([
      { id: 1, date: soon, messageId: 'msg1', reminded: false, home: 'A', away: 'B' },
    ]);
    firebaseMock.readPlayers.mockResolvedValue({ u1: {}, u2: {} });
    firebaseMock.readMatchVotes.mockResolvedValue({ u1: { vote: 'A' } });
    firebaseMock.updateMatch.mockResolvedValue();

    await onTick();
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('<@u2>') }));
    expect(firebaseMock.updateMatch).toHaveBeenCalledWith(0, { reminded: true });
  });

  test('tick marks reminded without sending when all players voted', async () => {
    const getOnTick = captureOnTick();
    const send = jest.fn().mockResolvedValue();
    const channel = makeChannel({ send });
    const client = makeClient(channel);
    voteReminderJob(client);
    const onTick = getOnTick();

    const soon = new Date(Date.now() + 60_000).toISOString();
    firebaseMock.readTournamentData.mockResolvedValue([
      { id: 1, date: soon, messageId: 'msg1', reminded: false, home: 'A', away: 'B' },
    ]);
    firebaseMock.readPlayers.mockResolvedValue({ u1: {} });
    firebaseMock.readMatchVotes.mockResolvedValue({ u1: { vote: 'A' } });
    firebaseMock.updateMatch.mockResolvedValue();

    await onTick();
    expect(send).not.toHaveBeenCalled();
    expect(firebaseMock.updateMatch).toHaveBeenCalledWith(0, { reminded: true });
  });

  test('tick skips when no players registered', async () => {
    const getOnTick = captureOnTick();
    voteReminderJob(makeClient());
    const onTick = getOnTick();

    const soon = new Date(Date.now() + 60_000).toISOString();
    firebaseMock.readTournamentData.mockResolvedValue([
      { id: 1, date: soon, messageId: 'msg1', reminded: false },
    ]);
    firebaseMock.readPlayers.mockResolvedValue(null);

    await onTick();
    expect(firebaseMock.readMatchVotes).not.toHaveBeenCalled();
  });

  test('tick catches and logs errors', async () => {
    const getOnTick = captureOnTick();
    voteReminderJob(makeClient());
    const onTick = getOnTick();
    const loggerMock = await import('./logger.js');

    firebaseMock.readTournamentData.mockRejectedValue(new Error('db fail'));
    await onTick();
    expect(loggerMock.default.error).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// calculatingJob
// ---------------------------------------------------------------------------

describe('calculatingJob', () => {
  test('creates a CronJob', () => {
    calculatingJob(makeClient());
    expect(CronJob.from).toHaveBeenCalled();
  });

  test('tick does nothing when no matches', async () => {
    const getOnTick = captureOnTick();
    calculatingJob(makeClient());
    const onTick = getOnTick();

    firebaseMock.readTournamentData.mockResolvedValue(null);
    await onTick();
    expect(firebaseMock.readAllVotes).not.toHaveBeenCalled();
  });

  test('tick sends result reminder for long-unresolved matches', async () => {
    const getOnTick = captureOnTick();
    const send = jest.fn().mockResolvedValue();
    const channel = makeChannel({ send });
    const client = makeClient(channel);
    calculatingJob(client);
    const onTick = getOnTick();

    const longAgo = new Date(Date.now() - 4 * 3_600_000).toISOString();
    firebaseMock.readTournamentData.mockResolvedValue([
      { id: 5, home: 'A', away: 'B', date: longAgo, hasResult: false, resultReminded: false },
    ]);
    firebaseMock.updateMatch.mockResolvedValue();

    await onTick();
    expect(send).toHaveBeenCalled();
    expect(firebaseMock.updateMatch).toHaveBeenCalledWith(4, { resultReminded: true });
  });

  test('tick calculates uncalculated matches', async () => {
    const getOnTick = captureOnTick();
    const client = makeClient();
    calculatingJob(client);
    const onTick = getOnTick();

    const match = { id: 301, home: 'C', away: 'D', date: new Date(Date.now() - 3_600_000).toISOString(), hasResult: true, isCalculated: false, messageId: 'msg301', result: { home: 1, away: 0 } };
    firebaseMock.readTournamentData.mockResolvedValue([match]);
    firebaseMock.readAllVotes.mockResolvedValue({});
    firebaseMock.readPlayerWagers.mockResolvedValue({});
    firebaseMock.readCurses.mockResolvedValue({});
    firebaseMock.readPlayers.mockResolvedValue({ u1: { points: 0, matches: 0 } });
    firebaseMock.saveMatchRandomPicks.mockResolvedValue();
    firebaseMock.updateMatch.mockResolvedValue();
    firebaseMock.updatePlayers.mockResolvedValue();
    firebaseMock.readAllBadges.mockResolvedValue({});
    helperMock.getMatchVotes.mockReturnValue(null);
    helperMock.getMatchDay.mockReturnValue('2026-06-14');

    await onTick();
    expect(firebaseMock.updatePlayers).toHaveBeenCalled();
  });

  test('tick catches and logs errors', async () => {
    const getOnTick = captureOnTick();
    calculatingJob(makeClient());
    const onTick = getOnTick();
    const loggerMock = await import('./logger.js');

    firebaseMock.readTournamentData.mockRejectedValue(new Error('tick error'));
    await onTick();
    expect(loggerMock.default.error).toHaveBeenCalled();
  });

  test('tick triggers MVP announcement when all matches in a day are done', async () => {
    const getOnTick = captureOnTick();
    const send = jest.fn().mockResolvedValue();
    const channel = makeChannel({ send });
    const client = { ...makeClient(channel), cachedUsers: { u1: { nickname: 'Alice', avatarURL: 'url' }, u2: { nickname: 'Bob' } } };
    calculatingJob(client);
    const onTick = getOnTick();

    const day = '2026-06-14T10:00:00Z';
    const match1 = { id: 600, home: 'A', away: 'B', date: day, hasResult: true, isCalculated: false, messageId: 'msg600', result: { home: 1, away: 0 } };
    const match2 = { id: 601, home: 'C', away: 'D', date: day, hasResult: true, isCalculated: false, messageId: 'msg601', result: { home: 2, away: 0 } };
    const freshMatches = [
      { ...match1, isCalculated: true, mvpAnnounced: false },
      { ...match2, isCalculated: true, mvpAnnounced: false },
    ];

    const votesObj = {
      599: { msg600: { u1: { vote: 'A' }, u2: { vote: 'B' } } },
      600: { msg601: { u1: { vote: 'C' }, u2: { vote: 'D' } } },
    };
    const players = { u1: { points: 0, matches: 0 }, u2: { points: 0, matches: 0 } };

    // First call: initial matches for calculatingJob tick
    // Second call: fresh matches after calculateMatches (for checkMatchdayMVP)
    // Subsequent calls: fresh matches for group standings etc.
    firebaseMock.readTournamentData
      .mockResolvedValueOnce([match1, match2])  // initial tick read
      .mockResolvedValue(freshMatches);          // all subsequent reads (calculateMatches + checkMatchdayMVP)

    firebaseMock.readAllVotes.mockResolvedValue(votesObj);
    firebaseMock.readPlayerWagers.mockResolvedValue({});
    firebaseMock.readCurses.mockResolvedValue({});
    // First readPlayers: for calculateMatches; second: freshPlayers after update; third: for MVP
    firebaseMock.readPlayers
      .mockResolvedValueOnce({ ...players })
      .mockResolvedValue({ u1: { points: 10, matches: 2 }, u2: { points: -10, matches: 2 } });
    firebaseMock.saveMatchRandomPicks.mockResolvedValue();
    firebaseMock.updateMatch.mockResolvedValue();
    firebaseMock.updatePlayers.mockResolvedValue();
    firebaseMock.readAllBadges.mockResolvedValue({});
    firebaseMock.readMatchVotes
      .mockResolvedValueOnce({ u1: { vote: 'A' }, u2: { vote: 'B' } })
      .mockResolvedValueOnce({ u1: { vote: 'C' }, u2: { vote: 'D' } });

    helperMock.getMatchVotes
      .mockReturnValueOnce({ u1: { vote: 'A' }, u2: { vote: 'B' } })
      .mockReturnValueOnce({ u1: { vote: 'C' }, u2: { vote: 'D' } })
      .mockReturnValueOnce({ u1: { vote: 'A' }, u2: { vote: 'B' } })
      .mockReturnValueOnce({ u1: { vote: 'C' }, u2: { vote: 'D' } })
      .mockReturnValue(null);
    helperMock.getMatchDay.mockReturnValue('2026-06-14');

    await onTick();
    expect(send).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// calculateMatches — curse resolution
// ---------------------------------------------------------------------------

describe('calculateMatches — curse resolution', () => {
  test('curse: target correct — curser loses points, target gains', async () => {
    const match = { id: 50, home: 'Brazil', away: 'Argentina', result: { home: 1, away: 0 }, messageId: 'msg50' };
    const players = {
      curser: { points: 20, matches: 0 },
      target: { points: 20, matches: 0 },
    };
    const votes = { '49': { msg50: { curser: { vote: 'Brazil' }, target: { vote: 'Brazil' } } } };
    const curses = { 50: { curser: { target: 'target' } } };

    firebaseMock.readAllVotes.mockResolvedValue(votes);
    firebaseMock.readPlayerWagers.mockResolvedValue({});
    firebaseMock.readCurses.mockResolvedValue(curses);
    firebaseMock.readPlayers.mockResolvedValue({ ...players });
    firebaseMock.saveMatchRandomPicks.mockResolvedValue();
    firebaseMock.updateMatch.mockResolvedValue();
    firebaseMock.updatePlayers.mockResolvedValue();
    firebaseMock.readTournamentData.mockResolvedValue([match]);
    firebaseMock.readAllBadges.mockResolvedValue({});
    helperMock.getMatchVotes.mockReturnValue({ curser: { vote: 'Brazil' }, target: { vote: 'Brazil' } });

    const deltas = await calculateMatches([match], null);
    expect(deltas[50].curser.delta).toBeLessThan(deltas[50].target.delta);
  });

  test('curse: target wrong — curser gains points, target loses', async () => {
    const match = { id: 51, home: 'Brazil', away: 'Argentina', result: { home: 1, away: 0 }, messageId: 'msg51' };
    const players = {
      curser: { points: 20, matches: 0 },
      target: { points: 20, matches: 0 },
    };
    const votes = { '50': { msg51: { curser: { vote: 'Brazil' }, target: { vote: 'Argentina' } } } };
    const curses = { 51: { curser: { target: 'target' } } };

    firebaseMock.readAllVotes.mockResolvedValue(votes);
    firebaseMock.readPlayerWagers.mockResolvedValue({});
    firebaseMock.readCurses.mockResolvedValue(curses);
    firebaseMock.readPlayers.mockResolvedValue({ ...players });
    firebaseMock.saveMatchRandomPicks.mockResolvedValue();
    firebaseMock.updateMatch.mockResolvedValue();
    firebaseMock.updatePlayers.mockResolvedValue();
    firebaseMock.readTournamentData.mockResolvedValue([match]);
    firebaseMock.readAllBadges.mockResolvedValue({});
    helperMock.getMatchVotes.mockReturnValue({ curser: { vote: 'Brazil' }, target: { vote: 'Argentina' } });

    const deltas = await calculateMatches([match], null);
    expect(deltas[51].curser.delta).toBeGreaterThan(deltas[51].target.delta);
  });
});

// ---------------------------------------------------------------------------
// computeDeltas edge cases (via calculateMatches)
// ---------------------------------------------------------------------------

describe('calculateMatches — all-win / all-lose edge cases', () => {
  function setupMatch(matchId, playerVotes) {
    const match = { id: matchId, home: 'A', away: 'B', result: { home: 1, away: 0 }, messageId: `msg${matchId}` };
    const players = Object.fromEntries(Object.keys(playerVotes).map((k) => [k, { points: 0, matches: 0 }]));
    const voteMap = Object.fromEntries(Object.entries(playerVotes).map(([k, v]) => [k, { vote: v }]));
    const votes = { [`${matchId - 1}`]: { [`msg${matchId}`]: voteMap } };

    firebaseMock.readAllVotes.mockResolvedValue(votes);
    firebaseMock.readPlayerWagers.mockResolvedValue({});
    firebaseMock.readCurses.mockResolvedValue({});
    firebaseMock.readPlayers.mockResolvedValue(players);
    firebaseMock.saveMatchRandomPicks.mockResolvedValue();
    firebaseMock.updateMatch.mockResolvedValue();
    firebaseMock.updatePlayers.mockResolvedValue();
    firebaseMock.readTournamentData.mockResolvedValue([match]);
    firebaseMock.readAllBadges.mockResolvedValue({});
    helperMock.getMatchVotes.mockReturnValue(voteMap);

    return match;
  }

  test('all players pick winner — delta is 0 for everyone', async () => {
    const match = setupMatch(400, { u1: 'A', u2: 'A', u3: 'A' });
    const result = await calculateMatches([match], null);
    for (const d of Object.values(result[400])) expect(d.delta).toBe(0);
  });

  test('all players pick loser — delta is 0 for everyone', async () => {
    const match = setupMatch(401, { u1: 'B', u2: 'B', u3: 'B' });
    const result = await calculateMatches([match], null);
    for (const d of Object.values(result[401])) expect(d.delta).toBe(0);
  });

  test('winner share proportional to stake', async () => {
    const matchId = 402;
    const match = { id: matchId, home: 'A', away: 'B', result: { home: 1, away: 0 }, messageId: `msg${matchId}` };
    const players = { u1: { points: 0, matches: 0 }, u2: { points: 0, matches: 0 }, u3: { points: 0, matches: 0 } };
    const voteMap = { u1: { vote: 'A' }, u2: { vote: 'B' }, u3: { vote: 'B' } };
    const votes = { [matchId - 1]: { [`msg${matchId}`]: voteMap } };
    const wagers = { u1: { [matchId]: { doubleDown: true } } };

    firebaseMock.readAllVotes.mockResolvedValue(votes);
    firebaseMock.readPlayerWagers.mockResolvedValue(wagers);
    firebaseMock.readCurses.mockResolvedValue({});
    firebaseMock.readPlayers.mockResolvedValue(players);
    firebaseMock.saveMatchRandomPicks.mockResolvedValue();
    firebaseMock.updateMatch.mockResolvedValue();
    firebaseMock.updatePlayers.mockResolvedValue();
    firebaseMock.readTournamentData.mockResolvedValue([match]);
    firebaseMock.readAllBadges.mockResolvedValue({});
    helperMock.getMatchVotes.mockReturnValue(voteMap);

    const result = await calculateMatches([match], null);
    // u1 doubled-down wins (stake 20), u2 and u3 lose (stake 10 each = 20 total)
    expect(result[matchId].u1.delta).toBeGreaterThan(0);
    expect(result[matchId].u2.delta).toBeLessThan(0);
    expect(result[matchId].u3.delta).toBeLessThan(0);
  });
});

// ---------------------------------------------------------------------------
// calculateMatches — announces badges via client
// ---------------------------------------------------------------------------

describe('calculateMatches — badge announcement', () => {
  test('announces new badges when client provided and badges earned', async () => {
    const { checkAndAwardBadges } = await import('./badges.js');
    checkAndAwardBadges.mockResolvedValueOnce({ u1: [{ id: 'first_blood', icon: '🩸', name: 'First Blood', desc: 'desc' }] });

    const match = { id: 500, home: 'A', away: 'B', result: { home: 1, away: 0 }, messageId: 'msg500' };
    const players = { u1: { points: 0, matches: 0 } };
    const voteMap = { u1: { vote: 'A' } };
    const votes = { 499: { msg500: voteMap } };

    firebaseMock.readAllVotes.mockResolvedValue(votes);
    firebaseMock.readPlayerWagers.mockResolvedValue({});
    firebaseMock.readCurses.mockResolvedValue({});
    firebaseMock.readPlayers.mockResolvedValue({ ...players });
    firebaseMock.saveMatchRandomPicks.mockResolvedValue();
    firebaseMock.updateMatch.mockResolvedValue();
    firebaseMock.updatePlayers.mockResolvedValue();
    firebaseMock.readTournamentData.mockResolvedValue([match]);
    firebaseMock.readAllBadges.mockResolvedValue({});
    helperMock.getMatchVotes.mockReturnValue(voteMap);
    helperMock.getMatchDay.mockReturnValue('2026-06-14');

    const send = jest.fn().mockResolvedValue();
    const channel = makeChannel({ send });
    const client = makeClient(channel);

    await calculateMatches([match], client);
    expect(send).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// updateGroupStandings — skips when already updated in fresh data
// ---------------------------------------------------------------------------

describe('updateGroupStandings — already updated in DB', () => {
  test('skips when fresh DB copy shows groupUpdated=true', async () => {
    const match = { id: 10, home: 'X', away: 'Y', result: { home: 1, away: 0 }, hasResult: true };
    const freshMatch = { ...match, groupUpdated: true };
    firebaseMock.readTournamentData.mockResolvedValueOnce([freshMatch]);

    await updateGroupStandings(match);
    expect(firebaseMock.updateGroupTeam).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// matchPostJob — playoff match resolution
// ---------------------------------------------------------------------------

describe('matchPostJob — playoff match with bracket codes', () => {
  test('skips posting playoff match when bracket cannot be resolved', async () => {
    const getOnTick = captureOnTick();
    const send = jest.fn().mockResolvedValue({ id: 'newMsg' });
    const channel = { send, messages: undefined };
    const client = makeClient(channel);
    matchPostJob(client);
    const onTick = getOnTick();

    const soon = new Date(Date.now() + 60_000).toISOString();
    const allMatches = [
      { id: 73, home: '1A', away: '2B', date: soon, messageId: null, location: 'Stadium' },
    ];
    firebaseMock.readTournamentData.mockResolvedValue(allMatches);
    firebaseMock.readTournamentConfig.mockResolvedValue({ channelId: 'ch1', name: 'WC' });
    // groups data returns null → can't resolve bracket
    firebaseMock.readTournamentData.mockImplementation((path) => {
      if (path === 'groups') return Promise.resolve(null);
      return Promise.resolve(allMatches);
    });

    await onTick();
    expect(send).not.toHaveBeenCalled();
  });

  test('posts playoff match when bracket resolves successfully', async () => {
    const getOnTick = captureOnTick();
    const send = jest.fn().mockResolvedValue({ id: 'playoffMsg' });
    const channel = { send, messages: undefined };
    const client = makeClient(channel);
    matchPostJob(client);
    const onTick = getOnTick();

    const soon = new Date(Date.now() + 60_000).toISOString();
    const allMatches = [
      { id: 73, home: '1A', away: '2B', date: soon, messageId: null, location: 'Stadium' },
    ];

    const groups = {
      a: {
        Brazil: { played: 3, won: 3, drawn: 0, lost: 0, for: 9, against: 1, goalDifference: 8, points: 9 },
        Argentina: { played: 3, won: 2, drawn: 0, lost: 1, for: 6, against: 3, goalDifference: 3, points: 6 },
        Colombia: { played: 3, won: 1, drawn: 0, lost: 2, for: 3, against: 6, goalDifference: -3, points: 3 },
        Uruguay: { played: 3, won: 0, drawn: 0, lost: 3, for: 1, against: 9, goalDifference: -8, points: 0 },
      },
      b: {
        France: { played: 3, won: 3, drawn: 0, lost: 0, for: 9, against: 1, goalDifference: 8, points: 9 },
        Spain: { played: 3, won: 2, drawn: 0, lost: 1, for: 6, against: 3, goalDifference: 3, points: 6 },
        England: { played: 3, won: 1, drawn: 0, lost: 2, for: 3, against: 6, goalDifference: -3, points: 3 },
        Germany: { played: 3, won: 0, drawn: 0, lost: 3, for: 1, against: 9, goalDifference: -8, points: 0 },
      },
    };

    firebaseMock.readTournamentData.mockImplementation((path) => {
      if (path === 'groups') return Promise.resolve(groups);
      return Promise.resolve(allMatches);
    });
    firebaseMock.readTournamentConfig.mockResolvedValue({ channelId: 'ch1', name: 'WC' });
    firebaseMock.updateMatch.mockResolvedValue();

    await onTick();
    expect(send).toHaveBeenCalled();
    expect(firebaseMock.updateMatch).toHaveBeenCalledWith(72, expect.objectContaining({ messageId: 'playoffMsg' }));
  });
});
