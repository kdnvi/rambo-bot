import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import { readUserWagers, removePlayerWager, removeWagerMessageId } from '../utils/firebase.js';
import { requirePlayer, requireMatches, findActiveEntry, withErrorHandler, getChannelId } from '../utils/command.js';
import { pickLine } from '../utils/flavor.js';

export const data = new SlashCommandBuilder()
  .setName('undo-double-down')
  .setDescription('Sợ rồi hả? Huỷ double-down trước giờ đá');

const pendingUsers = new Set();

export const execute = withErrorHandler(async (interaction) => {
  const userId = interaction.user.id;

  if (pendingUsers.has(userId)) {
    await interaction.reply({ content: '⏳ Đang xử lý, đợi xíu...', flags: MessageFlags.Ephemeral });
    return;
  }
  pendingUsers.add(userId);

  try {
    const players = await requirePlayer(interaction, userId);
    if (!players) return;

    const allMatches = await requireMatches(interaction);
    if (!allMatches) return;

    const myWagers = await readUserWagers(userId);
    const found = findActiveEntry(myWagers, allMatches, (wager) => wager.doubleDown);

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
    const originalMessageId = found.entry.messageId;

    await Promise.all([
      removePlayerWager(userId, activeMatchId, 'doubleDown'),
      removeWagerMessageId(userId, activeMatchId),
    ]);

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

    if (originalMessageId) {
      try {
        const channelId = await getChannelId();
        const channel = await interaction.client.channels.fetch(channelId);
        const originalMsg = await channel.messages.fetch(originalMessageId);
        await originalMsg.reply({ embeds: [embed] });
        await interaction.reply({ content: '🐔 Đã huỷ double-down.', flags: MessageFlags.Ephemeral });
      } catch {
        await interaction.reply({ embeds: [embed] });
      }
    } else {
      await interaction.reply({ embeds: [embed] });
    }
  } finally {
    pendingUsers.delete(userId);
  }
});
