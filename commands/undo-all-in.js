import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import { readTournamentData, readPlayers, readPlayerAllIns, removePlayerAllIn } from '../utils/firebase.js';
import { pick, VND_FORMATTER } from '../utils/helper.js';
import logger from '../utils/logger.js';

const RELIEF_LINES = [
  'came to their senses. Barely.',
  'woke up in a cold sweat and hit undo.',
  'realized "YOLO" is not a financial strategy.',
  'pulled back from the abyss. Smart move.',
  'decided they like having points after all.',
  'looked at their balance and panicked.',
];

export const data = new SlashCommandBuilder()
  .setName('undo-all-in')
  .setDescription('Remove your all-in bet (if the match hasn\'t started yet)');

export async function execute(interaction) {
  try {
    const userId = interaction.user.id;

    const players = (await readPlayers()).val();
    if (!players || !players[userId]) {
      await interaction.reply({ content: '❌ You need to `/register` first.', flags: MessageFlags.Ephemeral });
      return;
    }

    const allMatches = (await readTournamentData('matches')).val();
    if (!allMatches) {
      await interaction.reply({ content: '❌ No match data available.', flags: MessageFlags.Ephemeral });
      return;
    }

    const allIns = await readPlayerAllIns(userId);
    const now = Date.now();

    let activeMatchId = null;
    let activeMatch = null;
    let activeAmount = 0;
    for (const [matchId, entry] of Object.entries(allIns)) {
      const match = allMatches.find((m) => m.id === Number(matchId));
      if (match && Date.parse(match.date) > now) {
        activeMatchId = Number(matchId);
        activeMatch = match;
        activeAmount = entry.amount;
        break;
      }
    }

    if (!activeMatchId) {
      const embed = new EmbedBuilder()
        .setTitle('🤷  No Active All-In')
        .setDescription('You don\'t have any active all-in bets to remove.')
        .setColor(0xFEE75C);
      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      return;
    }

    await removePlayerAllIn(userId, activeMatchId);

    const embed = new EmbedBuilder()
      .setTitle('😮‍💨  ALL-IN CANCELLED')
      .setDescription(
        `**${interaction.user}** ${pick(RELIEF_LINES)}\n\n` +
        `🎰 All-in of **${VND_FORMATTER.format(activeAmount * 1000)}** on Match #${activeMatchId} ` +
        `(${activeMatch.home.toUpperCase()} vs ${activeMatch.away.toUpperCase()}) has been removed.\n` +
        'Your balance is safe... for now.'
      )
      .setColor(0xFEE75C)
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  } catch (err) {
    logger.error(err);
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({ content: '❌ Failed to remove all-in.', flags: MessageFlags.Ephemeral }).catch(() => {});
    }
  }
}
