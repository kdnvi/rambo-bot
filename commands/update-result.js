import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
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

    const result = await updateMatchResult(matchId, homeScore, awayScore);

    if (!result.success) {
      const embed = new EmbedBuilder().setTimestamp();

      if (result.error === 'not_found') {
        embed
          .setTitle('❌  Match Not Found')
          .setDescription(`No match found with ID \`${matchId + 1}\`.`)
          .setColor(0xED4245);
      } else if (result.error === 'already_exists') {
        const m = result.match;
        embed
          .setTitle('⚠️  Result Already Exists')
          .setDescription(`**${m.home.toUpperCase()}** ${m.result.home} - ${m.result.away} **${m.away.toUpperCase()}**`)
          .setColor(0xFEE75C);
      }

      interaction.reply({ embeds: [embed], ephemeral: true });
      return;
    }

    const m = result.match;
    const embed = new EmbedBuilder()
      .setTitle('✅  Match Result Updated')
      .setDescription(`**${m.home.toUpperCase()}** ${homeScore} - ${awayScore} **${m.away.toUpperCase()}**`)
      .setColor(0x57F287)
      .addFields(
        { name: '🏟️ Location', value: m.location, inline: true },
        { name: '🆔 Match ID', value: `${matchId + 1}`, inline: true },
      )
      .setFooter({ text: `Updated by ${interaction.user.displayName}` })
      .setTimestamp();

    interaction.reply({ embeds: [embed] });
  } catch (err) {
    logger.error(err);
    interaction.reply({ content: '❌ Failed to update the match result.', ephemeral: true });
  }
}
