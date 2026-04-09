import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { readTournamentData, readPlayers, readAllVotes, readPlayerBadges } from '../utils/firebase.js';
import { formatBadgesDetailed } from '../utils/badges.js';
import { getWinner, getMatchVote, VND_FORMATTER } from '../utils/helper.js';
import { withErrorHandler, getTournamentName } from '../utils/command.js';

export const data = new SlashCommandBuilder()
  .setName('stats')
  .setDescription('Thống kê cá nhân — đối mặt sự thật đi')
  .addUserOption(option => option.setName('user')
    .setDescription('Soi ai (bỏ trống = soi mình)')
    .setRequired(false));

export const execute = withErrorHandler(async (interaction) => {
  await interaction.deferReply();

  const tournamentName = await getTournamentName();
  const targetUser = interaction.options.get('user')?.user || interaction.user;
  const userId = targetUser.id;

  const players = await readPlayers();
  if (!players || !players[userId]) {
    const embed = new EmbedBuilder()
      .setTitle('❌  Chưa đăng ký')
      .setDescription(
        targetUser.id === interaction.user.id
          ? 'Chưa đăng ký kìa. `/register` đi rồi chơi!'
          : `${targetUser} chưa đăng ký.`
      )
      .setColor(0xED4245);
    await interaction.editReply({ embeds: [embed] });
    return;
  }

  const player = players[userId];
  const allMatches = await readTournamentData('matches');
  const votes = await readAllVotes();

  let correctCount = 0;
  let votedCount = 0;
  const recentResults = [];

  const completedMatches = (allMatches || [])
    .filter((m) => m.hasResult && m.isCalculated)
    .sort((a, b) => Date.parse(a.date) - Date.parse(b.date));

  for (const match of completedMatches) {
    const key = `${match.id - 1}`;
    const userVote = getMatchVote(votes, key, match.messageId, userId);
    const winner = getWinner(match);
    const voted = userVote !== null;
    const isCorrect = voted && userVote === winner;

    if (voted) votedCount++;
    if (isCorrect) correctCount++;

    recentResults.push({
      matchId: match.id,
      home: match.home,
      away: match.away,
      vote: voted ? userVote : null,
      correct: isCorrect,
      auto: !voted,
    });
  }

  const winRate = votedCount > 0 ? ((correctCount / votedCount) * 100).toFixed(0) : '—';
  const nickname = interaction.client.cachedUsers[userId]?.nickname || targetUser.displayName;

  const embed = new EmbedBuilder()
    .setTitle(`📊  Thống kê ${nickname}`)
    .setDescription(`**${tournamentName}**`)
    .setColor(0x5865F2)
    .setThumbnail(targetUser.displayAvatarURL())
    .addFields(
      { name: '💰 Tài khoản', value: VND_FORMATTER.format(player.points * 1000), inline: true },
      { name: '🎮 Đã chơi', value: `${player.matches} trận`, inline: true },
      { name: '🎯 Tỉ lệ đúng', value: votedCount > 0 ? `${winRate}% (${correctCount}/${votedCount})` : 'Chưa vote', inline: true },
    )
    .setTimestamp();

  const recent = recentResults.slice(-5).reverse();
  if (recent.length > 0) {
    const lines = recent.map((r) => {
      const icon = r.correct ? '👑' : '🤡';
      const voteLabel = r.auto ? '🎲 auto' : `vote **${r.vote.toUpperCase()}**`;
      return `${icon} #${r.matchId} ${r.home.toUpperCase()} vs ${r.away.toUpperCase()} — ${voteLabel}`;
    });
    embed.addFields({ name: '🕐 Mấy trận gần đây', value: lines.join('\n'), inline: false });
  }

  const storedBadges = await readPlayerBadges(userId);
  embed.addFields({
    name: '🏅 Huy hiệu',
    value: formatBadgesDetailed(storedBadges),
    inline: false,
  });

  await interaction.editReply({ embeds: [embed] });
});
