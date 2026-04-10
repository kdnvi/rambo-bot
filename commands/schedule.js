import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import { withErrorHandler, getTournamentName, requireMatches } from '../utils/command.js';

export const data = new SlashCommandBuilder()
  .setName('schedule')
  .setDescription('Lịch sắp tới — chuẩn bị tinh thần đi')
  .addIntegerOption(option => option.setName('count')
    .setDescription('Số trận muốn xem (mặc định 5)')
    .setMinValue(1)
    .setMaxValue(10)
    .setRequired(false));

export const execute = withErrorHandler(async (interaction) => {
  const tournamentName = await getTournamentName();
  const count = interaction.options.get('count')?.value || 5;
  const allMatches = await requireMatches(interaction);
  if (!allMatches) return;

  const now = Date.now();
  const upcoming = allMatches
    .filter((m) => Date.parse(m.date) > now && !m.hasResult)
    .sort((a, b) => Date.parse(a.date) - Date.parse(b.date))
    .slice(0, count);

  if (upcoming.length === 0) {
    const embed = new EmbedBuilder()
      .setTitle('📅  Không có trận sắp tới')
      .setDescription('Hết trận rồi, hoặc chưa có lịch mới.')
      .setColor(0xFEE75C);
    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    return;
  }

  const lines = upcoming.map((m) => {
    const ts = Math.floor(Date.parse(m.date) / 1000);
    return `**#${m.id}**  ${m.home.toUpperCase()} vs ${m.away.toUpperCase()}\n` +
      `> 🕐 <t:${ts}:f> (<t:${ts}:R>)\n` +
      `> 🏟️ ${m.location}`;
  });

  const embed = new EmbedBuilder()
    .setTitle(`📅  ${tournamentName} — Lịch thi đấu sắp tới`)
    .setDescription(lines.join('\n\n'))
    .setColor(0x5865F2)
    .setFooter({ text: `${upcoming.length} trận tiếp theo` })
    .setTimestamp();

  await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
});
