import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import { readTournamentData, readTournamentConfig, readAllVotes } from '../utils/firebase.js';
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
    if (!matches) {
      await interaction.reply({ content: '❌ No match data available.', flags: MessageFlags.Ephemeral });
      return;
    }

    if (optionalMatchId === null) {
      matches = matches.filter((match) => match.hasResult).slice(-3);
    } else {
      matches = matches.filter((match) => match.hasResult && match.id === parseInt(optionalMatchId.value));
    }

    if (matches.length === 0) {
      const embed = new EmbedBuilder()
        .setTitle('🔍  No Results Found')
        .setDescription('Either the match does not exist or has not produced a result yet.')
        .setColor(0xFEE75C);
      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      return;
    }

    const votes = await readAllVotes();
    const users = interaction.client.cachedUsers;
    const embeds = [];

    matches.forEach((match) => {
      const matchId = `${match.id - 1}`;
      const winner = getWinner(match);
      const resultLine = `**${match.home.toUpperCase()}** ${match.result.home} - ${match.result.away} **${match.away.toUpperCase()}**`;

      const embed = new EmbedBuilder()
        .setTitle(`⚽  Match ${match.id}: ${match.home.toUpperCase()} vs ${match.away.toUpperCase()}`)
        .setColor(0x5865F2)
        .addFields(
          { name: '📊 Result', value: resultLine, inline: false },
        );

      if (votes && matchId in votes && match.messageId && match.messageId in votes[matchId]) {
        const voteEntries = Object.entries(votes[matchId][match.messageId]);
        const voteLines = voteEntries.map(([k, v]) => {
          const name = users[k]?.nickname || 'Unknown';
          const isCorrect = v.vote === winner;
          const icon = isCorrect ? '✅' : '❌';
          return `${icon} **${name}** — ${v.vote.toUpperCase()}`;
        });

        embed.addFields({ name: '🗳️ Votes', value: voteLines.join('\n') || 'No votes', inline: false });
      } else {
        embed.addFields({ name: '🗳️ Votes', value: '*No votes recorded*', inline: false });
      }

      embeds.push(embed);
    });

    const header = new EmbedBuilder()
      .setTitle(`📜  ${tournamentName} — Vote History`)
      .setColor(0x5865F2)
      .setDescription(
        optionalMatchId
          ? `Showing match #${optionalMatchId.value}`
          : `Showing last ${matches.length} completed match(es)`
      )
      .setTimestamp();

    await interaction.reply({ embeds: [header, ...embeds] });
  } catch (err) {
    logger.error(err);
    if (!interaction.replied) {
      await interaction.reply({ content: '❌ Failed to load vote history.', flags: MessageFlags.Ephemeral }).catch(() => {});
    }
  }
}

function getWinner(match) {
  if (match.result.home > match.result.away) return match.home;
  if (match.result.home < match.result.away) return match.away;
  return 'draw';
}
