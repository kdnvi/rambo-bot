import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import { readUserWagers, setPlayerWager } from '../utils/firebase.js';
import { requirePlayer, requireMatches, withErrorHandler } from '../utils/command.js';
import { pickLine } from '../utils/flavor.js';
import { getMatchStake } from '../utils/football.js';
import { findNextMatch, getMatchDay } from '../utils/helper.js';

export const data = new SlashCommandBuilder()
  .setName('double-down')
  .setDescription('Nhân đôi cược — gan thì bấm, mỗi ngày 1 lần');

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

    const match = findNextMatch(allMatches);
    if (!match) {
      await interaction.reply({ content: '❌ Không có trận nào sắp tới.', flags: MessageFlags.Ephemeral });
      return;
    }

    const matchId = match.id;

    const matchDay = getMatchDay(match.date);
    const sameDayMatchIds = allMatches
      .filter((m) => getMatchDay(m.date) === matchDay)
      .map((m) => m.id);

    const myWagers = await readUserWagers(userId);

    const alreadyThisDay = sameDayMatchIds.some((id) => myWagers[id]?.type === 'double-down');
    if (alreadyThisDay) {
      const usedId = sameDayMatchIds.find((id) => myWagers[id]?.type === 'double-down');
      const embed = new EmbedBuilder()
        .setTitle('⚠️  Đã dùng rồi')
        .setDescription(`Xài double-down cho trận \`#${usedId}\` rồi. Mỗi ngày một phát thôi, tham quá!`)
        .setColor(0xFEE75C);
      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      return;
    }

    const stake = getMatchStake(match.id);
    await setPlayerWager(userId, matchId, 'double-down');

    const hypeLine = await pickLine('hype');

    const embed = new EmbedBuilder()
      .setTitle('⏫  DOUBLE DOWN!')
      .setDescription(
        `**${interaction.user}** ${hypeLine}\n\n` +
        `⚽ **Trận #${matchId}:** ${match.home.toUpperCase()} vs ${match.away.toUpperCase()}\n` +
        `💰 Mức cược: ${stake} → **${stake * 2} pts**\n\n` +
        '✅ Đúng → **ăn gấp đôi**\n' +
        '❌ Sai → **mất gấp đôi**'
      )
      .setColor(0x57F287)
      .setThumbnail(interaction.user.displayAvatarURL())
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  } finally {
    pendingUsers.delete(userId);
  }
});
