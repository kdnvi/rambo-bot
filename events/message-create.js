import { Events } from 'discord.js';
import logger from '../utils/logger.js';

export const name = Events.MessageCreate;
export async function execute(message) {
  if (message.author.bot) return;
  // logger.debug(`Received message [${message.content}]`);
}
