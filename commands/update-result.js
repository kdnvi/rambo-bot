import { SlashCommandBuilder } from 'discord.js';
import { updateMatchResult } from '../utils/firebase.js';
import logger from '../utils/logger.js';

export const data = new SlashCommandBuilder()
  .setName('update-result')
  .setDescription('Update result of a specific match')
  .addIntegerOption(option => option.setName('match-id')
    .setDescription('Match ID')
    .setRequired(true))
  .addIntegerOption(option => option.setName('home-score')
    .setDescription('Home score')
    .setRequired(true))
  .addIntegerOption(option => option.setName('away-score')
    .setDescription('Away score')
    .setRequired(true));

export async function execute(interaction) {
  try {
    const matchId = parseInt(interaction.options.get('match-id').value) - 1;
    const homeScore = interaction.options.get('home-score').value;
    const awayScore = interaction.options.get('away-score').value;

    const msg = await updateMatchResult(matchId, homeScore, awayScore);
    interaction.reply(msg);
  } catch (err) {
    logger.error(err);
  }
}
