import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { readTournamentData, readTournamentConfig, readAllVotes, readPlayers, readPlayerAllIns } from '../utils/firebase.js';
import logger from '../utils/logger.js';

export const data = new SlashCommandBuilder()
  .setName('wall-of-shame')
  .setDescription('The Hall of Infamy — worst predictions, biggest fails, most shame');

export async function execute(interaction) {
  try {
    const config = await readTournamentConfig();
    const tournamentName = config?.name || 'Tournament';
    const allMatches = (await readTournamentData('matches')).val() || [];
    const votes = await readAllVotes();
    const players = (await readPlayers()).val();
    const users = interaction.client.cachedUsers;

    if (!players) {
      await interaction.reply({ content: '❌ No players registered.', flags: 64 });
      return;
    }

    const completed = allMatches
      .filter((m) => m.hasResult && m.isCalculated)
      .sort((a, b) => Date.parse(a.date) - Date.parse(b.date));

    if (completed.length === 0) {
      await interaction.reply({ content: '❌ No completed matches yet.', flags: 64 });
      return;
    }

    const playerIds = Object.keys(players);
    const streaks = {};
    const missedVotes = {};
    const totalWrong = {};

    for (const id of playerIds) {
      streaks[id] = { current: 0, max: 0 };
      missedVotes[id] = 0;
      totalWrong[id] = 0;
    }

    for (const match of completed) {
      const key = `${match.id - 1}`;
      const winner = getWinner(match);

      for (const id of playerIds) {
        let userVote = null;
        if (votes && key in votes && match.messageId && match.messageId in votes[key]) {
          const mv = votes[key][match.messageId];
          if (id in mv) userVote = mv[id].vote;
        }

        if (userVote === null) {
          missedVotes[id]++;
          streaks[id].current = 0;
          continue;
        }

        if (userVote !== winner) {
          totalWrong[id]++;
          streaks[id].current++;
          if (streaks[id].current > streaks[id].max) {
            streaks[id].max = streaks[id].current;
          }
        } else {
          streaks[id].current = 0;
        }
      }
    }

    const nick = (id) => users[id]?.nickname || 'Unknown';

    const worstStreak = playerIds
      .sort((a, b) => streaks[b].max - streaks[a].max)[0];

    const mostWrong = playerIds
      .sort((a, b) => totalWrong[b] - totalWrong[a])[0];

    const laziest = playerIds
      .sort((a, b) => missedVotes[b] - missedVotes[a])[0];

    const poorest = playerIds
      .sort((a, b) => players[a].points - players[b].points)[0];

    let biggestAllInFail = null;
    for (const id of playerIds) {
      const allIns = await readPlayerAllIns(id);
      for (const [matchId, data] of Object.entries(allIns)) {
        const match = completed.find((m) => m.id === parseInt(matchId));
        if (!match) continue;
        const winner = getWinner(match);
        const key = `${match.id - 1}`;
        let userVote = null;
        if (votes && key in votes && match.messageId && match.messageId in votes[key]) {
          const mv = votes[key][match.messageId];
          if (id in mv) userVote = mv[id].vote;
        }
        if (userVote && userVote !== winner) {
          if (!biggestAllInFail || data.amount > biggestAllInFail.amount) {
            biggestAllInFail = { id, amount: data.amount, matchId: match.id };
          }
        }
      }
    }

    const lines = [
      `🔻 **Longest Losing Streak:** ${nick(worstStreak)} — **${streaks[worstStreak].max}** wrong in a row. Impressively bad.`,
      '',
      `🤡 **Most Wrong Predictions:** ${nick(mostWrong)} — **${totalWrong[mostWrong]}** out of ${completed.length} matches. Consistency is key.`,
      '',
      `😴 **Laziest Player:** ${nick(laziest)} — missed **${missedVotes[laziest]}** vote(s). Let the dice do the work.`,
      '',
      `📉 **Poorest Player:** ${nick(poorest)} — sitting at **${players[poorest].points}** points. Thoughts and prayers.`,
    ];

    if (biggestAllInFail) {
      lines.push(
        '',
        `💥 **Biggest All-In Fail:** ${nick(biggestAllInFail.id)} — lost **${biggestAllInFail.amount}** points on match #${biggestAllInFail.matchId}. Pain.`
      );
    }

    const embed = new EmbedBuilder()
      .setTitle(`🏚️  ${tournamentName} — Wall of Shame`)
      .setDescription(lines.join('\n'))
      .setColor(0xED4245)
      .setFooter({ text: 'Embrace the shame. Wear it like armor.' })
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  } catch (err) {
    logger.error(err);
    if (!interaction.replied) {
      await interaction.reply({ content: '❌ Failed to load the wall of shame.', flags: 64 }).catch(() => {});
    }
  }
}

function getWinner(match) {
  if (match.result.home > match.result.away) return match.home;
  if (match.result.home < match.result.away) return match.away;
  return 'draw';
}
