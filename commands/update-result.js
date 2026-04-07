import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import { updateMatchResult, readPlayers, readMatchVotes } from '../utils/firebase.js';
import { calculateMatches, updateGroupStandings } from '../utils/football.js';
import { getWinner, pick, VND_FORMATTER } from '../utils/helper.js';
import logger from '../utils/logger.js';

const LEADER_LINES = [
  'đang on fire không ai cản nổi!',
  'đè đầu cỡi cổ cả hội!',
  'thắng muốn phát chán luôn!',
  'chắc sinh ra để đoán bóng!',
  'là GOAT (tạm thời thôi nha)!',
  'ăn điểm ngon lành như ăn cháo!',
  'chắc có bạn bè trong FIFA hay sao...',
  'đoán đại mà cũng đúng, ghê chưa!',
  'sáng ra đã chọn con đường thống trị!',
  'sống trong đầu mọi người không trả tiền thuê!',
];

const BOTTOM_LINES = [
  'đang tệ... tệ thiệt sự luôn á.',
  'hay tung đồng xu đi, chắc còn trúng hơn.',
  'chuyển nghề đi bạn, cái này không hợp.',
  'đang phục vụ cộng đồng — ai nhìn xuống cũng thấy vui.',
  'cho điểm thiên hạ như đại gia cho tiền tip.',
  'chọn bừa chắc còn trúng hơn chọn nghiêm túc.',
  'tưởng vào đây làm từ thiện.',
  'speedrun cháy tài khoản, sắp phá kỷ lục.',
  'lạc vào vùng tối bảng xếp hạng mất rồi.',
  'một mình giữ ấm đáy bảng, ai nhìn cũng thương.',
  'xem kèo xong bảo "kệ, đi theo trái tim" rồi cháy túi.',
];

export const data = new SlashCommandBuilder()
  .setName('update-result')
  .setDescription('Update result of a specific match')
  .addIntegerOption(option => option.setName('match-id')
    .setDescription('Match ID')
    .setRequired(true))
  .addIntegerOption(option => option.setName('home-score')
    .setDescription('Home score')
    .setMinValue(0)
    .setMaxValue(99)
    .setRequired(true))
  .addIntegerOption(option => option.setName('away-score')
    .setDescription('Away score')
    .setMinValue(0)
    .setMaxValue(99)
    .setRequired(true));

const ALLOWED_USERS = new Set((process.env.AUDITED_USERS || '').split(',').filter(Boolean));

export async function execute(interaction) {
  try {
    if (!ALLOWED_USERS.has(interaction.user.id)) {
      await interaction.reply({ content: '❌ Bạn không có quyền cập nhật kết quả trận đấu.', flags: MessageFlags.Ephemeral });
      return;
    }

    const matchId = parseInt(interaction.options.get('match-id').value) - 1;
    const homeScore = interaction.options.get('home-score').value;
    const awayScore = interaction.options.get('away-score').value;

    const result = await updateMatchResult(matchId, homeScore, awayScore);

    if (!result.success) {
      const embed = new EmbedBuilder().setTimestamp();

      if (result.error === 'not_found') {
        embed
          .setTitle('❌  Không tìm thấy trận')
          .setDescription(`Không tìm thấy trận đấu với ID \`${matchId + 1}\`.`)
          .setColor(0xED4245);
      } else if (result.error === 'already_exists') {
        const m = result.match;
        embed
          .setTitle('⚠️  Kết quả đã tồn tại')
          .setDescription(`**${m.home.toUpperCase()}** ${m.result.home} - ${m.result.away} **${m.away.toUpperCase()}**`)
          .setColor(0xFEE75C);
      }

      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      return;
    }

    const m = result.match;
    const embed = new EmbedBuilder()
      .setTitle('✅  Đã cập nhật kết quả')
      .setDescription(`**${m.home.toUpperCase()}** ${homeScore} - ${awayScore} **${m.away.toUpperCase()}**`)
      .setColor(0x57F287)
      .addFields(
        { name: '🏟️ Sân vận động', value: m.location, inline: true },
        { name: '🆔 Match ID', value: `${matchId + 1}`, inline: true },
      )
      .setFooter({ text: `Cập nhật bởi ${interaction.user.displayName}` })
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });

    const updatedMatch = {
      ...m,
      hasResult: true,
      result: { home: homeScore, away: awayScore },
    };
    await updateGroupStandings(updatedMatch);
    const matchDeltas = await calculateMatches([updatedMatch], interaction.client);
    logger.info(`Immediate calculation triggered for match ${matchId + 1}`);

    await postMatchBreakdown(interaction, updatedMatch, matchDeltas?.[updatedMatch.id]);
    await postStandings(interaction);
    await postMatchRoast(interaction, updatedMatch);
  } catch (err) {
    logger.error(err);
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({ content: '❌ Không thể cập nhật kết quả trận đấu.', flags: MessageFlags.Ephemeral }).catch(() => {});
    }
  }
}

