import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { readTournamentData, readTournamentConfig } from '../utils/firebase.js';
import logger from '../utils/logger.js';

const VALID_GROUPS = 'abcdefghijkl'.split('');

export const data = new SlashCommandBuilder()
  .setName('group')
  .setDescription('View group standings')
  .addStringOption(option => option.setName('name')
    .setDescription('Group letter (A–L), or leave empty for all groups')
    .setRequired(false));

export async function execute(interaction) {
  try {
    const config = await readTournamentConfig();
    const tournamentName = config?.name || 'Tournament';
    const groups = (await readTournamentData('groups')).val();

    if (!groups) {
      const embed = new EmbedBuilder()
        .setTitle('📊  No Groups Available')
        .setDescription('Group data has not been configured yet.')
        .setColor(0xFEE75C);
      interaction.reply({ embeds: [embed], ephemeral: true });
      return;
    }

    const requested = interaction.options.get('name')?.value?.toLowerCase();

    if (requested && !groups[requested]) {
      const embed = new EmbedBuilder()
        .setTitle('❌  Group Not Found')
        .setDescription(`No group \`${requested.toUpperCase()}\`. Valid groups: ${VALID_GROUPS.filter((g) => groups[g]).map((g) => `\`${g.toUpperCase()}\``).join(', ')}`)
        .setColor(0xED4245);
      interaction.reply({ embeds: [embed], ephemeral: true });
      return;
    }

    const groupKeys = requested ? [requested] : Object.keys(groups).sort();
    const embeds = [];

    for (const key of groupKeys) {
      const teams = Object.entries(groups[key])
        .map(([name, s]) => ({ name, ...s }))
        .sort((a, b) => b.points - a.points || b.goalDifference - a.goalDifference || b.for - a.for);

      const header = '```\n' +
        'Team             P  W  D  L   GD  Pts\n' +
        '─────────────────────────────────────────\n';

      const rows = teams.map((t) => {
        const name = t.name.length > 16 ? t.name.substring(0, 15) + '.' : t.name;
        const gd = t.goalDifference >= 0 ? `+${t.goalDifference}` : `${t.goalDifference}`;
        return `${name.toUpperCase().padEnd(17)}${String(t.played).padStart(1)}  ${String(t.won).padStart(1)}  ${String(t.drawn).padStart(1)}  ${String(t.lost).padStart(1)}  ${gd.padStart(3)}  ${String(t.points).padStart(3)}`;
      });

      const table = header + rows.join('\n') + '\n```';

      embeds.push(
        new EmbedBuilder()
          .setTitle(`Group ${key.toUpperCase()}`)
          .setDescription(table)
          .setColor(0x5865F2)
      );
    }

    const title = new EmbedBuilder()
      .setTitle(`📊  ${tournamentName} — Group Standings`)
      .setColor(0x5865F2)
      .setTimestamp();

    if (requested) {
      title.setDescription(`Showing Group ${requested.toUpperCase()}`);
    }

    interaction.reply({ embeds: [title, ...embeds].slice(0, 10) });
  } catch (err) {
    logger.error(err);
    interaction.reply({ content: '❌ Failed to load group standings.', ephemeral: true });
  }
}
