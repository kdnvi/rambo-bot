import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import { readTournamentData, readTournamentConfig } from '../utils/firebase.js';
import logger from '../utils/logger.js';

export const data = new SlashCommandBuilder()
  .setName('group')
  .setDescription('Bảng đấu — xem ai đang sống ai đang chết')
  .addStringOption(option => option.setName('name')
    .setDescription('Chữ bảng (A–L), bỏ trống = xem hết')
    .setRequired(false));

export async function execute(interaction) {
  try {
    const config = await readTournamentConfig();
    const tournamentName = config?.name || 'Tournament';
    const groups = (await readTournamentData('groups')).val();

    if (!groups) {
      const embed = new EmbedBuilder()
        .setTitle('📊  Chưa có bảng')
        .setDescription('Chưa có dữ liệu bảng.')
        .setColor(0xFEE75C);
      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      return;
    }

    const requested = interaction.options.get('name')?.value?.toLowerCase();

    if (requested && !groups[requested]) {
      const validGroups = Object.keys(groups).sort().map((g) => `\`${g.toUpperCase()}\``).join(', ');
      const embed = new EmbedBuilder()
        .setTitle('❌  Không tìm thấy bảng')
        .setDescription(`Không có bảng \`${requested.toUpperCase()}\`. Chỉ có: ${validGroups}`)
        .setColor(0xED4245);
      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
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
      .setTitle(`📊  ${tournamentName} — Bảng đấu`)
      .setColor(0x5865F2)
      .setTimestamp();

    if (requested) {
      title.setDescription(`Hiển thị Bảng ${requested.toUpperCase()}`);
    }

    const allEmbeds = [title, ...embeds];
    await interaction.reply({ embeds: allEmbeds.slice(0, 10) });
    for (let i = 10; i < allEmbeds.length; i += 10) {
      await interaction.followUp({ embeds: allEmbeds.slice(i, i + 10) });
    }
  } catch (err) {
    logger.error(err);
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({ content: '❌ Không thể tải bảng xếp hạng.', flags: MessageFlags.Ephemeral }).catch(() => {});
    }
  }
}