async function postMatchBreakdown(interaction, match, deltas) {
  try {
    if (!deltas || Object.keys(deltas).length === 0) return;

    const users = interaction.client.cachedUsers;
    const entries = Object.entries(deltas)
      .map(([userId, d]) => ({
        name: users[userId]?.nickname || 'Unknown',
        ...d,
        delta: Math.round(d.delta * 100) / 100,
      }))
      .sort((a, b) => b.delta - a.delta);

    const winner = getWinner(match);
    const lines = entries.map((e) => {
      const sign = e.delta >= 0 ? '+' : '';
      const icon = e.isWinner ? '👑' : '🤡';
      const tag = e.random ? ' 🎲' : '';
      return `${icon} **${e.name}** — ${e.pick.toUpperCase()}${tag} → **${sign}${e.delta}** pts`;
    });

    const embed = new EmbedBuilder()
      .setTitle(`💰  Sổ sách trận #${match.id}`)
      .setDescription(lines.join('\n'))
      .setColor(0x5865F2)
      .setTimestamp();

    await interaction.followUp({ embeds: [embed] });
  } catch (err) {
    logger.error('Failed to post match breakdown:', err);
  }
}

const ROAST_LINES = [
  'thiệt hả... tin thiệt luôn hả 💀',
  'nên chuyển qua đoán thời tiết cho rồi',
  'chọn thiu rồi, như sữa phơi nắng ba ngày 🥛',
  'quả cầu pha lê chắc bị nứt rồi',
  'chọn bằng trái tim, quên mang não theo',
  'lần sau nhờ thằng bạn chọn dùm đi',
  'cú đoán đó là tội ác chiến tranh luôn',
  'sai một cách rất tự tin, y như mọi khi',
  'tự tay phá nát điểm của mình',
  'xem stats xong bảo "kệ, tin linh cảm" rồi toang',
  'chọn kiểu bịt mắt rồi chỉ đại 🙈',
  'linh cảm cần phải đi cấp cứu gấp',
];

async function postMatchRoast(interaction, match) {
  try {
    if (!match.messageId) return;
    const votes = (await readMatchVotes(match.id, match.messageId)).val();
    if (!votes) return;

    const winner = getWinner(match);
    const users = interaction.client.cachedUsers;
    const losers = [];

    for (const [userId, v] of Object.entries(votes)) {
      if (v.vote !== winner) {
        losers.push(users[userId]?.nickname || 'Unknown');
      }
    }

    if (losers.length === 0) return;

    const roasted = losers.slice(0, 3);
    const lines = roasted.map((name) => `🤡 **${name}** ${pick(ROAST_LINES)}`);

    if (losers.length > 3) {
      lines.push(`...cùng **${losers.length - 3}** thánh sai khác`);
    }

    const embed = new EmbedBuilder()
      .setTitle('🔥  Xào nát sau trận')
      .setDescription(lines.join('\n'))
      .setColor(0xE67E22)
      .setTimestamp();

    await interaction.followUp({ embeds: [embed] });
  } catch (err) {
    logger.error('Failed to post match roast:', err);
  }
}

async function postStandings(interaction) {
  try {
    const players = (await readPlayers()).val();
    if (!players) return;
    const users = interaction.client.cachedUsers;

    const ranked = [];
    for (const [key, value] of Object.entries(players)) {
      ranked.push({
        id: key,
        nickname: users[key]?.nickname || 'Unknown',
        points: value.points,
      });
    }
    ranked.sort((a, b) => b.points - a.points);

    if (ranked.length < 2) return;

    const leader = ranked[0];
    const bottom = ranked[ranked.length - 1];

    const lines = [
      `👑 **${leader.nickname}** ${pick(LEADER_LINES)} (${VND_FORMATTER.format(leader.points * 1000)})`,
      '',
      `💀 **${bottom.nickname}** ${pick(BOTTOM_LINES)} (${VND_FORMATTER.format(bottom.points * 1000)})`,
    ];

    const embed = new EmbedBuilder()
      .setTitle('📊  BXH sau trận')
      .setDescription(lines.join('\n'))
      .setColor(0xFFD700)
      .setTimestamp();

    await interaction.followUp({ embeds: [embed] });
  } catch (err) {
    logger.error('Failed to post standings:', err);
  }
}
