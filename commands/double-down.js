import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import { readTournamentData, readPlayers, readUserWagers, readPlayerAllIns, setPlayerWager } from '../utils/firebase.js';
import { getMatchStake } from '../utils/football.js';
import { pick, findNextMatch, getMatchDay } from '../utils/helper.js';
import logger from '../utils/logger.js';

const HYPE_LINES = [
  'hôm nay máu lắm!',
  'chê cược thường nhạt, phải gấp đôi mới đã!',
  'vặn volume lên max luôn!',
  'đặt cả thể diện vào trận này rồi đó.',
  'sống liều chết liều hôm nay!',
  'tự tin kiểu nhà tiên tri, không biết đúng hay sai.',
  'thiên tài hay điên? Sắp biết thôi.',
  'tăng cược — theo đúng nghĩa đen luôn á.',
  'bật chế độ quái thú rồi nha!',
  'vào đây không phải để chơi cho vui đâu.',
];

export const data = new SlashCommandBuilder()
  .setName('double-down')
  .setDescription('Double your stake on a match (1 per matchday)');

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

    const existingAllIns = await readPlayerAllIns(userId);
    if (existingAllIns[matchId]) {
      const embed = new EmbedBuilder()
        .setTitle('⚠️  Đã All-In rồi')
        .setDescription('All-in rồi còn double-down cái gì nữa mậy. Tham vừa thôi.')
        .setColor(0xFEE75C);
      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      return;
    }

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

    const embed = new EmbedBuilder()
      .setTitle('⏫  DOUBLE DOWN!')
      .setDescription(
        `**${interaction.user}** ${pick(HYPE_LINES)}\n\n` +
        `⚽ **Trận #${matchId}:** ${match.home.toUpperCase()} vs ${match.away.toUpperCase()}\n` +
        `💰 Mức cược: ${stake} → **${stake * 2} pts**\n\n` +
        '✅ Đúng → **ăn gấp đôi**\n' +
        '❌ Sai → **mất gấp đôi**'
      )
      .setColor(0x57F287)
      .setThumbnail(interaction.user.displayAvatarURL())
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  } catch (err) {
    logger.error(err);
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({ content: '❌ Không thể kích hoạt double-down.', flags: MessageFlags.Ephemeral }).catch(() => {});
    }
  }
}
