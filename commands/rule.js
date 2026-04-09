import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import { readTournamentConfig } from '../utils/firebase.js';
import logger from '../utils/logger.js';

export const data = new SlashCommandBuilder()
  .setName('rule')
  .setDescription('Luật chơi — đọc đi rồi đừng có kêu không biết');

export async function execute(interaction) {
  try {
    const config = await readTournamentConfig();
    const tournamentName = config?.name || 'Tournament';
    const rulesText = config?.rulesText;

    const embed = new EmbedBuilder()
      .setTitle(`📋  ${tournamentName} — Luật chơi`)
      .setColor(0x5865F2)
      .setTimestamp();

    if (rulesText) {
      embed.setDescription(rulesText.replace(/\\n/g, '\n'));
    } else {
      embed
        .setDescription('Chưa có luật chơi cho giải này.')
        .setColor(0xFEE75C);
    }

    await interaction.reply({ embeds: [embed] });
  } catch (err) {
    logger.error(err);
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({ content: '❌ Không thể tải luật chơi.', flags: MessageFlags.Ephemeral }).catch(() => {});
    }
  }
}
