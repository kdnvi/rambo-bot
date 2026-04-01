import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { readPlayers, readTournamentConfig } from '../utils/firebase.js';
import logger from '../utils/logger.js';

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
        nickname: users[key].nickname,
        balance: value.points,
        avatar: users[key].avatarURL,
      });
    }
    rankedPlayers.sort((a, b) => b.balance - a.balance);

    const embeds = [];
    const formatter = new Intl.NumberFormat('vi-VN', {
      style: 'currency',
      currency: 'VND',
    });

    rankedPlayers.forEach((player, index) => {
      embeds.push(new EmbedBuilder()
        .setTitle(`Rank No. ${index + 1}`)
        .setDescription(`Balance: ${formatter.format(player.balance * 1000)}`)
        .setAuthor({ name: player.nickname, iconURL: player.avatar })
      );
    });

    interaction.reply({
      content: `${tournamentName} Leaderboard`,
      embeds: embeds
    });
  } catch (err) {
    logger.error(err);
  }
}
