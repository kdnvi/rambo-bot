const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };
const CURRENT = LEVELS.debug;
const MAX_QUEUE_SIZE = 50;

function ts() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

const _queue = [];
let _client = null;
let _sending = false;

async function _flush() {
  const channelId = process.env.DEV_CHANNEL_ID;
  if (!_client || !channelId || _sending || _queue.length === 0) return;
  _sending = true;
  try {
    const channel = await _client.channels.fetch(channelId);
    while (_queue.length > 0) {
      await channel.send(_queue[0]);
      _queue.shift();
    }
  } catch {
    // avoid recursive error logging
  } finally {
    _sending = false;
  }
}

function log(level, msg) {
  if (LEVELS[level] > CURRENT) return;
  const timestamp = ts();
  const out = `${timestamp} ${level}: ${msg}`;
  if (level === 'error') console.error(out);
  else console.log(out);

  if (LEVELS[level] <= LEVELS.warn) {
    const icon = level === 'error' ? '🚨' : '⚠️';
    const text = typeof msg === 'string' ? msg : String(msg);
    const truncated = text.length > 1900 ? text.slice(0, 1900) + '…' : text;
    if (_queue.length >= MAX_QUEUE_SIZE) _queue.shift();
    _queue.push(`${icon} **${level.toUpperCase()}** — \`${timestamp}\`\n\`\`\`\n${truncated}\n\`\`\``);
    _flush();
  }
}

export const discordTransport = {
  setClient(client) {
    _client = client;
    _flush();
  },
};

export default {
  error: (m) => log('error', m),
  warn:  (m) => log('warn', m),
  info:  (m) => log('info', m),
  debug: (m) => log('debug', m),
};
