import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import { readCurses, removeCurse } from '../utils/firebase.js';
import { requirePlayer, requireMatches, findActiveEntry, withErrorHandler } from '../utils/command.js';
import { pickLine } from '../utils/flavor.js';

export const data = new SlashCommandBuilder()
  .setName('uncurse')
  .setDescription('Hối hận rồi? Gỡ bùa trước giờ đá');

export const execute = withErrorHandler(async (interaction) => {
  const userId = interaction.user.id;

  const players = await requirePlayer(interaction, userId);
  if (!players) return;

  const allMatches = await requireMatches(interaction);
  if (!allMatches) return;

  const curses = await readCurses();
  const found = findActiveEntry(curses, allMatches, (matchCurses) => !!matchCurses[userId]);

  if (!found) {
    const embed = new EmbedBuilder()
      .setTitle('🤷  Không có lời nguyền')
      .setDescription('Đang không có nguyền ai cả, gỡ cái gì?')
      .setColor(0xFEE75C);
    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    return;
  }

  const activeCurseMatchId = found.matchId;
  const activeCurse = { ...found.entry[userId], match: found.match };

  await removeCurse(userId, activeCurseMatchId);

  const users = interaction.client.cachedUsers;
  const targetName = users[activeCurse.target]?.nickname || activeCurse.target;
  const reliefLine = await pickLine('relief');

  const embed = new EmbedBuilder()
    .setTitle('🕊️  GỠ LỜI NGUYỀN')
    .setDescription(
      `**${interaction.user}** ${reliefLine}\n\n` +
      `🧿 Lời nguyền lên **${targetName}** ở Trận #${activeCurseMatchId} ` +
      `(${activeCurse.match.home.toUpperCase()} vs ${activeCurse.match.away.toUpperCase()}) đã được gỡ bỏ.`
    )
    .setColor(0x57F287)
    .setTimestamp();

  await interaction.reply({ embeds: [embed] });
});
