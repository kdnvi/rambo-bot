import { SlashCommandBuilder } from 'discord.js';
import { updatePlayerInfo } from '../utils/firebase.js';
import logger from '../utils/logger.js';

export const data = new SlashCommandBuilder()
  .setName('euro-register')
  .setDescription('Join Euro 2024 event');

export async function execute(interaction) {
  try {
    const msg = await updatePlayerInfo(interaction.user.id);
    interaction.reply(msg);
  } catch (err) {
    logger.error(err);
  }
}
