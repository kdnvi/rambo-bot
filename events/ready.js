import { Events } from 'discord.js';
import logger from '../utils/logger.js';
import { fetchDiscordUsers, syncDiscordUsersJob } from '../utils/helper.js';
import { dailyMatchPostJob, dailyCalculatingJob } from '../utils/football.js';

export const name = Events.ClientReady;
export const once = true;
export async function execute(client) {
  logger.info(`Ready! Logged in as ${client.user.tag}`);

  logger.info('Starting daily match post job');
  dailyMatchPostJob(client);

  logger.info('Starting daily calculating job');
  dailyCalculatingJob();

  logger.info('Pre-fetch audited users');
  client.cachedUsers = await fetchDiscordUsers(client);

  logger.info('Starting sync Discord users job');
  syncDiscordUsersJob(client);
}
