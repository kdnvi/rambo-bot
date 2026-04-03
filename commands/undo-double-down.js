import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import { readTournamentData, readPlayers, readPlayerWagers, removePlayerWager } from '../utils/firebase.js';
import logger from '../utils/logger.js';

const CHICKEN_LINES = [
  'got cold feet. Understandable.',
  'decided playing it safe is a lifestyle.',
  'backed down. The pressure was too much.',
  'unchose violence. Boring, but wise.',
  'pulled the ripcord. Parachute deployed.',
  'realized bravery isn\'t for everyone.',
];

export const data = new SlashCommandBuilder()
  .setName('undo-double-down')
  .setDescription('Remove your double-down (if the match hasn\'t started yet)');

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

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

    const wagers = await readPlayerWagers();
    const myWagers = wagers[userId] || {};
    const now = Date.now();

    let activeMatchId = null;
    let activeMatch = null;
    for (const [matchId, wager] of Object.entries(myWagers)) {
      if (wager.type === 'double-down') {
        const match = allMatches.find((m) => m.id === Number(matchId));
        if (match && Date.parse(match.date) > now) {
          activeMatchId = Number(matchId);
          activeMatch = match;
          break;
        }
      }
    }

    if (!activeMatchId) {
      const embed = new EmbedBuilder()
        .setTitle('🤷  No Active Double-Down')
        .setDescription('You don\'t have any active double-downs to remove.')
        .setColor(0xFEE75C);
      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      return;
    }

    await removePlayerWager(userId, activeMatchId);

    const embed = new EmbedBuilder()
      .setTitle('🐔  DOUBLE-DOWN CANCELLED')
      .setDescription(
        `**${interaction.user}** ${pick(CHICKEN_LINES)}\n\n` +
        `⏫ Double-down on Match #${activeMatchId} ` +
        `(${activeMatch.home.toUpperCase()} vs ${activeMatch.away.toUpperCase()}) has been removed.\n` +
        'Back to normal stakes.'
      )
      .setColor(0xFEE75C)
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  } catch (err) {
    logger.error(err);
    if (!interaction.replied) {
      await interaction.reply({ content: '❌ Failed to remove double-down.', flags: MessageFlags.Ephemeral }).catch(() => {});
    }
  }
}
