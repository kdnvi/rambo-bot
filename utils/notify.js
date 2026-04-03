import logger from './logger.js';

const LABELS = {
  start: '🟢 Bot started',
  stop: '🔴 Bot stopped',
  restart: '🟡 Bot restarting',
};

export async function notifyDev(client, event) {
  const channelId = process.env.DEV_CHANNEL_ID;
  if (!channelId) {
    logger.warn('DEV_CHANNEL_ID not set, skipping dev notification');
    return;
  }

  const label = LABELS[event] || event;
  const timestamp = Math.floor(Date.now() / 1000);
  const message = `${label} — <t:${timestamp}:f>`;

  try {
    const channel = await client.channels.fetch(channelId);
    await channel.send(message);
    logger.info(`Dev notification sent: ${label}`);
  } catch (err) {
    logger.error(`Failed to send dev notification: ${err.message}`);
  }
}
