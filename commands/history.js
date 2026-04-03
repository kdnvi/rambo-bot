import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import { readTournamentData, readTournamentConfig, readAllVotes, readUserWagers, readPlayerAllIns, readCurses } from '../utils/firebase.js';
import { getWinner, getMatchVote, VND_FORMATTER } from '../utils/helper.js';
import logger from '../utils/logger.js';

export const data = new SlashCommandBuilder()
  .setName('history')
  .setDescription('View vote history for a player')
  .addUserOption(option => option.setName('user')
    .setDescription('Player to view (defaults to yourself)')
    .setRequired(false))
  .addIntegerOption(option => option.setName('count')
    .setDescription('Number of recent matches to show (default 5)')
    .setMinValue(1)
    .setMaxValue(20)
    .setRequired(false));

export async function execute(interaction) {
  try {
    const config = await readTournamentConfig();
    const tournamentName = config?.name || 'Tournament';
    const targetUser = interaction.options.get('user')?.user || interaction.user;
    const userId = targetUser.id;
    const count = interaction.options.get('count')?.value || 5;

    const allMatches = (await readTournamentData('matches')).val();
    if (!allMatches) {
      await interaction.reply({ content: '❌ Không có dữ liệu trận đấu.', flags: MessageFlags.Ephemeral });
      return;
    }

    const [votes, userWagers, userAllIns, allCurses] = await Promise.all([
      readAllVotes(),
      readUserWagers(userId),
      readPlayerAllIns(userId),
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
      const allIn = userAllIns[match.id];
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
        isDoubleDown: wager?.type === 'double-down',
        allInAmount: allIn?.amount || null,
        curseTarget: curse?.target || null,
      });
    }

    const recent = userHistory.slice(-count).reverse();

    if (recent.length === 0) {
      const embed = new EmbedBuilder()
        .setTitle('🔍  Không có lịch sử')
        .setDescription(`Chưa có trận nào xong cho **${nickname}** cả.`)
        .setColor(0xFEE75C);
      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      return;
    }

    const lines = recent.map((r) => {
      const score = `${r.result.home}-${r.result.away}`;
      let line;
      if (r.vote === null) {
        line = `🎲 **#${r.matchId}** ${r.home.toUpperCase()} ${score} ${r.away.toUpperCase()} — *ngẫu nhiên*`;
      } else {
        const icon = r.correct ? '👑' : '🤡';
        line = `${icon} **#${r.matchId}** ${r.home.toUpperCase()} ${score} ${r.away.toUpperCase()} — vote **${r.vote.toUpperCase()}**`;
      }

      const tags = [];
      if (r.isDoubleDown) tags.push('⏫ double-down');
      if (r.allInAmount) tags.push(`🎰 all-in (${VND_FORMATTER.format(r.allInAmount * 1000)})`);
      if (r.curseTarget) {
        const targetName = users[r.curseTarget]?.nickname || 'Unknown';
        tags.push(`🪄 nguyền **${targetName}**`);
      }
      if (tags.length > 0) line += `\n  └ ${tags.join(' · ')}`;

      return line;
    });

    const totalVoted = userHistory.filter((r) => r.vote !== null).length;
    const totalCorrect = userHistory.filter((r) => r.correct === true).length;
    const totalRandomized = userHistory.filter((r) => r.vote === null).length;
    const winRate = totalVoted > 0 ? `${Math.round((totalCorrect / totalVoted) * 100)}%` : '—';

    let summary = `🎯 Tỉ lệ đúng **${winRate}** (${totalCorrect}/${totalVoted})`;
    if (totalRandomized > 0) summary += ` · 🎲 ${totalRandomized} random`;

    const totalDD = userHistory.filter((r) => r.isDoubleDown).length;
    const totalAllIn = userHistory.filter((r) => r.allInAmount).length;
    const totalCurses = userHistory.filter((r) => r.curseTarget).length;
    if (totalDD > 0 || totalAllIn > 0 || totalCurses > 0) {
      const parts = [];
      if (totalDD > 0) parts.push(`⏫ ${totalDD} double-down`);
      if (totalAllIn > 0) parts.push(`🎰 ${totalAllIn} all-in`);
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

    await interaction.reply({ embeds: [embed] });
  } catch (err) {
    logger.error(err);
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({ content: '❌ Không thể tải lịch sử vote.', flags: MessageFlags.Ephemeral }).catch(() => {});
    }
  }
}
