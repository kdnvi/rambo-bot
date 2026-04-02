import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { readTournamentData, readTournamentConfig } from '../utils/firebase.js';
import logger from '../utils/logger.js';

export const data = new SlashCommandBuilder()
  .setName('schedule')
  .setDescription('View upcoming matches')
  .addIntegerOption(option => option.setName('count')
    .setDescription('Number of upcoming matches to show (default 5)')
    .setMinValue(1)
    .setMaxValue(10)
    .setRequired(false));

export async function execute(interaction) {
  try {
    const config = await readTournamentConfig();
    const tournamentName = config?.name || 'Tournament';
    const count = interaction.options.get('count')?.value || 5;
    const allMatches = (await readTournamentData('matches')).val();

    const now = Date.now();
    const upcoming = allMatches
      .filter((m) => Date.parse(m.date) > now && !m.hasResult)
      .sort((a, b) => Date.parse(a.date) - Date.parse(b.date))
      .slice(0, count);

    if (upcoming.length === 0) {
      const embed = new EmbedBuilder()
        .setTitle('📅  No Upcoming Matches')
        .setDescription('All matches have been played or no schedule is available.')
        .setColor(0xFEE75C);
      interaction.reply({ embeds: [embed], ephemeral: true });
      return;
    }

    const lines = upcoming.map((m) => {
      const ts = Math.floor(Date.parse(m.date) / 1000);
      return `**#${m.id}**  ${m.home.toUpperCase()} vs ${m.away.toUpperCase()}\n` +
        `> 🕐 <t:${ts}:f> (<t:${ts}:R>)\n` +
        `> 🏟️ ${m.location}`;
    });

    const embed = new EmbedBuilder()
      .setTitle(`📅  ${tournamentName} — Upcoming Matches`)
      .setDescription(lines.join('\n\n'))
      .setColor(0x5865F2)
      .setFooter({ text: `Showing next ${upcoming.length} match(es)` })
      .setTimestamp();

    interaction.reply({ embeds: [embed] });
  } catch (err) {
    logger.error(err);
    interaction.reply({ content: '❌ Failed to load the schedule.', ephemeral: true });
  }
}
