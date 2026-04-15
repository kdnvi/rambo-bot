import { jest } from '@jest/globals';

jest.unstable_mockModule('./logger.js', () => ({
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const logger = (await import('./logger.js')).default;
const { notifyDev } = await import('./notify.js');

beforeEach(() => jest.clearAllMocks());

describe('notifyDev', () => {
  test('warns and returns early when DEV_CHANNEL_ID is not set', async () => {
    delete process.env.DEV_CHANNEL_ID;
    const client = { channels: { fetch: jest.fn() } };
    await notifyDev(client, 'start');
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('DEV_CHANNEL_ID not set'));
    expect(client.channels.fetch).not.toHaveBeenCalled();
  });

  test('sends known event label to dev channel', async () => {
    process.env.DEV_CHANNEL_ID = 'dev123';
    const send = jest.fn().mockResolvedValue();
    const client = { channels: { fetch: jest.fn().mockResolvedValue({ send }) } };

    await notifyDev(client, 'start');

    expect(send).toHaveBeenCalledWith(expect.stringContaining('🟢 Bot started'));
    expect(logger.info).toHaveBeenCalled();
    delete process.env.DEV_CHANNEL_ID;
  });

  test('sends known event label for stop', async () => {
    process.env.DEV_CHANNEL_ID = 'dev123';
    const send = jest.fn().mockResolvedValue();
    const client = { channels: { fetch: jest.fn().mockResolvedValue({ send }) } };

    await notifyDev(client, 'stop');
    expect(send).toHaveBeenCalledWith(expect.stringContaining('🔴 Bot stopped'));
    delete process.env.DEV_CHANNEL_ID;
  });

  test('sends raw event string for unknown event', async () => {
    process.env.DEV_CHANNEL_ID = 'dev123';
    const send = jest.fn().mockResolvedValue();
    const client = { channels: { fetch: jest.fn().mockResolvedValue({ send }) } };

    await notifyDev(client, 'custom_event');
    expect(send).toHaveBeenCalledWith(expect.stringContaining('custom_event'));
    delete process.env.DEV_CHANNEL_ID;
  });

  test('logs error when channel fetch throws', async () => {
    process.env.DEV_CHANNEL_ID = 'dev123';
    const client = { channels: { fetch: jest.fn().mockRejectedValue(new Error('not found')) } };

    await notifyDev(client, 'start');
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('Failed to send dev notification'));
    delete process.env.DEV_CHANNEL_ID;
  });

  test('message contains a Discord timestamp', async () => {
    process.env.DEV_CHANNEL_ID = 'dev123';
    const send = jest.fn().mockResolvedValue();
    const client = { channels: { fetch: jest.fn().mockResolvedValue({ send }) } };

    await notifyDev(client, 'restart');
    const msg = send.mock.calls[0][0];
    expect(msg).toMatch(/<t:\d+:f>/);
    delete process.env.DEV_CHANNEL_ID;
  });
});
