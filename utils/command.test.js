import { jest } from '@jest/globals';

jest.unstable_mockModule('./firebase.js', () => ({
  readPlayers: jest.fn(),
  readTournamentData: jest.fn(),
  readTournamentConfig: jest.fn(),
}));

jest.unstable_mockModule('./logger.js', () => ({
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

jest.unstable_mockModule('discord.js', () => ({
  EmbedBuilder: jest.fn().mockImplementation(() => ({
    setTitle: jest.fn().mockReturnThis(),
    setDescription: jest.fn().mockReturnThis(),
    setColor: jest.fn().mockReturnThis(),
  })),
  MessageFlags: { Ephemeral: 64 },
}));

const { readPlayers, readTournamentData, readTournamentConfig } = await import('./firebase.js');
const { withErrorHandler, requirePlayer, requireMatches, getChannelId, getTournamentName, findActiveEntry } = await import('./command.js');

beforeEach(() => jest.clearAllMocks());

describe('withErrorHandler', () => {
  test('calls the wrapped function with interaction', async () => {
    const fn = jest.fn().mockResolvedValue('ok');
    const wrapped = withErrorHandler(fn);
    const interaction = {};
    await wrapped(interaction);
    expect(fn).toHaveBeenCalledWith(interaction);
  });

  test('replies with error message when fn throws and not yet replied', async () => {
    const fn = jest.fn().mockRejectedValue(new Error('boom'));
    const wrapped = withErrorHandler(fn);
    const reply = jest.fn().mockResolvedValue();
    const interaction = { replied: false, deferred: false, reply, editReply: jest.fn() };
    await wrapped(interaction);
    expect(reply).toHaveBeenCalledWith(expect.objectContaining({ content: '❌ Có lỗi xảy ra.' }));
  });

  test('edits reply when fn throws and interaction already replied', async () => {
    const fn = jest.fn().mockRejectedValue(new Error('boom'));
    const wrapped = withErrorHandler(fn);
    const editReply = jest.fn().mockResolvedValue();
    const interaction = { replied: true, deferred: false, reply: jest.fn(), editReply };
    await wrapped(interaction);
    expect(editReply).toHaveBeenCalledWith(expect.objectContaining({ content: '❌ Có lỗi xảy ra.' }));
  });

  test('edits reply when fn throws and interaction is deferred', async () => {
    const fn = jest.fn().mockRejectedValue(new Error('boom'));
    const wrapped = withErrorHandler(fn);
    const editReply = jest.fn().mockResolvedValue();
    const interaction = { replied: false, deferred: true, reply: jest.fn(), editReply };
    await wrapped(interaction);
    expect(editReply).toHaveBeenCalledWith(expect.objectContaining({ content: '❌ Có lỗi xảy ra.' }));
  });

  test('does not throw even if reply itself fails', async () => {
    const fn = jest.fn().mockRejectedValue(new Error('boom'));
    const wrapped = withErrorHandler(fn);
    const interaction = {
      replied: false,
      deferred: false,
      reply: jest.fn().mockRejectedValue(new Error('reply failed')),
      editReply: jest.fn(),
    };
    await expect(wrapped(interaction)).resolves.toBeUndefined();
  });
});

describe('requirePlayer', () => {
  test('returns players when player exists', async () => {
    readPlayers.mockResolvedValue({ user1: { points: 10 } });
    const interaction = { reply: jest.fn() };
    const result = await requirePlayer(interaction, 'user1');
    expect(result).toEqual({ user1: { points: 10 } });
    expect(interaction.reply).not.toHaveBeenCalled();
  });

  test('replies and returns null when no players data', async () => {
    readPlayers.mockResolvedValue(null);
    const interaction = { reply: jest.fn().mockResolvedValue() };
    const result = await requirePlayer(interaction, 'user1');
    expect(result).toBeNull();
    expect(interaction.reply).toHaveBeenCalled();
  });

  test('replies and returns null when player not registered', async () => {
    readPlayers.mockResolvedValue({ user2: { points: 0 } });
    const interaction = { reply: jest.fn().mockResolvedValue() };
    const result = await requirePlayer(interaction, 'user1');
    expect(result).toBeNull();
    expect(interaction.reply).toHaveBeenCalled();
  });
});

describe('requireMatches', () => {
  test('returns matches when data exists', async () => {
    readTournamentData.mockResolvedValue([{ id: 1 }]);
    const interaction = { reply: jest.fn() };
    const result = await requireMatches(interaction);
    expect(result).toEqual([{ id: 1 }]);
    expect(interaction.reply).not.toHaveBeenCalled();
  });

  test('replies and returns null when no match data', async () => {
    readTournamentData.mockResolvedValue(null);
    const interaction = { reply: jest.fn().mockResolvedValue() };
    const result = await requireMatches(interaction);
    expect(result).toBeNull();
    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('Không có dữ liệu') }),
    );
  });
});

