import { jest } from '@jest/globals';

jest.unstable_mockModule('./firebase.js', () => ({
  readMatchVotes: jest.fn(),
  readTournamentConfig: jest.fn(),
}));

jest.unstable_mockModule('./logger.js', () => ({
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

jest.unstable_mockModule('cron', () => ({
  CronJob: { from: jest.fn().mockReturnValue({ stop: jest.fn() }) },
}));

const mockSetFooter = jest.fn().mockReturnThis();
const mockSetDescription = jest.fn().mockReturnThis();
const mockEmbedInstance = { setFooter: mockSetFooter, setDescription: mockSetDescription };

jest.unstable_mockModule('discord.js', () => ({
  EmbedBuilder: Object.assign(
    jest.fn().mockImplementation(() => mockEmbedInstance),
    { from: jest.fn().mockReturnValue(mockEmbedInstance) },
  ),
}));

const {
  getWinner, pick, getMatchDay, getMatchVote, getMatchVotes,
  findNextMatch, buildPollEmbedUpdate, VND_FORMATTER,
  updatePollEmbed, fetchDiscordUsers, syncDiscordUsersJob,
} = await import('./helper.js');

const { readMatchVotes, readTournamentConfig } = await import('./firebase.js');
const logger = (await import('./logger.js')).default;
const { CronJob } = await import('cron');

beforeEach(() => {
  jest.clearAllMocks();
  mockSetFooter.mockReturnThis();
  mockSetDescription.mockReturnThis();
});

describe('getWinner', () => {
  test('returns null when no result', () => {
    expect(getWinner({})).toBeNull();
  });

  test('returns home when home score greater', () => {
    expect(getWinner({ home: 'Brazil', away: 'Argentina', result: { home: 2, away: 1 } })).toBe('Brazil');
  });

  test('returns away when away score greater', () => {
    expect(getWinner({ home: 'Brazil', away: 'Argentina', result: { home: 0, away: 1 } })).toBe('Argentina');
  });

  test('returns draw when scores equal', () => {
    expect(getWinner({ home: 'Brazil', away: 'Argentina', result: { home: 1, away: 1 } })).toBe('draw');
  });
});

describe('pick', () => {
  test('returns an element from the array', () => {
    const arr = [1, 2, 3, 4, 5];
    expect(arr).toContain(pick(arr));
  });

  test('returns the only element from single-item array', () => {
    expect(pick(['only'])).toBe('only');
  });

  test('returns element within bounds for large array', () => {
    const arr = Array.from({ length: 100 }, (_, i) => i);
    const result = pick(arr);
    expect(result).toBeGreaterThanOrEqual(0);
    expect(result).toBeLessThan(100);
  });
});

describe('getMatchDay', () => {
  test('returns YYYY-MM-DD format', () => {
    expect(getMatchDay('2026-06-14T17:00:00Z')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test('returns correct date in VN timezone (UTC+7)', () => {
    expect(getMatchDay('2026-06-14T00:00:00Z')).toBe('2026-06-14');
  });
});

describe('getMatchVote', () => {
  const votes = {
    '0': {
      msg1: {
        user1: { vote: 'Brazil' },
        user2: { vote: 'draw' },
      },
    },
  };

  test('returns null when votes is null', () => {
    expect(getMatchVote(null, '0', 'msg1', 'user1')).toBeNull();
  });

  test('returns null when matchIndex not in votes', () => {
    expect(getMatchVote(votes, '99', 'msg1', 'user1')).toBeNull();
  });

  test('returns null when messageId is null', () => {
    expect(getMatchVote(votes, '0', null, 'user1')).toBeNull();
  });

  test('returns null when messageId not found', () => {
    expect(getMatchVote(votes, '0', 'msg99', 'user1')).toBeNull();
  });

  test('returns the user vote', () => {
    expect(getMatchVote(votes, '0', 'msg1', 'user1')).toBe('Brazil');
  });

  test('returns null for unknown user', () => {
    expect(getMatchVote(votes, '0', 'msg1', 'unknownUser')).toBeNull();
  });
});

describe('getMatchVotes', () => {
  const votes = {
    '0': { msg1: { user1: { vote: 'Brazil' } } },
  };

  test('returns null when votes is null', () => {
    expect(getMatchVotes(null, '0', 'msg1')).toBeNull();
  });

  test('returns null when matchIndex not present', () => {
    expect(getMatchVotes(votes, '99', 'msg1')).toBeNull();
  });

  test('returns null when messageId not present', () => {
    expect(getMatchVotes(votes, '0', 'msg99')).toBeNull();
  });

  test('returns the votes object for the message', () => {
    expect(getMatchVotes(votes, '0', 'msg1')).toEqual({ user1: { vote: 'Brazil' } });
  });
});

describe('findNextMatch', () => {
  const future1 = new Date(Date.now() + 3_600_000).toISOString();
  const future2 = new Date(Date.now() + 7_200_000).toISOString();
  const past = new Date(Date.now() - 3_600_000).toISOString();

  test('returns null when all matches are in the past', () => {
    expect(findNextMatch([{ date: past, hasResult: false }])).toBeNull();
  });

  test('returns null when all future matches have results', () => {
    expect(findNextMatch([{ date: future1, hasResult: true }])).toBeNull();
  });

  test('returns the soonest upcoming match without result', () => {
    const matches = [
      { id: 2, date: future2, hasResult: false },
      { id: 1, date: future1, hasResult: false },
    ];
    expect(findNextMatch(matches).id).toBe(1);
  });

  test('skips matches with results', () => {
    const matches = [
      { id: 1, date: future1, hasResult: true },
      { id: 2, date: future2, hasResult: false },
    ];
    expect(findNextMatch(matches).id).toBe(2);
  });
});

describe('VND_FORMATTER', () => {
  test('formats number as VND currency with thousands separator and symbol', () => {
    const result = VND_FORMATTER.format(1000);
    expect(result).toContain('1.000');
    expect(result).toContain('₫');
  });
});

describe('buildPollEmbedUpdate', () => {
  test('shows correct vote count and percentage in footer/description', () => {
    const match = { home: 'Brazil', away: 'Argentina' };
    const votes = {
      u1: { vote: 'Brazil' },
      u2: { vote: 'Brazil' },
      u3: { vote: 'draw' },
      u4: { vote: 'Argentina' },
    };

    buildPollEmbedUpdate({ description: 'Base desc' }, match, votes);

    expect(mockSetFooter).toHaveBeenCalledWith(
      expect.objectContaining({ text: expect.stringContaining('4 vote') }),
    );
    expect(mockSetDescription).toHaveBeenCalledWith(expect.stringContaining('50%'));
  });

  test('handles null votes — shows 0 votes in footer', () => {
    buildPollEmbedUpdate({ description: 'Base desc' }, { home: 'Brazil', away: 'Argentina' }, null);

    expect(mockSetFooter).toHaveBeenCalledWith(
      expect.objectContaining({ text: expect.stringContaining('0 vote') }),
    );
  });

  test('preserves base description before separator', () => {
    const match = { home: 'Brazil', away: 'Argentina' };
    buildPollEmbedUpdate({ description: 'Base desc\n\n📊 Old stats' }, match, {});

    const call = mockSetDescription.mock.calls[0][0];
    expect(call).toMatch(/^Base desc/);
  });
});

describe('updatePollEmbed', () => {
  test('fetches channel/message, reads votes, and edits the message', async () => {
    const votes = { u1: { vote: 'Brazil' } };
    readTournamentConfig.mockResolvedValue({ channelId: 'ch1' });
    readMatchVotes.mockResolvedValue(votes);

    const edit = jest.fn().mockResolvedValue();
    const pollMessage = { embeds: [{ description: 'desc' }], edit };
    const messages = { fetch: jest.fn().mockResolvedValue(pollMessage) };
    const channel = { messages };
    const client = { channels: { fetch: jest.fn().mockResolvedValue(channel) } };

    await updatePollEmbed(client, { id: 1, messageId: 'msg1', home: 'Brazil', away: 'Argentina' });

    expect(client.channels.fetch).toHaveBeenCalledWith('ch1');
    expect(messages.fetch).toHaveBeenCalledWith('msg1');
    expect(readMatchVotes).toHaveBeenCalledWith(1, 'msg1');
    expect(edit).toHaveBeenCalled();
  });

  test('falls back to FOOTBALL_CHANNEL_ID env var when config has no channelId', async () => {
    readTournamentConfig.mockResolvedValue({});
    readMatchVotes.mockResolvedValue(null);
    process.env.FOOTBALL_CHANNEL_ID = 'env_ch';

    const edit = jest.fn().mockResolvedValue();
    const pollMessage = { embeds: [{ description: 'desc' }], edit };
    const messages = { fetch: jest.fn().mockResolvedValue(pollMessage) };
    const client = { channels: { fetch: jest.fn().mockResolvedValue({ messages }) } };

    await updatePollEmbed(client, { id: 2, messageId: 'msg2', home: 'A', away: 'B' });
    expect(client.channels.fetch).toHaveBeenCalledWith('env_ch');
    delete process.env.FOOTBALL_CHANNEL_ID;
  });
});

describe('fetchDiscordUsers', () => {
  test('returns empty object when AUDITED_USERS is empty', async () => {
    delete process.env.AUDITED_USERS;
    const guild = { members: { fetch: jest.fn() } };
    const client = { guilds: { fetch: jest.fn().mockResolvedValue(guild) } };
    const result = await fetchDiscordUsers(client);
    expect(result).toEqual({});
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('AUDITED_USERS is empty'));
  });

  test('returns mapped members when users are found', async () => {
    process.env.GUILD_ID = 'guild1';
    process.env.AUDITED_USERS = 'u1,u2';

    const guildMembers = new Map([
      ['u1', { user: { id: 'u1', username: 'alice', globalName: 'Alice' }, nickname: 'ali', displayAvatarURL: () => 'https://cdn/u1.png' }],
      ['u2', { user: { id: 'u2', username: 'bob', globalName: 'Bob' }, nickname: null, displayAvatarURL: () => 'https://cdn/u2.png' }],
    ]);

    const guild = { members: { fetch: jest.fn().mockResolvedValue(guildMembers) } };
    const client = { guilds: { fetch: jest.fn().mockResolvedValue(guild) } };

    const result = await fetchDiscordUsers(client);
    expect(result.u1).toMatchObject({ id: 'u1', username: 'alice', nickname: 'ali' });
    expect(result.u2).toMatchObject({ id: 'u2', username: 'bob' });

    delete process.env.GUILD_ID;
    delete process.env.AUDITED_USERS;
  });

  test('returns empty object and logs error when guild fetch throws', async () => {
    process.env.GUILD_ID = 'guild1';
    process.env.AUDITED_USERS = 'u1';
    const client = { guilds: { fetch: jest.fn().mockRejectedValue(new Error('forbidden')) } };

    const result = await fetchDiscordUsers(client);
    expect(result).toEqual({});
    expect(logger.error).toHaveBeenCalled();

    delete process.env.GUILD_ID;
    delete process.env.AUDITED_USERS;
  });
});

describe('syncDiscordUsersJob', () => {
  test('creates a CronJob', () => {
    syncDiscordUsersJob({});
    expect(CronJob.from).toHaveBeenCalled();
  });

  test('onTick updates client.cachedUsers via fetchDiscordUsers', async () => {
    let capturedOnTick;
    CronJob.from.mockImplementationOnce(({ onTick }) => {
      capturedOnTick = onTick;
      return { stop: jest.fn() };
    });

    process.env.GUILD_ID = 'g1';
    process.env.AUDITED_USERS = 'u1';
    const guildMembers = new Map([
      ['u1', { user: { id: 'u1', username: 'alice', globalName: 'Alice' }, nickname: 'ali', displayAvatarURL: () => 'url' }],
    ]);
    const guild = { members: { fetch: jest.fn().mockResolvedValue(guildMembers) } };
    const client = { guilds: { fetch: jest.fn().mockResolvedValue(guild) }, cachedUsers: {} };

    syncDiscordUsersJob(client);
    await capturedOnTick();

    expect(client.cachedUsers.u1).toMatchObject({ username: 'alice' });
    delete process.env.GUILD_ID;
    delete process.env.AUDITED_USERS;
  });
});
