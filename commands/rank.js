import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import { readPlayers, readTournamentConfig, readAllBadges } from '../utils/firebase.js';
import { formatBadges } from '../utils/badges.js';
import { VND_FORMATTER } from '../utils/helper.js';
import logger from '../utils/logger.js';

const MEDAL = ['🥇', '🥈', '🥉'];

export const data = new SlashCommandBuilder()
  .setName('rank')
  .setDescription('Player ranking for the current tournament');

export async function execute(interaction) {
  try {
    const config = await readTournamentConfig();
    const tournamentName = config?.name || 'Tournament';
    const players = (await readPlayers()).val();

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
  } catch (err) {
    logger.error(err);
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({ content: '❌ Không thể tải bảng xếp hạng.', flags: MessageFlags.Ephemeral }).catch(() => {});
    }
  }
}