describe('getChannelId', () => {
  test('returns channelId from config', async () => {
    readTournamentConfig.mockResolvedValue({ channelId: 'ch123' });
    expect(await getChannelId()).toBe('ch123');
  });

  test('falls back to env var when config has no channelId', async () => {
    readTournamentConfig.mockResolvedValue({});
    process.env.FOOTBALL_CHANNEL_ID = 'env_ch';
    expect(await getChannelId()).toBe('env_ch');
    delete process.env.FOOTBALL_CHANNEL_ID;
  });

  test('falls back to env var when config is null', async () => {
    readTournamentConfig.mockResolvedValue(null);
    process.env.FOOTBALL_CHANNEL_ID = 'env_ch2';
    expect(await getChannelId()).toBe('env_ch2');
    delete process.env.FOOTBALL_CHANNEL_ID;
  });
});

describe('getTournamentName', () => {
  test('returns name from config', async () => {
    readTournamentConfig.mockResolvedValue({ name: 'World Cup 2026' });
    expect(await getTournamentName()).toBe('World Cup 2026');
  });

  test('defaults to "Tournament" when config has no name', async () => {
    readTournamentConfig.mockResolvedValue({});
    expect(await getTournamentName()).toBe('Tournament');
  });

  test('defaults to "Tournament" when config is null', async () => {
    readTournamentConfig.mockResolvedValue(null);
    expect(await getTournamentName()).toBe('Tournament');
  });
});

describe('findActiveEntry', () => {
  const future = new Date(Date.now() + 3_600_000).toISOString();
  const past = new Date(Date.now() - 3_600_000).toISOString();

  const allMatches = [
    { id: 1, date: future },
    { id: 2, date: past },
  ];

  test('returns matching entry for future match', () => {
    const entries = { 1: { doubleDown: true }, 2: { doubleDown: true } };
    const result = findActiveEntry(entries, allMatches, (e) => e.doubleDown);
    expect(result).toMatchObject({ matchId: 1 });
  });

  test('returns null when no entries pass filter', () => {
    const entries = { 1: { doubleDown: false } };
    const result = findActiveEntry(entries, allMatches, (e) => e.doubleDown);
    expect(result).toBeNull();
  });

  test('returns null when matching match is in the past', () => {
    const entries = { 2: { doubleDown: true } };
    const result = findActiveEntry(entries, allMatches, (e) => e.doubleDown);
    expect(result).toBeNull();
  });

  test('returns null when matchId not found in allMatches', () => {
    const entries = { 99: { doubleDown: true } };
    const result = findActiveEntry(entries, allMatches, (e) => e.doubleDown);
    expect(result).toBeNull();
  });

  test('returns entry object with matchId, match, and entry', () => {
    const entries = { 1: { random: true } };
    const result = findActiveEntry(entries, allMatches, () => true);
    expect(result.matchId).toBe(1);
    expect(result.match).toEqual(allMatches[0]);
    expect(result.entry).toEqual({ random: true });
  });
});
