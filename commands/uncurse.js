import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import { readTournamentData, readPlayers, readCurses, removeCurse } from '../utils/firebase.js';
import logger from '../utils/logger.js';

const RELIEF_LINES = [
  'has shown mercy... for now.',
  'decided to spare their victim. How noble.',
  'lifted the hex. The dark energy fades.',
  'called off the witch doctor.',
  'broke the voodoo doll in half. It\'s over.',
  'removed the evil eye. Sleep easy tonight.',
];

export const data = new SlashCommandBuilder()
  .setName('uncurse')
  .setDescription('Remove your active curse (if the match hasn\'t started yet)');

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

    const curses = await readCurses();
    const now = Date.now();

    let activeCurseMatchId = null;
    let activeCurse = null;
    for (const [matchId, matchCurses] of Object.entries(curses)) {
      if (matchCurses[userId]) {
        const match = allMatches.find((m) => m.id === Number(matchId));
        if (match && Date.parse(match.date) > now) {
          activeCurseMatchId = Number(matchId);
          activeCurse = { ...matchCurses[userId], match };
          break;
        }
      }
    }

    if (!activeCurseMatchId) {
      const embed = new EmbedBuilder()
        .setTitle('🤷  No Active Curse')
        .setDescription('You don\'t have any active curses to remove.')
        .setColor(0xFEE75C);
      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      return;
    }

    await removeCurse(userId, activeCurseMatchId);

    const users = interaction.client.cachedUsers;
    const targetName = users[activeCurse.target]?.nickname || activeCurse.target;

    const embed = new EmbedBuilder()
      .setTitle('🕊️  CURSE LIFTED')
      .setDescription(
        `**${interaction.user}** ${pick(RELIEF_LINES)}\n\n` +
        `🧿 Curse on **${targetName}** for Match #${activeCurseMatchId} ` +
        `(${activeCurse.match.home.toUpperCase()} vs ${activeCurse.match.away.toUpperCase()}) has been removed.`
      )
      .setColor(0x57F287)
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  } catch (err) {
    logger.error(err);
    if (!interaction.replied) {
      await interaction.reply({ content: '❌ Failed to remove curse.', flags: MessageFlags.Ephemeral }).catch(() => {});
    }
  }
}
