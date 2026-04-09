import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import { readUserWagers, removePlayerWager } from '../utils/firebase.js';
import { requirePlayer, requireMatches, findActiveEntry, withErrorHandler } from '../utils/command.js';
import { pickLine } from '../utils/flavor.js';

export const data = new SlashCommandBuilder()
  .setName('undo-double-down')
  .setDescription('Sợ rồi hả? Huỷ double-down trước giờ đá');

export const execute = withErrorHandler(async (interaction) => {
  const userId = interaction.user.id;

  const players = await requirePlayer(interaction, userId);
  if (!players) return;

  const allMatches = await requireMatches(interaction);
  if (!allMatches) return;

  const myWagers = await readUserWagers(userId);
  const found = findActiveEntry(myWagers, allMatches, (wager) => wager.type === 'double-down');

  if (!found) {
    const embed = new EmbedBuilder()
      .setTitle('🤷  Không có Double-Down')
      .setDescription('Đang không có double-down nào để huỷ cả.')
      .setColor(0xFEE75C);
    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    return;
  }

  const activeMatchId = found.matchId;
  const activeMatch = found.match;

  await removePlayerWager(userId, activeMatchId);

  const chickenLine = await pickLine('chicken');

  const embed = new EmbedBuilder()
    .setTitle('🐔  HUỶ DOUBLE-DOWN')
    .setDescription(
      `**${interaction.user}** ${chickenLine}\n\n` +
      `⏫ Huỷ double-down Trận #${activeMatchId} ` +
      `(${activeMatch.home.toUpperCase()} vs ${activeMatch.away.toUpperCase()}).\n` +
      'Quay về mức cược bình thường.'
    )
    .setColor(0xFEE75C)
    .setTimestamp();

  await interaction.reply({ embeds: [embed] });
});
