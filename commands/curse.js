import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import { readTournamentData, readPlayers, readCurses, setCurse } from '../utils/firebase.js';
import { pick, findNextMatch } from '../utils/helper.js';
import logger from '../utils/logger.js';

const CURSE_LINES = [
  'vừa yểm bùa',
  'đang gọi hồn nhắm thẳng vào',
  'thì thầm lời nguyền ngàn năm lên',
  'nặn hình nhân bùa chú giống hệt',
  'gửi vận xui tới tận cửa nhà',
  'mở con mắt thứ ba nhắm vào',
  'thả mèo đen đi theo',
  'mướn thầy bùa chuyên trị',
];

export const data = new SlashCommandBuilder()
  .setName('curse')
  .setDescription('Curse a player on the next match — if they lose, steal 5 pts!')
  .addUserOption(option => option.setName('player')
    .setDescription('Player to curse')
    .setRequired(true));

export async function execute(interaction) {
  try {
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

    const players = (await readPlayers()).val();
    if (!players || !players[curserId]) {
      await interaction.reply({ content: '❌ Bạn cần `/register` trước.', flags: MessageFlags.Ephemeral });
      return;
    }
    if (!players[target.id]) {
      await interaction.reply({ content: '❌ Người chơi đó chưa đăng ký.', flags: MessageFlags.Ephemeral });
      return;
    }

    const allMatches = (await readTournamentData('matches')).val();
    if (!allMatches) {
      await interaction.reply({ content: '❌ Không có dữ liệu trận đấu.', flags: MessageFlags.Ephemeral });
      return;
    }

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

    const embed = new EmbedBuilder()
      .setTitle('🧿  LỜI NGUYỀN KÍCH HOẠT')
      .setDescription(
        `**${interaction.user}** ${pick(CURSE_LINES)} **${targetName}**!\n\n` +
        `⚽ **Trận #${matchId}:** ${match.home.toUpperCase()} vs ${match.away.toUpperCase()}\n\n` +
        `**${targetName}** đoán sai → bạn ăn **5 điểm** của **${targetName}**.\n` +
        `**${targetName}** đoán đúng → bạn mất **5 điểm** cho **${targetName}**.\n\n` +
        '*Chọn người cho kỹ nha...*'
      )
      .setColor(0x9B59B6)
      .setThumbnail(target.displayAvatarURL())
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  } catch (err) {
    logger.error(err);
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({ content: '❌ Kích hoạt lời nguyền thất bại.', flags: MessageFlags.Ephemeral }).catch(() => {});
    }
  }
}
