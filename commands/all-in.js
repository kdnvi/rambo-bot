import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import { readTournamentData, readPlayers, readPlayerAllIn, setPlayerAllIn } from '../utils/firebase.js';
import logger from '../utils/logger.js';

const formatter = new Intl.NumberFormat('vi-VN', {
  style: 'currency',
  currency: 'VND',
});

export const data = new SlashCommandBuilder()
  .setName('all-in')
  .setDescription('Bet your ENTIRE balance on a match (once per tournament!)')
  .addIntegerOption(option => option.setName('match-id')
    .setDescription('Match ID to go all-in on')
    .setMinValue(1)
    .setRequired(true));

export async function execute(interaction) {
  try {
    const userId = interaction.user.id;
    const matchId = interaction.options.get('match-id').value;

    const players = (await readPlayers()).val();
    if (!players || !players[userId]) {
      const embed = new EmbedBuilder()
        .setTitle('❌  Not Registered')
        .setDescription('You need to `/register` first.')
        .setColor(0xED4245);
      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      return;
    }

    const balance = players[userId].points;
    if (balance <= 0) {
      const embed = new EmbedBuilder()
        .setTitle('💸  No Balance')
        .setDescription(
          `Your balance is **${formatter.format(balance * 1000)}**. You need a positive balance to go all-in.`
        )
        .setColor(0xED4245);
      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      return;
    }

    const existing = await readPlayerAllIn(userId);
    if (existing) {
      const embed = new EmbedBuilder()
        .setTitle('⚠️  Already Used')
        .setDescription(
          `You already went all-in on match \`#${existing.matchId}\` with **${formatter.format(existing.amount * 1000)}**.` +
          '\nThis can only be used **once** per tournament.'
        )
        .setColor(0xFEE75C);
      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      return;
    }

    const allMatches = (await readTournamentData('matches')).val();
    if (!allMatches) {
      await interaction.reply({ content: '❌ No match data available.', flags: MessageFlags.Ephemeral });
      return;
    }

    const match = allMatches.find((m) => m.id === matchId);
    if (!match) {
      const embed = new EmbedBuilder()
        .setTitle('❌  Match Not Found')
        .setDescription(`No match with ID \`${matchId}\`.`)
        .setColor(0xED4245);
      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      return;
    }

    if (Date.parse(match.date) <= Date.now()) {
      const embed = new EmbedBuilder()
        .setTitle('⏰  Too Late')
        .setDescription('This match has already started.')
        .setColor(0xFEE75C);
      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      return;
    }

    await setPlayerAllIn(userId, matchId, balance);

    const embed = new EmbedBuilder()
      .setTitle('🔥  ALL IN!')
      .setDescription(
        `**Match #${matchId}:** ${match.home.toUpperCase()} vs ${match.away.toUpperCase()}\n\n` +
        `You are betting **${formatter.format(balance * 1000)}** on this match.\n` +
        'Win → **double your balance**. Lose → **back to zero**.\n\n' +
        '⚠️ This cannot be undone!'
      )
      .setColor(0xED4245)
      .setFooter({ text: `${interaction.user.displayName} — one-time use` })
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  } catch (err) {
    logger.error(err);
    if (!interaction.replied) {
      await interaction.reply({ content: '❌ Failed to activate all-in.', flags: MessageFlags.Ephemeral }).catch(() => {});
    }
  }
}
