import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import { readTournamentData, readTournamentConfig, readAllVotes, readPlayers } from '../utils/firebase.js';
import { getWinner, getMatchVote } from '../utils/helper.js';
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
      await interaction.reply({ content: '❌ Chưa có người chơi.', flags: MessageFlags.Ephemeral });
      return;
    }

    const completed = allMatches
      .filter((m) => m.hasResult && m.isCalculated)
      .sort((a, b) => Date.parse(a.date) - Date.parse(b.date));

    if (completed.length === 0) {
      await interaction.reply({ content: '❌ Chưa có trận nào hoàn thành.', flags: MessageFlags.Ephemeral });
      return;
    }

    const playerIds = Object.keys(players);
    const loseStreaks = {};
    const winStreaks = {};
    const missedVotes = {};
    const totalWrong = {};
    const totalCorrect = {};

    for (const id of playerIds) {
      loseStreaks[id] = { current: 0, max: 0 };
      winStreaks[id] = { current: 0, max: 0 };
      missedVotes[id] = 0;
      totalWrong[id] = 0;
      totalCorrect[id] = 0;
    }

    for (const match of completed) {
      const key = `${match.id - 1}`;
      const winner = getWinner(match);
      if (!winner) continue;

      for (const id of playerIds) {
        const userVote = getMatchVote(votes, key, match.messageId, id);

        if (userVote === null) {
          missedVotes[id]++;
          loseStreaks[id].current = 0;
          winStreaks[id].current = 0;
          continue;
        }

        if (userVote === winner) {
          totalCorrect[id]++;
          winStreaks[id].current++;
          if (winStreaks[id].current > winStreaks[id].max) winStreaks[id].max = winStreaks[id].current;
          loseStreaks[id].current = 0;
        } else {
          totalWrong[id]++;
          loseStreaks[id].current++;
          if (loseStreaks[id].current > loseStreaks[id].max) loseStreaks[id].max = loseStreaks[id].current;
          winStreaks[id].current = 0;
        }
      }
    }

    const nick = (id) => users[id]?.nickname || 'Unknown';
    const names = (ids) => ids.map(nick).join(', ');

    const topBy = (obj, dir) => {
      const sorted = [...playerIds].sort((a, b) => dir === 'desc' ? obj[b] - obj[a] : obj[a] - obj[b]);
      const topVal = obj[sorted[0]];
      return { ids: sorted.filter((id) => obj[id] === topVal), val: topVal };
    };

    const bestStreak = topBy(Object.fromEntries(playerIds.map((id) => [id, winStreaks[id].max])), 'desc');
    const worstStreak = topBy(Object.fromEntries(playerIds.map((id) => [id, loseStreaks[id].max])), 'desc');

    const mostCorrectStat = topBy(totalCorrect, 'desc');
    const mostWrongStat = topBy(totalWrong, 'desc');

    const mostDiligent = topBy(missedVotes, 'asc');
    const laziest = topBy(missedVotes, 'desc');

    const pointsMap = Object.fromEntries(playerIds.map((id) => [id, players[id].points]));
    const richest = topBy(pointsMap, 'desc');
    const poorest = topBy(pointsMap, 'asc');

    const lines = [
      `**🔥 Chuỗi thắng vs 🔻 Chuỗi thua**`,
      `👑 ${names(bestStreak.ids)} — **${bestStreak.val}** trận đúng liền`,
      `💀 ${names(worstStreak.ids)} — **${worstStreak.val}** trận sai liền`,
      '',
      `**🎯 Thánh đoán vs 🤡 Thánh sai**`,
      `👑 ${names(mostCorrectStat.ids)} — **${mostCorrectStat.val}**/${completed.length} đúng`,
      `💀 ${names(mostWrongStat.ids)} — **${mostWrongStat.val}**/${completed.length} sai`,
      '',
      `**⚡ Siêng nhất vs 😴 Lười nhất**`,
      `👑 ${names(mostDiligent.ids)} — bỏ **${mostDiligent.val}** vote`,
      `💀 ${names(laziest.ids)} — bỏ **${laziest.val}** vote`,
      '',
      `**💰 Đại gia vs 📉 Viện trợ**`,
      `👑 ${names(richest.ids)} — **${richest.val}** pts`,
      `💀 ${names(poorest.ids)} — **${poorest.val}** pts`,
    ];

    let description = lines.join('\n');
    if (description.length > 4096) {
      description = description.slice(0, 4093) + '...';
    }

    const embed = new EmbedBuilder()
      .setTitle(`⚔️  ${tournamentName} — Đối đầu`)
      .setDescription(description)
      .setColor(0xED4245)
      .setFooter({ text: 'Có vua thì phải có hề.' })
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  } catch (err) {
    logger.error(err);
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({ content: '❌ Không thể tải bảng ô nhục.', flags: MessageFlags.Ephemeral }).catch(() => {});
    }
  }
}
