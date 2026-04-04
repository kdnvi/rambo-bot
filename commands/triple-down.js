import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import { readTournamentData, readPlayers, readUserWagers, setPlayerWager } from '../utils/firebase.js';
import { getMatchStake } from '../utils/football.js';
import { pick, findNextMatch, getMatchDay } from '../utils/helper.js';
import logger from '../utils/logger.js';

const HYPE_LINES = [
  'không phải dạng vừa đâu!',
  'gấp BA luôn — điên hay thiên tài?',
  'cược như thể ngày mai không tồn tại!',
  'triple-down = triple drama. LFG!',
  'tay run mà vẫn bấm. Respect.',
  'lên đỉnh hay xuống hố? GẤP BA cho biết!',
  'double chưa đủ đô, phải lên triple!',
  'đánh bạo liều mạng luôn trận này!',
  'máu me lắm rồi, gấp ba cho nóng!',
  'ai cản thì cản, tôi đi triple!',
];

export const data = new SlashCommandBuilder()
  .setName('triple-down')
  .setDescription('Triple your stake on a match (1 per matchday)');

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

    const matchDay = getMatchDay(match.date);
    const sameDayMatchIds = allMatches
      .filter((m) => getMatchDay(m.date) === matchDay)
      .map((m) => m.id);

    const myWagers = await readUserWagers(userId);

    if (myWagers[matchId]?.type === 'double-down') {
      const embed = new EmbedBuilder()
        .setTitle('⚠️  Đã Double-Down rồi')
        .setDescription('Double-down rồi còn đòi triple-down. Huỷ double-down bằng `/undo-double-down` trước đi.')
        .setColor(0xFEE75C);
      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      return;
    }

    const alreadyTripleThisDay = sameDayMatchIds.some((id) => myWagers[id]?.type === 'triple-down');
    if (alreadyTripleThisDay) {
      const usedId = sameDayMatchIds.find((id) => myWagers[id]?.type === 'triple-down');
      const embed = new EmbedBuilder()
        .setTitle('⚠️  Đã dùng rồi')
        .setDescription(`Xài triple-down cho trận \`#${usedId}\` rồi. Mỗi ngày một phát thôi, tham quá!`)
        .setColor(0xFEE75C);
      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      return;
    }

    const stake = getMatchStake(match.id);
    await setPlayerWager(userId, matchId, 'triple-down');

    const embed = new EmbedBuilder()
      .setTitle('🔥  TRIPLE DOWN! 🔥')
      .setDescription(
        `**${interaction.user}** ${pick(HYPE_LINES)}\n\n` +
        `⚽ **Trận #${matchId}:** ${match.home.toUpperCase()} vs ${match.away.toUpperCase()}\n` +
        `💰 Mức cược: ${stake} → **${stake * 3} pts**\n\n` +
        '✅ Đúng → **ăn gấp ba**\n' +
        '❌ Sai → **mất gấp ba**'
      )
      .setColor(0xFF4500)
      .setThumbnail(interaction.user.displayAvatarURL())
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  } catch (err) {
    logger.error(err);
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({ content: '❌ Không thể kích hoạt triple-down.', flags: MessageFlags.Ephemeral }).catch(() => {});
    }
  }
}
