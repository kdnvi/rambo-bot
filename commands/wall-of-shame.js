import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import { readTournamentData, readTournamentConfig, readAllVotes, readPlayers, readAllAllIns } from '../utils/firebase.js';
import { getWinner } from '../utils/helper.js';
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
      await interaction.reply({ content: '❌ No players registered.', flags: MessageFlags.Ephemeral });
      return;
    }

    const completed = allMatches
      .filter((m) => m.hasResult && m.isCalculated)
      .sort((a, b) => Date.parse(a.date) - Date.parse(b.date));

    if (completed.length === 0) {
      await interaction.reply({ content: '❌ No completed matches yet.', flags: MessageFlags.Ephemeral });
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
    const names = (ids) => ids.map(nick).join(', ');

    const totalCorrect = {};
    const winStreaks = {};
    for (const id of playerIds) {
      totalCorrect[id] = completed.length - totalWrong[id] - missedVotes[id];
      winStreaks[id] = { current: 0, max: 0 };
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
        if (userVote === winner) {
          winStreaks[id].current++;
          if (winStreaks[id].current > winStreaks[id].max) winStreaks[id].max = winStreaks[id].current;
        } else {
          winStreaks[id].current = 0;
        }
      }
    }

    const topBy = (obj, dir) => {
      const sorted = [...playerIds].sort((a, b) => dir === 'desc' ? obj[b] - obj[a] : obj[a] - obj[b]);
      const topVal = obj[sorted[0]];
      return { ids: sorted.filter((id) => obj[id] === topVal), val: topVal };
    };

    const bestStreak = topBy(Object.fromEntries(playerIds.map((id) => [id, winStreaks[id].max])), 'desc');
    const worstStreak = topBy(Object.fromEntries(playerIds.map((id) => [id, streaks[id].max])), 'desc');

    const mostCorrectStat = topBy(totalCorrect, 'desc');
    const mostWrongStat = topBy(totalWrong, 'desc');

    const mostDiligent = topBy(missedVotes, 'asc');
    const laziest = topBy(missedVotes, 'desc');

    const pointsMap = Object.fromEntries(playerIds.map((id) => [id, players[id].points]));
    const richest = topBy(pointsMap, 'desc');
    const poorest = topBy(pointsMap, 'asc');

    let biggestAllInWin = null;
    let biggestAllInFail = null;
    const allAllIns = await readAllAllIns();
    for (const id of playerIds) {
      const allIns = allAllIns[id] || {};
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
        if (!userVote) continue;
        if (userVote === winner) {
          if (!biggestAllInWin || data.amount > biggestAllInWin.amount) {
            biggestAllInWin = { ids: [id], amount: data.amount, matchId: match.id };
          } else if (data.amount === biggestAllInWin.amount) {
            biggestAllInWin.ids.push(id);
          }
        } else {
          if (!biggestAllInFail || data.amount > biggestAllInFail.amount) {
            biggestAllInFail = { ids: [id], amount: data.amount, matchId: match.id };
          } else if (data.amount === biggestAllInFail.amount) {
            biggestAllInFail.ids.push(id);
          }
        }
      }
    }

    const lines = [
      `**🔥 Winning Streak vs 🔻 Losing Streak**`,
      `👑 ${names(bestStreak.ids)} — **${bestStreak.val}** wins in a row`,
      `💀 ${names(worstStreak.ids)} — **${worstStreak.val}** wrong in a row`,
      '',
      `**🎯 Most Correct vs 🤡 Most Wrong**`,
      `👑 ${names(mostCorrectStat.ids)} — **${mostCorrectStat.val}**/${completed.length} correct`,
      `💀 ${names(mostWrongStat.ids)} — **${mostWrongStat.val}**/${completed.length} wrong`,
      '',
      `**⚡ Most Diligent vs 😴 Laziest**`,
      `👑 ${names(mostDiligent.ids)} — missed **${mostDiligent.val}** vote(s)`,
      `💀 ${names(laziest.ids)} — missed **${laziest.val}** vote(s)`,
      '',
      `**💰 Richest vs 📉 Poorest**`,
      `👑 ${names(richest.ids)} — **${richest.val}** pts`,
      `💀 ${names(poorest.ids)} — **${poorest.val}** pts`,
    ];

    if (biggestAllInWin || biggestAllInFail) {
      lines.push('', `**🎰 All-In Hall of Fame vs 💥 All-In Hall of Shame**`);
      if (biggestAllInWin) {
        lines.push(`👑 ${names(biggestAllInWin.ids)} — won **${biggestAllInWin.amount}** pts on match #${biggestAllInWin.matchId}`);
      }
      if (biggestAllInFail) {
        lines.push(`💀 ${names(biggestAllInFail.ids)} — lost **${biggestAllInFail.amount}** pts on match #${biggestAllInFail.matchId}`);
      }
    }

    const embed = new EmbedBuilder()
      .setTitle(`⚔️  ${tournamentName} — Head to Head`)
      .setDescription(lines.join('\n'))
      .setColor(0xED4245)
      .setFooter({ text: 'Every crown has its clown.' })
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  } catch (err) {
    logger.error(err);
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({ content: '❌ Failed to load the wall of shame.', flags: MessageFlags.Ephemeral }).catch(() => {});
    }
  }
}
