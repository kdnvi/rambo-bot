import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import { readTournamentData, readMatchVotes } from '../utils/firebase.js';
import { getMatchStake } from '../utils/football.js';
import { getWinner } from '../utils/helper.js';
import { withErrorHandler, getTournamentName } from '../utils/command.js';

export const data = new SlashCommandBuilder()
  .setName('match')
  .setDescription('Chi tiết trận đấu — ai đúng ai sai, rõ ràng')
  .addIntegerOption(option => option.setName('id')
    .setDescription('ID trận (bỏ trống = trận gần nhất)')
    .setMinValue(1)
    .setRequired(false));

export const execute = withErrorHandler(async (interaction) => {
  const tournamentName = await getTournamentName();
  const allMatches = await readTournamentData('matches');

  if (!allMatches) {
    await interaction.reply({ content: '❌ Không có dữ liệu trận đấu.', flags: MessageFlags.Ephemeral });
    return;
  }

  const matchIdOption = interaction.options.get('id')?.value;
  let match;
  if (matchIdOption) {
    match = allMatches.find((m) => m.id === matchIdOption);
  } else {
    match = allMatches
      .filter((m) => m.hasResult)
      .sort((a, b) => Date.parse(b.date) - Date.parse(a.date))[0];
  }

  if (!match) {
    const embed = new EmbedBuilder()
      .setTitle('❌  Không tìm thấy trận')
      .setDescription(matchIdOption ? `Không có trận nào ID \`${matchIdOption}\` cả.` : 'Chưa có trận nào xong.')
      .setColor(0xED4245);
    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    return;
  }

  const kickoff = new Date(match.date);
  const ts = Math.floor(kickoff.getTime() / 1000);
  const now = Date.now();
  const hasStarted = kickoff.getTime() <= now;

  let status;
  if (match.hasResult) {
    status = `✅ Kết thúc — **${match.home.toUpperCase()}** ${match.result.home} - ${match.result.away} **${match.away.toUpperCase()}**`;
  } else if (hasStarted) {
    status = '🔴 Đang đá / chờ kết quả';
  } else {
    status = `🟢 Sắp đá — <t:${ts}:R>`;
  }

  const stake = getMatchStake(match.id);
  const embed = new EmbedBuilder()
    .setTitle(`⚽  Match #${match.id}: ${match.home.toUpperCase()} vs ${match.away.toUpperCase()}`)
    .setDescription(`**${tournamentName}**\n\n${status}`)
    .setColor(match.hasResult ? 0x57F287 : hasStarted ? 0xED4245 : 0x5865F2)
    .addFields(
      { name: '🕐 Giờ đá', value: `<t:${ts}:f>`, inline: true },
      { name: '🏟️ Sân', value: match.location, inline: true },
      { name: '💰 Cược', value: `${stake} pts`, inline: true },
    )
    .setTimestamp();

  if (hasStarted && match.messageId) {
    const votes = await readMatchVotes(match.id, match.messageId);
    if (votes) {
      const users = interaction.client.cachedUsers;
      const winner = match.hasResult ? getWinner(match) : null;
      const grouped = {};
      for (const [userId, v] of Object.entries(votes)) {
        const pick = v.vote.toUpperCase();
        if (!grouped[pick]) grouped[pick] = [];
        const name = users[userId]?.nickname || 'Unknown';
        const icon = winner ? (v.vote === winner ? '👑' : '🤡') : '🗳️';
        grouped[pick].push(`${icon} ${name}`);
      }
      let voteLines = Object.entries(grouped)
        .map(([pick, names]) => `**${pick}**\n${names.join('\n')}`)
        .join('\n\n');
      if (voteLines.length > 1024) voteLines = voteLines.slice(0, 1021) + '...';
      embed.addFields({ name: '🗳️ Vote', value: voteLines, inline: false });
    } else {
      embed.addFields({ name: '🗳️ Vote', value: '*Không có vote*', inline: false });
    }
  }

  await interaction.reply({ embeds: [embed] });
});
