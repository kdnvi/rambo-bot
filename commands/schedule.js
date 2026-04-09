import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import { readTournamentData, readTournamentConfig } from '../utils/firebase.js';
import logger from '../utils/logger.js';

export const data = new SlashCommandBuilder()
  .setName('schedule')
  .setDescription('Lịch sắp tới — chuẩn bị tinh thần đi')
  .addIntegerOption(option => option.setName('count')
    .setDescription('Số trận muốn xem (mặc định 5)')
    .setMinValue(1)
    .setMaxValue(10)
    .setRequired(false));

export async function execute(interaction) {
  try {
    const config = await readTournamentConfig();
    const tournamentName = config?.name || 'Tournament';
    const count = interaction.options.get('count')?.value || 5;
    const allMatches = (await readTournamentData('matches')).val();

    if (!allMatches) {
      await interaction.reply({ content: '❌ Không có dữ liệu trận đấu.', flags: MessageFlags.Ephemeral });
      return;
    }

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

    await interaction.reply({ embeds: [embed] });
  } catch (err) {
    logger.error(err);
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({ content: '❌ Không thể tải lịch thi đấu.', flags: MessageFlags.Ephemeral }).catch(() => {});
    }
  }
}
