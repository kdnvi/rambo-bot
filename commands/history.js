import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { readTournamentData, readAllVotes, readUserWagers, readCurses } from '../utils/firebase.js';
import { getWinner, getMatchVote } from '../utils/helper.js';
import { withErrorHandler, getTournamentName } from '../utils/command.js';

export const data = new SlashCommandBuilder()
  .setName('history')
  .setDescription('Lật lại lịch sử vote — đúng sai không trốn được')
  .addUserOption(option => option.setName('user')
    .setDescription('Soi ai (bỏ trống = soi mình)')
    .setRequired(false))
  .addIntegerOption(option => option.setName('count')
    .setDescription('Số trận muốn xem (mặc định 5)')
    .setMinValue(1)
    .setMaxValue(20)
    .setRequired(false));

export const execute = withErrorHandler(async (interaction) => {
  await interaction.deferReply();

  const tournamentName = await getTournamentName();
  const targetUser = interaction.options.get('user')?.user || interaction.user;
  const userId = targetUser.id;
  const count = interaction.options.get('count')?.value || 5;

  const allMatches = await readTournamentData('matches');
  if (!allMatches) {
    await interaction.editReply({ content: '❌ Không có dữ liệu trận đấu.' });
    return;
  }

  const [votes, userWagers, allCurses] = await Promise.all([
    readAllVotes(),
    readUserWagers(userId),
    readCurses(),
  ]);
  const users = interaction.client.cachedUsers;
  const nickname = users[userId]?.nickname || targetUser.displayName;

  const completedMatches = allMatches
    .filter((m) => m.hasResult && m.isCalculated)
    .sort((a, b) => Date.parse(a.date) - Date.parse(b.date));

  const userHistory = [];
  const cursedTargets = {};

  for (const match of completedMatches) {
    const key = `${match.id - 1}`;
    const winner = getWinner(match);
    const userVote = getMatchVote(votes, key, match.messageId, userId);

    const wager = userWagers[match.id];
    const curse = allCurses[match.id]?.[userId];

    if (curse) {
      cursedTargets[curse.target] = (cursedTargets[curse.target] || 0) + 1;
    }

    userHistory.push({
      matchId: match.id,
      home: match.home,
      away: match.away,
      result: match.result,
      winner,
      vote: userVote,
      correct: userVote ? userVote === winner : null,
      wagerType: wager?.type || null,
      curseTarget: curse?.target || null,
    });
  }

  const recent = userHistory.slice(-count).reverse();

  if (recent.length === 0) {
    const embed = new EmbedBuilder()
      .setTitle('🔍  Không có lịch sử')
      .setDescription(`Chưa có trận nào xong cho **${nickname}** cả.`)
      .setColor(0xFEE75C);
    await interaction.editReply({ embeds: [embed] });
    return;
  }

  const lines = recent.map((r) => {
    const score = `${r.result.home}-${r.result.away}`;
    let line;
    if (r.vote === null) {
      const autoLabel = r.wagerType === 'random' ? 'ngẫu nhiên 🎲' : 'tự động (least-voted)';
      line = `🤖 **#${r.matchId}** ${r.home.toUpperCase()} ${score} ${r.away.toUpperCase()} — *${autoLabel}*`;
    } else {
      const icon = r.correct ? '👑' : '🤡';
      line = `${icon} **#${r.matchId}** ${r.home.toUpperCase()} ${score} ${r.away.toUpperCase()} — vote **${r.vote.toUpperCase()}**`;
    }

    const tags = [];
    if (r.wagerType === 'double-down') tags.push('⏫ double-down');
    if (r.curseTarget) {
      const targetName = users[r.curseTarget]?.nickname || 'Unknown';
      tags.push(`🪄 nguyền **${targetName}**`);
    }
    if (tags.length > 0) line += `\n  └ ${tags.join(' · ')}`;

    return line;
  });

  const totalVoted = userHistory.filter((r) => r.vote !== null).length;
  const totalCorrect = userHistory.filter((r) => r.correct === true).length;
  const totalRandom = userHistory.filter((r) => r.vote === null && r.wagerType === 'random').length;
  const totalAutoAssigned = userHistory.filter((r) => r.vote === null && r.wagerType !== 'random').length;
  const winRate = totalVoted > 0 ? `${Math.round((totalCorrect / totalVoted) * 100)}%` : '—';

  let summary = `🎯 Tỉ lệ đúng **${winRate}** (${totalCorrect}/${totalVoted})`;
  if (totalRandom > 0) summary += ` · 🎲 ${totalRandom} random`;
  if (totalAutoAssigned > 0) summary += ` · 🤖 ${totalAutoAssigned} tự động`;

  const totalDD = userHistory.filter((r) => r.wagerType === 'double-down').length;
  const totalCurses = userHistory.filter((r) => r.curseTarget).length;
  if (totalDD > 0 || totalCurses > 0) {
    const parts = [];
    if (totalDD > 0) parts.push(`⏫ ${totalDD} double-down`);
    if (totalCurses > 0) parts.push(`🪄 ${totalCurses} curse`);
    summary += `\n${parts.join(' · ')}`;
  }

  if (Object.keys(cursedTargets).length > 0) {
    const curseList = Object.entries(cursedTargets)
      .sort((a, b) => b[1] - a[1])
      .map(([id, count]) => `${users[id]?.nickname || 'Unknown'} (×${count})`)
      .join(', ');
    summary += `\n🪄 Nguyền: ${curseList}`;
  }

  const embed = new EmbedBuilder()
    .setTitle(`📜  Lịch sử vote ${nickname}`)
    .setDescription(
      `**${tournamentName}**\n\n` +
      lines.join('\n') +
      `\n\n${summary}`
    )
    .setColor(0x5865F2)
    .setThumbnail(targetUser.displayAvatarURL())
    .setFooter({ text: `Hiển thị ${recent.length}/${userHistory.length} trận gần nhất` })
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
});
