import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import { readTournamentData, readTournamentConfig, readMatchVotes } from '../utils/firebase.js';
import { getMatchStake } from '../utils/football.js';
import logger from '../utils/logger.js';

export const data = new SlashCommandBuilder()
  .setName('match')
  .setDescription('Look up details for a specific match')
  .addIntegerOption(option => option.setName('id')
    .setDescription('Match ID (defaults to last finished match)')
    .setMinValue(1)
    .setRequired(false));

export async function execute(interaction) {
  try {
    const config = await readTournamentConfig();
    const tournamentName = config?.name || 'Tournament';
    const allMatches = (await readTournamentData('matches')).val();

    if (!allMatches) {
      await interaction.reply({ content: '❌ No match data available.', flags: MessageFlags.Ephemeral });
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
        .setTitle('❌  Match Not Found')
        .setDescription(matchIdOption ? `No match with ID \`${matchIdOption}\`.` : 'No finished matches yet.')
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
      status = `✅ Finished — **${match.home.toUpperCase()}** ${match.result.home} - ${match.result.away} **${match.away.toUpperCase()}**`;
    } else if (hasStarted) {
      status = '🔴 In progress / awaiting result';
    } else {
      status = `🟢 Upcoming — <t:${ts}:R>`;
    }

    const stake = getMatchStake(match.id);
    const embed = new EmbedBuilder()
      .setTitle(`⚽  Match #${match.id}: ${match.home.toUpperCase()} vs ${match.away.toUpperCase()}`)
      .setDescription(`**${tournamentName}**\n\n${status}`)
      .setColor(match.hasResult ? 0x57F287 : hasStarted ? 0xED4245 : 0x5865F2)
      .addFields(
        { name: '🕐 Kickoff', value: `<t:${ts}:f>`, inline: true },
        { name: '🏟️ Venue', value: match.location, inline: true },
        { name: '💰 Stake', value: `${stake} pts`, inline: true },
      )
      .setTimestamp();

    if (hasStarted && match.messageId) {
      const votes = (await readMatchVotes(match.id, match.messageId)).val();
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
        const voteLines = Object.entries(grouped)
          .map(([pick, names]) => `**${pick}**\n${names.join('\n')}`)
          .join('\n\n');
        embed.addFields({ name: '🗳️ Votes', value: voteLines, inline: false });
      } else {
        embed.addFields({ name: '🗳️ Votes', value: '*No votes recorded*', inline: false });
      }
    }

    await interaction.reply({ embeds: [embed] });
  } catch (err) {
    logger.error(err);
    if (!interaction.replied) {
      await interaction.reply({ content: '❌ Failed to load match details.', flags: MessageFlags.Ephemeral }).catch(() => {});
    }
  }
}

function getWinner(match) {
  if (match.result.home > match.result.away) return match.home;
  if (match.result.home < match.result.away) return match.away;
  return 'draw';
}
