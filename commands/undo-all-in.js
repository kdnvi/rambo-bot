import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import { readTournamentData, readPlayers, readPlayerAllIns, removePlayerAllIn } from '../utils/firebase.js';
import { pick, VND_FORMATTER } from '../utils/helper.js';
import logger from '../utils/logger.js';

const RELIEF_LINES = [
  'tỉnh lại rồi. Suýt chút nữa thôi.',
  'giật mình dậy đẫm mồ hôi rồi bấm huỷ.',
  'nhận ra "YOLO" không phải kế hoạch tài chính.',
  'lùi lại khỏi bờ vực. Khôn đấy.',
  'nghĩ lại thấy vẫn thích có điểm hơn.',
  'nhìn số dư xong hoảng, huỷ liền.',
];

export const data = new SlashCommandBuilder()
  .setName('undo-all-in')
  .setDescription('Remove your all-in bet (if the match hasn\'t started yet)');

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

    const allIns = await readPlayerAllIns(userId);
    const now = Date.now();

    let activeMatchId = null;
    let activeMatch = null;
    let activeAmount = 0;
    for (const [matchId, entry] of Object.entries(allIns)) {
      const match = allMatches.find((m) => m.id === Number(matchId));
      if (match && Date.parse(match.date) > now) {
        activeMatchId = Number(matchId);
        activeMatch = match;
        activeAmount = entry.amount;
        break;
      }
    }

    if (!activeMatchId) {
      const embed = new EmbedBuilder()
        .setTitle('🤷  Không có All-In')
        .setDescription('Đang không có all-in nào để huỷ cả.')
        .setColor(0xFEE75C);
      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      return;
    }

    await removePlayerAllIn(userId, activeMatchId);

    const embed = new EmbedBuilder()
      .setTitle('😮‍💨  HUỶ ALL-IN')
      .setDescription(
        `**${interaction.user}** ${pick(RELIEF_LINES)}\n\n` +
        `🎰 Huỷ all-in **${VND_FORMATTER.format(activeAmount * 1000)}** ở Trận #${activeMatchId} ` +
        `(${activeMatch.home.toUpperCase()} vs ${activeMatch.away.toUpperCase()}).\n` +
        'Tiền vẫn còn... tạm thời.'
      )
      .setColor(0xFEE75C)
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  } catch (err) {
    logger.error(err);
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({ content: '❌ Huỷ all-in thất bại.', flags: MessageFlags.Ephemeral }).catch(() => {});
    }
  }
}
