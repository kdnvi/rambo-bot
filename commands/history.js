import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import { readTournamentData, readTournamentConfig, readAllVotes } from '../utils/firebase.js';
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
      await interaction.reply({ content: '❌ No match data available.', flags: MessageFlags.Ephemeral });
      return;
    }

    const votes = await readAllVotes();
    const users = interaction.client.cachedUsers;
    const nickname = users[userId]?.nickname || targetUser.displayName;

    const completedMatches = allMatches
      .filter((m) => m.hasResult)
      .sort((a, b) => Date.parse(a.date) - Date.parse(b.date));

    const userHistory = [];
    for (const match of completedMatches) {
      const key = `${match.id - 1}`;
      const winner = getWinner(match);
      let userVote = null;

      if (votes && key in votes && match.messageId && match.messageId in votes[key]) {
        const matchVotes = votes[key][match.messageId];
        if (userId in matchVotes) {
          userVote = matchVotes[userId].vote;
        }
      }

      userHistory.push({
        matchId: match.id,
        home: match.home,
        away: match.away,
        result: match.result,
        winner,
        vote: userVote,
        correct: userVote ? userVote === winner : null,
      });
    }

    const recent = userHistory.slice(-count).reverse();

    if (recent.length === 0) {
      const embed = new EmbedBuilder()
        .setTitle('🔍  No History')
        .setDescription(`No completed matches found for **${nickname}**.`)
        .setColor(0xFEE75C);
      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      return;
    }

    const lines = recent.map((r) => {
      const score = `${r.result.home}-${r.result.away}`;
      if (r.vote === null) {
        return `🎲 **#${r.matchId}** ${r.home.toUpperCase()} ${score} ${r.away.toUpperCase()} — *randomized*`;
      }
      const icon = r.correct ? '👑' : '🤡';
      return `${icon} **#${r.matchId}** ${r.home.toUpperCase()} ${score} ${r.away.toUpperCase()} — voted **${r.vote.toUpperCase()}**`;
    });

    const totalVoted = userHistory.filter((r) => r.vote !== null).length;
    const totalCorrect = userHistory.filter((r) => r.correct === true).length;
    const totalRandomized = userHistory.filter((r) => r.vote === null).length;
    const winRate = totalVoted > 0 ? `${Math.round((totalCorrect / totalVoted) * 100)}%` : '—';

    const embed = new EmbedBuilder()
      .setTitle(`📜  ${nickname}'s Vote History`)
      .setDescription(
        `**${tournamentName}**\n\n` +
        lines.join('\n') +
        `\n\n🎯 **${winRate}** win rate (${totalCorrect}/${totalVoted})` +
        (totalRandomized > 0 ? ` · 🎲 ${totalRandomized} randomized` : '')
      )
      .setColor(0x5865F2)
      .setThumbnail(targetUser.displayAvatarURL())
      .setFooter({ text: `Showing last ${recent.length} of ${userHistory.length} match(es)` })
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  } catch (err) {
    logger.error(err);
    if (!interaction.replied) {
      await interaction.reply({ content: '❌ Failed to load vote history.', flags: MessageFlags.Ephemeral }).catch(() => {});
    }
  }
}

function getWinner(match) {
  if (match.result.home > match.result.away) return match.home;
  if (match.result.home < match.result.away) return match.away;
  return 'draw';
}
