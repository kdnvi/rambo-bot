import { createLogger, format as _format, transports as _transports } from 'winston';
import TransportStream from 'winston-transport';

const baseFormat = _format.combine(
  _format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  _format.errors({ stack: true }),
  _format.printf(l => `${l.timestamp} ${l.level}: ${l.message}` + (l.splat !== undefined ? `${l.splat}` : '')),
);

const MAX_QUEUE_SIZE = 50;

class DiscordTransport extends TransportStream {
  constructor(opts = {}) {
    super({ ...opts, level: 'warn' });
    this._client = null;
    this._queue = [];
    this._sending = false;
  }

  setClient(client) {
    this._client = client;
    this._flush();
  }

  log(info, callback) {
    const icon = info.level === 'error' ? '🚨' : '⚠️';
    const label = info.level.toUpperCase();
    const text = info.stack || info.message;
    const truncated = text.length > 1900 ? text.slice(0, 1900) + '…' : text;
    if (this._queue.length >= MAX_QUEUE_SIZE) {
      const dropped = this._queue.shift();
      console.warn(`[Logger] Discord queue full (${MAX_QUEUE_SIZE}), dropped oldest message: ${dropped.slice(0, 80)}…`);
    }
    this._queue.push(`${icon} **${label}** — \`${info.timestamp}\`\n\`\`\`\n${truncated}\n\`\`\``);
    this._flush();
    callback();
  }

  async _flush() {
    const channelId = process.env.DEV_CHANNEL_ID;
    if (!this._client || !channelId || this._sending || this._queue.length === 0) return;
    this._sending = true;
    try {
      const channel = await this._client.channels.fetch(channelId);
      while (this._queue.length > 0) {
        await channel.send(this._queue.shift());
      }
    } catch {
      // avoid recursive error logging
    } finally {
      this._sending = false;
    }
  }
}

export const discordTransport = new DiscordTransport();

const logger = createLogger({
  level: 'debug',
  format: baseFormat,
  transports: [
    new _transports.Console({
      format: _format.combine(_format.colorize(), baseFormat),
    }),
    new _transports.File({ filename: 'error.log', level: 'error' }),
    new _transports.File({ filename: 'combined.log' }),
    discordTransport,
  ],
});

export default logger;
