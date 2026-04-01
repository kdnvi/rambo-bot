import { SlashCommandBuilder } from 'discord.js';
import { readTournamentConfig } from '../utils/firebase.js';
import logger from '../utils/logger.js';

export const data = new SlashCommandBuilder()
  .setName('rule')
  .setDescription('Rules for the current tournament');

export async function execute(interaction) {
  try {
    const config = await readTournamentConfig();
    const rulesText = config?.rulesText;
    if (rulesText) {
      await interaction.reply(rulesText);
    } else {
      await interaction.reply('No rules have been configured for this tournament yet.');
    }
  } catch (err) {
    logger.error(err);
  }
}
