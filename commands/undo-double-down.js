import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import { readTournamentData, readPlayers, readUserWagers, removePlayerWager } from '../utils/firebase.js';
import { pick } from '../utils/helper.js';
import logger from '../utils/logger.js';

const CHICKEN_LINES = [
  'run rồi, rút lui rồi. Thông cảm.',
  'sống an toàn cũng là một nghệ thuật.',
  'chùn bước — áp lực quá mạnh.',
  'hổng chơi nữa. Nhạt nhưng khôn.',
  'giật dây dù kịp lúc. Hạ cánh an toàn.',
  'nhận ra mình không đủ gan.',
];

export const data = new SlashCommandBuilder()
  .setName('undo-double-down')
  .setDescription('Remove your double-down (if the match hasn\'t started yet)');

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

    const myWagers = await readUserWagers(userId);
    const now = Date.now();

    let activeMatchId = null;
    let activeMatch = null;
    for (const [matchId, wager] of Object.entries(myWagers)) {
      if (wager.type === 'double-down') {
        const match = allMatches.find((m) => m.id === Number(matchId));
        if (match && Date.parse(match.date) > now) {
          activeMatchId = Number(matchId);
          activeMatch = match;
          break;
        }
      }
    }

    if (!activeMatchId) {
      const embed = new EmbedBuilder()
        .setTitle('🤷  Không có Double-Down')
        .setDescription('Đang không có double-down nào để huỷ cả.')
        .setColor(0xFEE75C);
      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      return;
    }

    await removePlayerWager(userId, activeMatchId);

    const embed = new EmbedBuilder()
      .setTitle('🐔  HUỶ DOUBLE-DOWN')
      .setDescription(
        `**${interaction.user}** ${pick(CHICKEN_LINES)}\n\n` +
        `⏫ Huỷ double-down Trận #${activeMatchId} ` +
        `(${activeMatch.home.toUpperCase()} vs ${activeMatch.away.toUpperCase()}).\n` +
        'Quay về mức cược bình thường.'
      )
      .setColor(0xFEE75C)
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  } catch (err) {
    logger.error(err);
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({ content: '❌ Huỷ double-down thất bại.', flags: MessageFlags.Ephemeral }).catch(() => {});
    }
  }
}
