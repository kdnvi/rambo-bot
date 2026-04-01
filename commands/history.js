import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { readTournamentData, readTournamentConfig } from '../utils/firebase.js';
import logger from '../utils/logger.js';

export const data = new SlashCommandBuilder()
  .setName('history')
  .setDescription('Player vote history for the current tournament')
  .addIntegerOption(option => option.setName('match-id')
    .setDescription('Match ID')
    .setRequired(false));

export async function execute(interaction) {
  try {
    const config = await readTournamentConfig();
    const tournamentName = config?.name || 'Tournament';
    const optionalMatchId = interaction.options.get('match-id');
    let matches = (await readTournamentData('matches')).val();
    if (optionalMatchId === null) {
      matches = matches.filter((match) => match.hasResult).slice(-3);
    } else {
      matches = matches.filter((match) => match.hasResult && match.id === parseInt(optionalMatchId.value));
    }

    if (matches.length === 0) {
      interaction.reply('Either match does not exist or has not produced result yet!');
      return;
    }

    const votes = (await readTournamentData('votes')).val();
    const users = interaction.client.cachedUsers;
    const embeds = [];
    matches.forEach((match) => {
      const matchId = `${match.id - 1}`;
      if (matchId in votes && match.messageId in votes[matchId]) {
        const embed = new EmbedBuilder()
          .setTitle(`Match ${match.id}: ${match.home.toUpperCase()} vs. ${match.away.toUpperCase()}`)
          .setDescription(`Odds: \`${match.odds.home}\` - \`${match.odds.draw}\` - \`${match.odds.away}\``);

        for (const [k, v] of Object.entries(votes[matchId][match.messageId])) {
          embed.addFields({
            name: users[k].nickname,
            value: v.vote.toUpperCase(),
            inline: true,
          });
        }

        embeds.push(embed);
      }
    });

    interaction.reply({
      content: `${tournamentName} Vote History`,
      embeds: embeds
    });
  } catch (err) {
    logger.error(err);
  }
}
