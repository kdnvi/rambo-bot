import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { readPlayers, readAllBadges } from '../utils/firebase.js';
import { formatBadges } from '../utils/badges.js';
import { VND_FORMATTER } from '../utils/helper.js';
import { withErrorHandler, getTournamentName } from '../utils/command.js';

const MEDAL = ['🥇', '🥈', '🥉'];

export const data = new SlashCommandBuilder()
  .setName('rank')
  .setDescription('Bảng xếp hạng — ai đầu bảng, ai đội sổ');

export const execute = withErrorHandler(async (interaction) => {
  const tournamentName = await getTournamentName();
  const players = await readPlayers();

  if (!players) {
    const embed = new EmbedBuilder()
      .setTitle(`🏆  ${tournamentName} Bảng xếp hạng`)
      .setDescription('Chưa ai đăng ký cả. `/register` đi rồi chiến!')
      .setColor(0xFEE75C);
    await interaction.reply({ embeds: [embed] });
    return;
  }

  const users = interaction.client.cachedUsers;
  const allBadges = await readAllBadges();

  const rankedPlayers = [];
  for (const [key, value] of Object.entries(players)) {
    rankedPlayers.push({
      nickname: users[key]?.nickname || 'Unknown',
      balance: value.points,
      matches: value.matches || 0,
      avatar: users[key]?.avatarURL,
      badgeStr: formatBadges(allBadges[key]),
    });
  }
  rankedPlayers.sort((a, b) => b.balance - a.balance);

  const lines = rankedPlayers.map((player, i) => {
    const rank = MEDAL[i] || `\`${i + 1}.\``;
    const balance = VND_FORMATTER.format(player.balance * 1000);
    const badges = player.badgeStr ? `  ${player.badgeStr}` : '';
    return `${rank} **${player.nickname}** — ${balance}  *(${player.matches} trận)*${badges}`;
  });

  const embed = new EmbedBuilder()
    .setTitle(`🏆  ${tournamentName} Bảng xếp hạng`)
    .setDescription(lines.join('\n'))
    .setColor(0xFFD700)
    .setFooter({ text: `${rankedPlayers.length} chiến binh` })
    .setTimestamp();

  if (rankedPlayers.length > 0 && rankedPlayers[0].avatar) {
    embed.setThumbnail(rankedPlayers[0].avatar);
  }

  await interaction.reply({ embeds: [embed] });
});
