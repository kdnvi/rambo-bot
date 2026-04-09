import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import { readTournamentData, readPlayers, readCurses, removeCurse } from '../utils/firebase.js';
import { pick } from '../utils/helper.js';
import logger from '../utils/logger.js';

const RELIEF_LINES = [
  'tha mạng cho nó... tạm thời thôi nha.',
  'cao thượng tha cho nạn nhân. Lần này vậy.',
  'gỡ bùa rồi. Năng lượng đen bay hết.',
  'gọi thầy bùa về nhà, hết việc rồi.',
  'bẻ đôi hình nhân. Xong, hết chuyện.',
  'nhắm mắt lại. Đêm nay ngủ ngon đi nha.',
  'rút kim ra khỏi hình nộm. Bình an rồi.',
  'quạ đen bay về. Nhiệm vụ huỷ.',
  'xé bùa giữa ban ngày. Thiện lành trở lại.',
  'lương tâm cắn rứt rồi hả? Thôi tha.',
  'buông dao đồ tể. Trở về con đường sáng.',
];

export const data = new SlashCommandBuilder()
  .setName('uncurse')
  .setDescription('Hối hận rồi? Gỡ bùa trước giờ đá');

export async function execute(interaction) {
  try {
    const userId = interaction.user.id;

    const players = (await readPlayers()).val();
    if (!players || !players[userId]) {
      await interaction.reply({ content: '❌ Bạn cần `/register` trước.', flags: MessageFlags.Ephemeral });
      return;
    }

    const allMatches = (await readTournamentData('matches')).val();
    if (!allMatches) {
      await interaction.reply({ content: '❌ Không có dữ liệu trận đấu.', flags: MessageFlags.Ephemeral });
      return;
    }

    const curses = await readCurses();
    const now = Date.now();

    let activeCurseMatchId = null;
    let activeCurse = null;
    for (const [matchId, matchCurses] of Object.entries(curses)) {
      if (matchCurses[userId]) {
        const match = allMatches.find((m) => m.id === Number(matchId));
        if (match && Date.parse(match.date) > now) {
          activeCurseMatchId = Number(matchId);
          activeCurse = { ...matchCurses[userId], match };
          break;
        }
      }
    }

    if (!activeCurseMatchId) {
      const embed = new EmbedBuilder()
        .setTitle('🤷  Không có lời nguyền')
        .setDescription('Đang không có nguyền ai cả, gỡ cái gì?')
        .setColor(0xFEE75C);
      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      return;
    }

    await removeCurse(userId, activeCurseMatchId);

    const users = interaction.client.cachedUsers;
    const targetName = users[activeCurse.target]?.nickname || activeCurse.target;

    const embed = new EmbedBuilder()
      .setTitle('🕊️  GỠ LỜI NGUYỀN')
      .setDescription(
        `**${interaction.user}** ${pick(RELIEF_LINES)}\n\n` +
        `🧿 Lời nguyền lên **${targetName}** ở Trận #${activeCurseMatchId} ` +
        `(${activeCurse.match.home.toUpperCase()} vs ${activeCurse.match.away.toUpperCase()}) đã được gỡ bỏ.`
      )
      .setColor(0x57F287)
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  } catch (err) {
    logger.error(err);
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({ content: '❌ Gỡ lời nguyền thất bại.', flags: MessageFlags.Ephemeral }).catch(() => {});
    }
  }
}
