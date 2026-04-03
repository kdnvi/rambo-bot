import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { readTournamentData, readTournamentConfig } from '../utils/firebase.js';
import logger from '../utils/logger.js';

export const data = new SlashCommandBuilder()
  .setName('match')
  .setDescription('Look up details for a specific match')
  .addIntegerOption(option => option.setName('id')
    .setDescription('Match ID')
    .setMinValue(1)
    .setRequired(true));

export async function execute(interaction) {
  try {
    const config = await readTournamentConfig();
    const tournamentName = config?.name || 'Tournament';
    const matchId = interaction.options.get('id').value;
    const allMatches = (await readTournamentData('matches')).val();

    if (!allMatches) {
      await interaction.reply({ content: '❌ No match data available.', ephemeral: true });
      return;
    }

    const match = allMatches.find((m) => m.id === matchId);

    if (!match) {
      const embed = new EmbedBuilder()
        .setTitle('❌  Match Not Found')
        .setDescription(`No match with ID \`${matchId}\`.`)
        .setColor(0xED4245);
      await interaction.reply({ embeds: [embed], ephemeral: true });
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

    const embed = new EmbedBuilder()
      .setTitle(`⚽  Match #${match.id}: ${match.home.toUpperCase()} vs ${match.away.toUpperCase()}`)
      .setDescription(`**${tournamentName}**\n\n${status}`)
      .setColor(match.hasResult ? 0x57F287 : hasStarted ? 0xED4245 : 0x5865F2)
      .addFields(
        { name: '🕐 Kickoff', value: `<t:${ts}:f>`, inline: true },
        { name: '🏟️ Venue', value: match.location, inline: true },
      )
      .setTimestamp();

    const hasOdds = match.odds && (match.odds.home > 0 || match.odds.draw > 0 || match.odds.away > 0);
    if (hasOdds) {
      embed.addFields(
        { name: '🏠 Home', value: `\`${match.odds.home}\``, inline: true },
        { name: '🤝 Draw', value: `\`${match.odds.draw}\``, inline: true },
        { name: '✈️ Away', value: `\`${match.odds.away}\``, inline: true },
      );
    }

    await interaction.reply({ embeds: [embed] });
  } catch (err) {
    logger.error(err);
    if (!interaction.replied) {
      await interaction.reply({ content: '❌ Failed to load match details.', ephemeral: true }).catch(() => {});
    }
  }
}
