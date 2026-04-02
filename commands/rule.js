import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { readTournamentConfig } from '../utils/firebase.js';
import logger from '../utils/logger.js';

export const data = new SlashCommandBuilder()
  .setName('rule')
  .setDescription('Rules for the current tournament');

export async function execute(interaction) {
  try {
    const config = await readTournamentConfig();
    const tournamentName = config?.name || 'Tournament';
    const rulesText = config?.rulesText;

    const embed = new EmbedBuilder()
      .setTitle(`📋  ${tournamentName} — Rules`)
      .setColor(0x5865F2)
      .setTimestamp();

    if (rulesText) {
      embed.setDescription(rulesText);
    } else {
      embed
        .setDescription('No rules have been configured for this tournament yet.')
        .setColor(0xFEE75C);
    }

    await interaction.reply({ embeds: [embed] });
  } catch (err) {
    logger.error(err);
    await interaction.reply({ content: '❌ Failed to load tournament rules.', ephemeral: true });
  }
}
