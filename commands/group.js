import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import { readTournamentData } from '../utils/firebase.js';
import { withErrorHandler, getTournamentName } from '../utils/command.js';

export const data = new SlashCommandBuilder()
  .setName('group')
  .setDescription('Bảng đấu — xem ai đang sống ai đang chết')
  .addStringOption(option => option.setName('name')
    .setDescription('Chữ bảng (A–L), bỏ trống = xem hết')
    .setRequired(false));

export const execute = withErrorHandler(async (interaction) => {
  const tournamentName = await getTournamentName();
  const groups = await readTournamentData('groups');

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
  const RANK_ICONS = ['🥇', '🥈', '🥉', '4.'];
  const GROUPS_PER_EMBED = 3;

  const groupBlocks = groupKeys.map((key) => {
    const teams = Object.entries(groups[key])
      .map(([name, s]) => ({ name, ...s }))
      .sort((a, b) => b.points - a.points || b.goalDifference - a.goalDifference || b.for - a.for);

    const rows = teams.map((t, i) => {
      const gd = t.goalDifference >= 0 ? `+${t.goalDifference}` : `${t.goalDifference}`;
      return `${RANK_ICONS[i] || `${i + 1}.`} **${t.name.toUpperCase()}** · ${t.won}W ${t.drawn}D ${t.lost}L · ${gd} · **${t.points}**pts`;
    });

    return `📊 **Group ${key.toUpperCase()}**\n${rows.join('\n')}`;
  });

  const embeds = [];
  for (let i = 0; i < groupBlocks.length; i += GROUPS_PER_EMBED) {
    const chunk = groupBlocks.slice(i, i + GROUPS_PER_EMBED);
    embeds.push(
      new EmbedBuilder()
        .setDescription(chunk.join('\n\n'))
        .setColor(0x5865F2)
    );
  }

  const title = new EmbedBuilder()
    .setTitle(`📊  ${tournamentName} — Bảng đấu`)
    .setColor(0x5865F2)
    .setTimestamp();

  if (requested) {
    title.setDescription(groupBlocks[0]);
    await interaction.reply({ embeds: [title] });
    return;
  }

  const allEmbeds = [title, ...embeds];
  await interaction.reply({ embeds: allEmbeds.slice(0, 10) });
});
