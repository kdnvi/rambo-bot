import { SlashCommandBuilder, EmbedBuilder, MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { readUserWagers, setPlayerWager, readMatchVotes, removeMatchVote, readTournamentData } from '../utils/firebase.js';
import { findNextMatch, updatePollEmbed } from '../utils/helper.js';
import { withErrorHandler, requirePlayer, requireMatches } from '../utils/command.js';
import { pickLine } from '../utils/flavor.js';

export const data = new SlashCommandBuilder()
  .setName('random')
  .setDescription('Giao số phận cho ông trời — random thay vì bị gán đội ít vote nhất');

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
    const myWagers = await readUserWagers(userId);

    if (myWagers[matchId]?.random) {
      const embed = new EmbedBuilder()
        .setTitle('⚠️  Đã kích hoạt rồi')
        .setDescription(`Random đã bật cho trận \`#${matchId}\` rồi. Nằm chờ số phận thôi!`)
        .setColor(0xFEE75C);
      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      return;
    }

    if (match.messageId) {
      const votes = await readMatchVotes(matchId, match.messageId);
      if (votes && votes[userId]) {
        const currentVote = votes[userId].vote;
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`random-confirm|${matchId}`)
            .setLabel('Xoá vote & random')
            .setStyle(ButtonStyle.Danger),
          new ButtonBuilder()
            .setCustomId('random-cancel')
            .setLabel('Giữ vote')
            .setStyle(ButtonStyle.Secondary),
        );

        const embed = new EmbedBuilder()
          .setTitle('⚠️  Bạn đã vote rồi')
          .setDescription(
            `Bạn đang chọn **${currentVote.toUpperCase()}** cho trận \`#${matchId}\`.\n\n` +
            'Kích hoạt random sẽ **xoá vote** hiện tại. Chắc chưa?',
          )
          .setColor(0xFEE75C);

        await interaction.reply({ embeds: [embed], components: [row], flags: MessageFlags.Ephemeral });
        return;
      }
    }

    await activateRandom(interaction, match);
  } finally {
    pendingUsers.delete(userId);
  }
});

const pendingConfirms = new Set();

export const handleRandomButton = withErrorHandler(async (interaction) => {
  if (interaction.customId === 'random-cancel') {
    const embed = new EmbedBuilder()
      .setDescription('👍 Giữ nguyên vote. Không random.')
      .setColor(0x57F287);
    await interaction.update({ embeds: [embed], components: [] });
    return;
  }

  const userId = interaction.user.id;
  if (pendingConfirms.has(userId)) {
    return;
  }
  pendingConfirms.add(userId);

  try {
    await interaction.deferUpdate();

    const [, matchIdStr] = interaction.customId.split('|');
    const matchId = parseInt(matchIdStr);

    const allMatches = await readTournamentData('matches');
    if (!allMatches) {
      await interaction.editReply({ content: '❌ Không có dữ liệu trận đấu.', embeds: [], components: [] });
      return;
    }

    const match = allMatches.find((m) => m.id === matchId);
    if (!match || Date.parse(match.date) < Date.now()) {
      await interaction.editReply({ content: '⏰ Trận đã bắt đầu hoặc không tìm thấy.', embeds: [], components: [] });
      return;
    }

    if (match.messageId) {
      await removeMatchVote(matchId, interaction.user.id, match.messageId);
      await updatePollEmbed(interaction.client, match);
    }

    await activateRandom(interaction, match, true);
  } finally {
    pendingConfirms.delete(userId);
  }
});

async function activateRandom(interaction, match, isUpdate = false) {
  await setPlayerWager(interaction.user.id, match.id, 'random');

  const randomLine = await pickLine('random');

  const embed = new EmbedBuilder()
    .setTitle('🎲  RANDOM!')
    .setDescription(
      `**${interaction.user}** ${randomLine}\n\n` +
      `⚽ **Trận #${match.id}:** ${match.home.toUpperCase()} vs ${match.away.toUpperCase()}\n\n` +
      '🎲 Nếu không vote trước giờ đá, hệ thống sẽ **random** thay vì gán đội ít vote nhất.',
    )
    .setColor(0x9B59B6)
    .setThumbnail(interaction.user.displayAvatarURL())
    .setTimestamp();

  if (isUpdate) {
    const doneEmbed = new EmbedBuilder()
      .setDescription('✅ Đã xoá vote và kích hoạt random.')
      .setColor(0x57F287);
    await interaction.editReply({ embeds: [doneEmbed], components: [] });
    await interaction.followUp({ embeds: [embed] });
  } else {
    await interaction.reply({ embeds: [embed] });
  }
}

