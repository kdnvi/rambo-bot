import { jest } from '@jest/globals';

// Import logger before setting up env so the module initialises normally
const logger = (await import('./logger.js')).default;
const { discordTransport } = await import('./logger.js');

beforeEach(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
  discordTransport.setClient(null);
});

describe('logger', () => {
  test('info logs to console.log', () => {
    logger.info('test info');
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('info: test info'));
  });

  test('warn logs to console.log', () => {
    logger.warn('test warn');
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('warn: test warn'));
  });

  test('error logs to console.error', () => {
    logger.error('test error');
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('error: test error'));
  });

  test('debug logs to console.log', () => {
    logger.debug('test debug');
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('debug: test debug'));
  });

  test('log output contains ISO-style timestamp prefix', () => {
    logger.info('timestamp check');
    const call = console.log.mock.calls[0][0];
    expect(call).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/);
  });
});

describe('discordTransport', () => {
  test('setClient stores client and attempts flush', async () => {
    const send = jest.fn().mockResolvedValue();
    const fetch = jest.fn().mockResolvedValue({ send });
    const client = { channels: { fetch } };

    process.env.DEV_CHANNEL_ID = 'dev123';
    logger.warn('queued message');
    discordTransport.setClient(client);

    // Allow microtasks to flush
    await new Promise((r) => setTimeout(r, 10));
    expect(fetch).toHaveBeenCalledWith('dev123');
    expect(send).toHaveBeenCalled();

    delete process.env.DEV_CHANNEL_ID;
  });

  test('setClient with no DEV_CHANNEL_ID does not attempt send', async () => {
    delete process.env.DEV_CHANNEL_ID;
    const send = jest.fn();
    const fetch = jest.fn().mockResolvedValue({ send });
    const client = { channels: { fetch } };

    logger.error('another queued message');
    discordTransport.setClient(client);
    await new Promise((r) => setTimeout(r, 10));
    expect(send).not.toHaveBeenCalled();
  });
});
