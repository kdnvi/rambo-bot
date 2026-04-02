import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { readTournamentData, readTournamentConfig } from '../utils/firebase.js';
import logger from '../utils/logger.js';

const formatter = new Intl.NumberFormat('vi-VN', {
  style: 'currency',
  currency: 'VND',
});

export const data = new SlashCommandBuilder()
  .setName('stats')
  .setDescription('View your personal tournament stats')
  .addUserOption(option => option.setName('user')
    .setDescription('Check another player (leave empty for yourself)')
    .setRequired(false));

export async function execute(interaction) {
  try {
    const config = await readTournamentConfig();
    const tournamentName = config?.name || 'Tournament';
    const targetUser = interaction.options.get('user')?.user || interaction.user;
    const userId = targetUser.id;

    const players = (await readTournamentData('players')).val();
    if (!players || !players[userId]) {
      const embed = new EmbedBuilder()
        .setTitle('❌  Not Registered')
        .setDescription(
          targetUser.id === interaction.user.id
            ? 'You are not registered. Use `/register` to join!'
            : `${targetUser} is not registered in this tournament.`
        )
        .setColor(0xED4245);
      interaction.reply({ embeds: [embed], ephemeral: true });
      return;
    }

    const player = players[userId];
    const allMatches = (await readTournamentData('matches')).val();
    const votes = (await readTournamentData('votes')).val();

    let correctVotes = 0;
    let totalVotes = 0;
    const recentResults = [];

    const completedMatches = allMatches
      .filter((m) => m.hasResult && m.isCalculated)
      .sort((a, b) => Date.parse(a.date) - Date.parse(b.date));

    for (const match of completedMatches) {
      const key = `${match.id - 1}`;
      if (!votes || !(key in votes) || !match.messageId || !(match.messageId in votes[key])) continue;
      const matchVotes = votes[key][match.messageId];
      if (!(userId in matchVotes)) continue;

      const userVote = matchVotes[userId].vote;
      const winner = getWinner(match);
      const isCorrect = userVote === winner;

      totalVotes++;
      if (isCorrect) correctVotes++;

      recentResults.push({
        matchId: match.id,
        home: match.home,
        away: match.away,
        vote: userVote,
        correct: isCorrect,
      });
    }

    const winRate = totalVotes > 0 ? ((correctVotes / totalVotes) * 100).toFixed(0) : '—';
    const nickname = interaction.client.cachedUsers[userId]?.nickname || targetUser.displayName;

    const embed = new EmbedBuilder()
      .setTitle(`📊  ${nickname}'s Stats`)
      .setDescription(`**${tournamentName}**`)
      .setColor(0x5865F2)
      .setThumbnail(targetUser.displayAvatarURL())
      .addFields(
        { name: '💰 Balance', value: formatter.format(player.points * 1000), inline: true },
        { name: '🎮 Matches', value: `${player.matches}`, inline: true },
        { name: '🎯 Win Rate', value: totalVotes > 0 ? `${winRate}% (${correctVotes}/${totalVotes})` : 'No votes yet', inline: true },
      )
      .setTimestamp();

    const recent = recentResults.slice(-5).reverse();
    if (recent.length > 0) {
      const lines = recent.map((r) => {
        const icon = r.correct ? '✅' : '❌';
        return `${icon} #${r.matchId} ${r.home.toUpperCase()} vs ${r.away.toUpperCase()} — voted **${r.vote.toUpperCase()}**`;
      });
      embed.addFields({ name: '🕐 Recent Votes', value: lines.join('\n'), inline: false });
    }

    interaction.reply({ embeds: [embed] });
  } catch (err) {
    logger.error(err);
    interaction.reply({ content: '❌ Failed to load stats.', ephemeral: true });
  }
}

function getWinner(match) {
  if (match.result.home > match.result.away) return match.home;
  if (match.result.home < match.result.away) return match.away;
  return 'draw';
}
