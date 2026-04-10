import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import { readCurses, setCurse, setCurseMessageId } from '../utils/firebase.js';
import { requirePlayer, requireMatches, withErrorHandler } from '../utils/command.js';
import { pickLine } from '../utils/flavor.js';
import { findNextMatch } from '../utils/helper.js';

export const data = new SlashCommandBuilder()
  .setName('curse')
  .setDescription('Nguyền một người ở trận tới — người đó sai thì bạn ăn 5 điểm!')
  .addUserOption(option => option.setName('player')
    .setDescription('Chọn nạn nhân')
    .setRequired(true));

const pendingUsers = new Set();

export const execute = withErrorHandler(async (interaction) => {
  const curserId = interaction.user.id;
  const target = interaction.options.get('player').user;

  if (target.id === curserId) {
    const embed = new EmbedBuilder()
      .setTitle('🪞  Tự nguyền mình?')
      .setDescription('Tự nguyền bản thân? Đó gọi là trầm cảm, không phải bùa chú.')
      .setColor(0xFEE75C);
    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    return;
  }

  if (pendingUsers.has(curserId)) {
    await interaction.reply({ content: '⏳ Đang xử lý, đợi xíu...', flags: MessageFlags.Ephemeral });
    return;
  }
  pendingUsers.add(curserId);

  try {
    const players = await requirePlayer(interaction, curserId);
    if (!players) return;
    if (!players[target.id]) {
      await interaction.reply({ content: '❌ Người chơi đó chưa đăng ký.', flags: MessageFlags.Ephemeral });
      return;
    }

    const allMatches = await requireMatches(interaction);
    if (!allMatches) return;

    const nextMatch = findNextMatch(allMatches);
    if (!nextMatch) {
      await interaction.reply({ content: '❌ Không có trận đấu sắp tới để nguyền.', flags: MessageFlags.Ephemeral });
      return;
    }

    const matchId = nextMatch.id;
    const match = nextMatch;

    const curses = await readCurses();
    if (curses[matchId]?.[curserId]) {
      const existing = curses[matchId][curserId];
      const existingName = interaction.client.cachedUsers?.[existing.target]?.nickname || existing.target;
      const embed = new EmbedBuilder()
        .setTitle('⚠️  Đã nguyền rồi')
        .setDescription(`Nguyền **${existingName}** ở Trận #${matchId} rồi. Đợi kết quả xong hãy nguyền tiếp.`)
        .setColor(0xFEE75C);
      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      return;
    }

    await setCurse(curserId, target.id, matchId);

    const users = interaction.client.cachedUsers;
    const targetName = users[target.id]?.nickname || target.displayName;
    const curseLine = await pickLine('curse');

    const embed = new EmbedBuilder()
      .setTitle('🧿  LỜI NGUYỀN KÍCH HOẠT')
      .setDescription(
        `**${interaction.user}** ${curseLine} **${targetName}**!\n\n` +
        `⚽ **Trận #${matchId}:** ${match.home.toUpperCase()} vs ${match.away.toUpperCase()}\n\n` +
        `**${targetName}** đoán sai → bạn ăn **5 điểm** của **${targetName}**.\n` +
        `**${targetName}** đoán đúng → bạn mất **5 điểm** cho **${targetName}**.\n\n` +
        '*Chọn người cho kỹ nha...*'
      )
      .setColor(0x9B59B6)
      .setThumbnail(target.displayAvatarURL())
      .setTimestamp();

    const sent = await interaction.reply({ embeds: [embed], fetchReply: true });
    await setCurseMessageId(curserId, matchId, sent.id);
  } finally {
    pendingUsers.delete(curserId);
  }
});
