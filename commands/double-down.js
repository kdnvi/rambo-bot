import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import { readTournamentData, readPlayers, readPlayerWagers, setPlayerWager } from '../utils/firebase.js';
import logger from '../utils/logger.js';

export const data = new SlashCommandBuilder()
  .setName('double-down')
  .setDescription('Double your stake on a match (1 per matchday)')
  .addIntegerOption(option => option.setName('match-id')
    .setDescription('Match ID to double down on')
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

    const matchDay = match.date.slice(0, 10);
    const sameDayMatchIds = allMatches
      .filter((m) => m.date.startsWith(matchDay))
      .map((m) => m.id);

    const wagers = await readPlayerWagers();
    const myWagers = wagers[userId] || {};

    const alreadyThisDay = sameDayMatchIds.some((id) => myWagers[id]?.type === 'double-down');
    if (alreadyThisDay) {
      const usedId = sameDayMatchIds.find((id) => myWagers[id]?.type === 'double-down');
      const embed = new EmbedBuilder()
        .setTitle('⚠️  Already Used')
        .setDescription(`You already used double-down on match \`#${usedId}\` today.`)
        .setColor(0xFEE75C);
      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      return;
    }

    await setPlayerWager(userId, matchId, 'double-down');

    const embed = new EmbedBuilder()
      .setTitle('⏫  Double Down Activated!')
      .setDescription(
        `**Match #${matchId}:** ${match.home.toUpperCase()} vs ${match.away.toUpperCase()}\n\n` +
        'Your stake is now **2x** for this match. Good luck!'
      )
      .setColor(0x57F287)
      .setFooter({ text: `${interaction.user.displayName}` })
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  } catch (err) {
    logger.error(err);
    if (!interaction.replied) {
      await interaction.reply({ content: '❌ Failed to activate double-down.', flags: MessageFlags.Ephemeral }).catch(() => {});
    }
  }
}
