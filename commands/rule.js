import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { readTournamentConfig } from '../utils/firebase.js';
import { withErrorHandler } from '../utils/command.js';

export const data = new SlashCommandBuilder()
  .setName('rule')
  .setDescription('Luật chơi — đọc đi rồi đừng có kêu không biết');

export const execute = withErrorHandler(async (interaction) => {
  const config = await readTournamentConfig();
  const tournamentName = config?.name || 'Tournament';
  const rulesText = config?.rulesText;

  const embed = new EmbedBuilder()
    .setTitle(`📋  ${tournamentName} — Luật chơi`)
    .setColor(0x5865F2)
    .setTimestamp();

  if (rulesText) {
    let description = rulesText.replace(/\\n/g, '\n');
    if (description.length > 4096) description = description.slice(0, 4093) + '...';
    embed.setDescription(description);
  } else {
    embed
      .setDescription('Chưa có luật chơi cho giải này.')
      .setColor(0xFEE75C);
  }

  await interaction.reply({ embeds: [embed] });
});
