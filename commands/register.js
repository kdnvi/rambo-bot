import { SlashCommandBuilder } from 'discord.js';
import { registerPlayer } from '../utils/firebase.js';
import logger from '../utils/logger.js';

export const data = new SlashCommandBuilder()
  .setName('register')
  .setDescription('Join the current tournament');

export async function execute(interaction) {
  try {
    const msg = await registerPlayer(interaction.user.id);
    interaction.reply(msg);
  } catch (err) {
    logger.error(err);
  }
}
