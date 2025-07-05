import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { readOnceEuroPlayer } from '../utils/firebase.js';
import logger from '../utils/logger.js';

export const data = new SlashCommandBuilder()
  .setName('euro-rank')
  .setDescription('Euro 2024 player ranking');

export async function execute(interaction) {
  try {
    const players = (await readOnceEuroPlayer()).val();
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
      content: 'EURO Leaderboard',
      embeds: embeds
    });
  } catch (err) {
    logger.error(err);
  }
}
