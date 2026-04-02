import { Events } from 'discord.js';
import logger from '../utils/logger.js';
import { fetchDiscordUsers, syncDiscordUsersJob } from '../utils/helper.js';
import { matchPostJob, voteReminderJob, resultReminderJob, dailyCalculatingJob } from '../utils/football.js';

export const name = Events.ClientReady;
export const once = true;
export async function execute(client) {
  logger.info(`Ready! Logged in as ${client.user.tag}`);

  logger.info('Pre-fetch audited users');
  client.cachedUsers = await fetchDiscordUsers(client);

  logger.info('Starting match post job');
  matchPostJob(client);

  logger.info('Starting vote reminder job');
  voteReminderJob(client);

  logger.info('Starting result reminder job');
  resultReminderJob(client);

  logger.info('Starting daily calculating job');
  dailyCalculatingJob();

  logger.info('Starting sync Discord users job');
  syncDiscordUsersJob(client);
}
