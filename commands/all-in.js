import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import { readTournamentData, readPlayers, readPlayerAllIns, readUserWagers, setPlayerAllIn } from '../utils/firebase.js';
import { pick, VND_FORMATTER, findNextMatch } from '../utils/helper.js';
import logger from '../utils/logger.js';

const HYPE_LINES = [
  'ĐIÊN RỒI! All-in luôn!',
  'Gọi cấp cứu đi — nhưng không phải cho ổng!',
  'Thiên tài hay khùng? Không có đường giữa.',
  'Sáng dậy chọn BẠO LỰC (tài chính).',
  'Huyền thoại hay hề? Chút nữa biết.',
  'Gan chi mà gan dữ vậy trời...',
  'Má mà biết chắc từ mặt luôn.',
  'Người không biết sợ là gì trông như thế này đây.',
  'Khoảnh khắc này sẽ đi vào lịch sử.',
  'Tay mồ hôi, đầu gối run, mì mẹ nấu...',
];

const BROKE_LINES = [
  'đòi all-in mà túi rỗng 💀',
  'muốn cược hết... mà "hết" bằng 0 🕳️',
  'ra vẻ đại gia mà tài khoản trống trơn 🤡',
  'vô casino không xu dính túi, bảo vệ mời ra 🚪',
  'tự tin thì dư mà tiền thì không có 📉',
];

export const data = new SlashCommandBuilder()
  .setName('all-in')
  .setDescription('Bet your ENTIRE balance on a match!');

export async function execute(interaction) {
  try {
    const userId = interaction.user.id;

    const players = (await readPlayers()).val();
    if (!players || !players[userId]) {
      const embed = new EmbedBuilder()
        .setTitle('❌  Chưa đăng ký')
        .setDescription('Bạn cần `/register` trước.')
        .setColor(0xED4245);
      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      return;
    }

    const balance = players[userId].points;
    if (balance <= 0) {
      const embed = new EmbedBuilder()
        .setTitle('💸  ALL IN BỊ TỪ CHỐI')
        .setDescription(
          `**${interaction.user}** ${pick(BROKE_LINES)}\n\nSố dư: **${VND_FORMATTER.format(balance * 1000)}**`
        )
        .setColor(0xED4245)
        .setThumbnail(interaction.user.displayAvatarURL());
      await interaction.reply({ embeds: [embed] });
      return;
    }

    const allMatches = (await readTournamentData('matches')).val();
    if (!allMatches) {
      await interaction.reply({ content: '❌ Không có dữ liệu trận đấu.', flags: MessageFlags.Ephemeral });
      return;
    }

    const match = findNextMatch(allMatches);
    if (!match) {
      await interaction.reply({ content: '❌ Không có trận nào sắp tới.', flags: MessageFlags.Ephemeral });
      return;
    }

    const matchId = match.id;

    const myWagers = await readUserWagers(userId);
    if (myWagers[matchId]?.type === 'double-down') {
      const embed = new EmbedBuilder()
        .setTitle('⚠️  Đã Double-Down rồi')
        .setDescription('Double-down rồi mà còn đòi all-in. Huỷ double-down bằng `/undo-double-down` trước đi.')
        .setColor(0xFEE75C);
      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      return;
    }

    const existing = await readPlayerAllIns(userId);
    if (existing[matchId]) {
      const embed = new EmbedBuilder()
        .setTitle('⚠️  Đã All-In rồi')
        .setDescription(`Bạn đã all-in trận này với **${VND_FORMATTER.format(existing[matchId].amount * 1000)}** rồi.`)
        .setColor(0xFEE75C);
      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      return;
    }

    await setPlayerAllIn(userId, matchId, balance);

    const embed = new EmbedBuilder()
      .setTitle('🔥  ALL IN! 🔥')
      .setDescription(
        `${pick(HYPE_LINES)}\n\n` +
        `**${interaction.user}** dồn hết **${VND_FORMATTER.format(balance * 1000)}** lên bàn!\n\n` +
        `⚽ **Trận #${matchId}:** ${match.home.toUpperCase()} vs ${match.away.toUpperCase()}\n` +
        `🎰 All-in: **${VND_FORMATTER.format(balance * 1000)}**\n\n` +
        '✅ Đúng → **ăn đậm từ pool kẻ thua**\n' +
        '❌ Sai → **sạch bách**\n\n' +
        '⚠️ *Sợ thì `/undo-all-in` trước khi bóng lăn.*'
      )
      .setColor(0xFF4500)
      .setThumbnail(interaction.user.displayAvatarURL())
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  } catch (err) {
    logger.error(err);
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({ content: '❌ Không thể kích hoạt all-in.', flags: MessageFlags.Ephemeral }).catch(() => {});
    }
  }
}
