import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import { updateMatchResult, readPlayers, readMatchVotes, readTournamentData, readCurses } from '../utils/firebase.js';
import { calculateMatches, updateGroupStandings, CURSE_PTS } from '../utils/football.js';
import { getWinner, VND_FORMATTER } from '../utils/helper.js';
import { withErrorHandler } from '../utils/command.js';
import { pickLine } from '../utils/flavor.js';
import logger from '../utils/logger.js';

export const data = new SlashCommandBuilder()
  .setName('update-result')
  .setDescription('Cập nhật kết quả trận đấu — quyền sinh sát trong tay')
  .addIntegerOption(option => option.setName('match-id')
    .setDescription('ID trận')
    .setRequired(true))
  .addIntegerOption(option => option.setName('home-score')
    .setDescription('Bàn đội nhà')
    .setMinValue(0)
    .setMaxValue(99)
    .setRequired(true))
  .addIntegerOption(option => option.setName('away-score')
    .setDescription('Bàn đội khách')
    .setMinValue(0)
    .setMaxValue(99)
    .setRequired(true));

const ALLOWED_USERS = new Set((process.env.AUDITED_USERS || '').split(',').filter(Boolean));

export const execute = withErrorHandler(async (interaction) => {
  if (!ALLOWED_USERS.has(interaction.user.id)) {
    await interaction.reply({ content: '❌ Bạn không có quyền cập nhật kết quả trận đấu.', flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferReply();

  const matchId = interaction.options.get('match-id').value - 1;
  const homeScore = interaction.options.get('home-score').value;
  const awayScore = interaction.options.get('away-score').value;

  const allMatches = await readTournamentData('matches');
  const matchData = allMatches?.[matchId];
  if (matchData && !matchData.messageId) {
    const embed = new EmbedBuilder()
      .setTitle('⚠️  Trận chưa được đăng')
      .setDescription(`Trận \`#${matchId + 1}\` chưa được đăng lên channel — chưa ai vote được thì cập nhật kết quả làm gì?`)
      .setColor(0xFEE75C)
      .setTimestamp();
    await interaction.editReply({ embeds: [embed] });
    return;
  }

  if (matchData?.date) {
    const kickoff = Date.parse(matchData.date);
    const elapsed = Date.now() - kickoff;
    const MIN_90 = 90 * 60 * 1000;
    if (elapsed < MIN_90) {
      const remaining = Math.ceil((MIN_90 - elapsed) / 60000);
      const embed = new EmbedBuilder()
        .setTitle('⏳  Chưa đủ 90 phút')
        .setDescription(`Trận \`#${matchId + 1}\` mới đá được chút xíu — chờ thêm **${remaining} phút** nữa rồi hãy cập nhật.`)
        .setColor(0xFEE75C)
        .setTimestamp();
      await interaction.editReply({ embeds: [embed] });
      return;
    }
  }

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

    await interaction.editReply({ embeds: [embed] });
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

  await interaction.editReply({ embeds: [embed] });

  const updatedMatch = {
    ...m,
    hasResult: true,
    result: { home: homeScore, away: awayScore },
  };
  await updateGroupStandings(updatedMatch);
  const matchDeltas = await calculateMatches([updatedMatch], interaction.client);
  logger.info(`Immediate calculation triggered for match ${matchId + 1}`);

  await postMatchBreakdown(interaction, updatedMatch, matchDeltas?.[updatedMatch.id]);
  await postCurseResults(interaction, updatedMatch, matchDeltas?.[updatedMatch.id]);
  await postStandings(interaction);
  await postMatchRoast(interaction, updatedMatch);
});

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
    const allWin = entries.every((e) => e.isWinner);
    const allLose = entries.every((e) => !e.isWinner);

    const lines = entries.map((e) => {
      const sign = e.delta >= 0 ? '+' : '';
      const icon = e.isWinner ? '👑' : '🤡';
      const tag = e.random ? (e.usedRandom ? ' 🎲' : ' 🤖') : '';
      return `${icon} **${e.name}** — ${e.pick.toUpperCase()}${tag} → **${sign}${e.delta}** pts`;
    });

    if (allWin) {
      lines.push('', await pickLine('all_win'));
    } else if (allLose) {
      lines.push('', await pickLine('all_lose'));
    }

    const embed = new EmbedBuilder()
      .setTitle(`💰  Sổ sách trận #${match.id}`)
      .setDescription(lines.join('\n'))
      .setColor(allWin ? 0x57F287 : allLose ? 0xED4245 : 0x5865F2)
      .setTimestamp();

    await interaction.followUp({ embeds: [embed] });
  } catch (err) {
    logger.error('Failed to post match breakdown:', err);
  }
}

async function postCurseResults(interaction, match, deltas) {
  try {
    const curses = await readCurses();
    const matchCurses = curses[match.id];
    if (!matchCurses || Object.keys(matchCurses).length === 0) return;

    const winner = getWinner(match);
    if (!winner) return;

    const users = interaction.client.cachedUsers;

    const lines = [];
    for (const [curserId, { target }] of Object.entries(matchCurses)) {
      const curserName = users[curserId]?.nickname || 'Unknown';
      const targetName = users[target]?.nickname || 'Unknown';

      const targetPick = deltas?.[target]?.pick ?? null;
      if (targetPick === null) continue;

      const targetCorrect = targetPick === winner;
      const autoTag = deltas?.[target]?.random
        ? (deltas[target].usedRandom ? ' *(random)*' : ' *(auto)*')
        : '';
      if (targetCorrect) {
        lines.push(`🧿 **${curserName}** nguyền **${targetName}**${autoTag} — người đó đúng! **${curserName}** mất **${CURSE_PTS}** pts. ${await pickLine('curse_lose')}`);
      } else {
        lines.push(`🧿 **${curserName}** nguyền **${targetName}**${autoTag} — người đó sai! **${curserName}** ăn **${CURSE_PTS}** pts. ${await pickLine('curse_win')}`);
      }
    }

    if (lines.length === 0) return;

    const embed = new EmbedBuilder()
      .setTitle(`🧿  Bùa chú trận #${match.id}`)
      .setDescription(lines.join('\n'))
      .setColor(0x9B59B6)
      .setTimestamp();

    await interaction.followUp({ embeds: [embed] });
  } catch (err) {
    logger.error('Failed to post curse results:', err);
  }
}

async function postMatchRoast(interaction, match) {
  try {
    if (!match.messageId) return;
    const votes = await readMatchVotes(match.id, match.messageId);
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
    const lines = [];
    for (const name of roasted) {
      lines.push(`🤡 **${name}** ${await pickLine('roast')}`);
    }

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
    const players = await readPlayers();
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
    if (leader.points <= 0) return;

    const bottom = ranked[ranked.length - 1];

    const leaderLine = await pickLine('leader');
    const bottomLine = await pickLine('bottom');

    const lines = [
      `👑 **${leader.nickname}** ${leaderLine} (${VND_FORMATTER.format(leader.points * 1000)})`,
      '',
      `💀 **${bottom.nickname}** ${bottomLine} (${VND_FORMATTER.format(bottom.points * 1000)})`,
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
