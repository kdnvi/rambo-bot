import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { readPlayers, readTournamentConfig } from '../utils/firebase.js';
import logger from '../utils/logger.js';

const MEDAL = ['🥇', '🥈', '🥉'];

const formatter = new Intl.NumberFormat('vi-VN', {
  style: 'currency',
  currency: 'VND',
});

export const data = new SlashCommandBuilder()
  .setName('rank')
  .setDescription('Player ranking for the current tournament');

export async function execute(interaction) {
  try {
    const config = await readTournamentConfig();
    const tournamentName = config?.name || 'Tournament';
    const players = (await readPlayers()).val();
    const users = interaction.client.cachedUsers;
    const rankedPlayers = [];

    for (const [key, value] of Object.entries(players)) {
      rankedPlayers.push({
        nickname: users[key]?.nickname || 'Unknown',
        balance: value.points,
        matches: value.matches || 0,
        avatar: users[key]?.avatarURL,
      });
    }
    rankedPlayers.sort((a, b) => b.balance - a.balance);

    const lines = rankedPlayers.map((player, i) => {
      const rank = MEDAL[i] || `\`${i + 1}.\``;
      const balance = formatter.format(player.balance * 1000);
      return `${rank} **${player.nickname}** — ${balance}  *(${player.matches} matches)*`;
    });

    const embed = new EmbedBuilder()
      .setTitle(`🏆  ${tournamentName} Leaderboard`)
      .setDescription(lines.join('\n'))
      .setColor(0xFFD700)
      .setFooter({ text: `${rankedPlayers.length} players registered` })
      .setTimestamp();

    if (rankedPlayers.length > 0 && rankedPlayers[0].avatar) {
      embed.setThumbnail(rankedPlayers[0].avatar);
    }

    interaction.reply({ embeds: [embed] });
  } catch (err) {
    logger.error(err);
    interaction.reply({ content: '❌ Failed to load the leaderboard.', ephemeral: true });
  }
}
