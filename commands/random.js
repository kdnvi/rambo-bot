import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import { readTournamentData, readPlayers, readUserWagers, setPlayerWager } from '../utils/firebase.js';
import { pick, findNextMatch } from '../utils/helper.js';
import logger from '../utils/logger.js';

const RANDOM_LINES = [
  'giao hết cho vận mệnh rồi nha!',
  'nhắm mắt đưa chân, trời kêu ai nấy dạ.',
  'bỏ não ở nhà hôm nay.',
  'để ông trời quyết định!',
  'tự tin vào sự ngẫu nhiên hơn bản thân mình.',
  'quay xổ số thôi, suy nghĩ chi cho mệt.',
  'số phận dẫn lối, bước đi không cần não.',
  'gieo xúc xắc rồi ngồi cầu nguyện.',
];

export const data = new SlashCommandBuilder()
  .setName('random')
  .setDescription('Randomly pick a team for the next match instead of getting the least-voted default');

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
    const myWagers = await readUserWagers(userId);

    if (myWagers[matchId]?.type === 'random') {
      const embed = new EmbedBuilder()
        .setTitle('⚠️  Đã kích hoạt rồi')
        .setDescription(`Random đã bật cho trận \`#${matchId}\` rồi. Nằm chờ số phận thôi!`)
        .setColor(0xFEE75C);
      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      return;
    }

    await setPlayerWager(userId, matchId, 'random');

    const embed = new EmbedBuilder()
      .setTitle('🎲  RANDOM!')
      .setDescription(
        `**${interaction.user}** ${pick(RANDOM_LINES)}\n\n` +
        `⚽ **Trận #${matchId}:** ${match.home.toUpperCase()} vs ${match.away.toUpperCase()}\n\n` +
        '🎲 Nếu không vote trước giờ đá, hệ thống sẽ **random** thay vì gán đội ít vote nhất.',
      )
      .setColor(0x9B59B6)
      .setThumbnail(interaction.user.displayAvatarURL())
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  } catch (err) {
    logger.error(err);
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({ content: '❌ Không thể kích hoạt random.', flags: MessageFlags.Ephemeral }).catch(() => {});
    }
  }
}
