import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import { readTournamentData, readPlayers, readPlayerWagers, readPlayerAllIns, setPlayerWager } from '../utils/firebase.js';
import { getMatchStake } from '../utils/football.js';
import { pick, findNextMatch } from '../utils/helper.js';
import logger from '../utils/logger.js';

const HYPE_LINES = [
  'is feeling dangerous today!',
  'said "normal stakes are for the weak".',
  'just turned up the heat!',
  'is putting their money where their mouth is.',
  'chose to live life on the edge.',
  'thinks they can see the future.',
  'is either very smart or very brave.',
  'just raised the stakes. Literally.',
  'has entered beast mode.',
  'is not here to play it safe.',
];

export const data = new SlashCommandBuilder()
  .setName('double-down')
  .setDescription('Double your stake on a match (1 per matchday)');

export async function execute(interaction) {
  try {
    const userId = interaction.user.id;

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

    const match = findNextMatch(allMatches);
    if (!match) {
      await interaction.reply({ content: '❌ No upcoming matches available.', flags: MessageFlags.Ephemeral });
      return;
    }

    const matchId = match.id;

    const matchDay = match.date.slice(0, 10);
    const sameDayMatchIds = allMatches
      .filter((m) => m.date.startsWith(matchDay))
      .map((m) => m.id);

    const wagers = await readPlayerWagers();
    const myWagers = wagers[userId] || {};

    const existingAllIns = await readPlayerAllIns(userId);
    if (existingAllIns[matchId]) {
      const embed = new EmbedBuilder()
        .setTitle('⚠️  Already All-In')
        .setDescription('You already went all-in on this match. You can\'t double-down on top of that, you maniac.')
        .setColor(0xFEE75C);
      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      return;
    }

    const alreadyThisDay = sameDayMatchIds.some((id) => myWagers[id]?.type === 'double-down');
    if (alreadyThisDay) {
      const usedId = sameDayMatchIds.find((id) => myWagers[id]?.type === 'double-down');
      const embed = new EmbedBuilder()
        .setTitle('⚠️  Already Used')
        .setDescription(`You already used double-down on match \`#${usedId}\` today. One per matchday!`)
        .setColor(0xFEE75C);
      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      return;
    }

    const stake = getMatchStake(match.id);
    await setPlayerWager(userId, matchId, 'double-down');

    const embed = new EmbedBuilder()
      .setTitle('⏫  DOUBLE DOWN!')
      .setDescription(
        `**${interaction.user}** ${pick(HYPE_LINES)}\n\n` +
        `⚽ **Match #${matchId}:** ${match.home.toUpperCase()} vs ${match.away.toUpperCase()}\n` +
        `💰 Stake: ${stake} → **${stake * 2} pts**\n\n` +
        '✅ Win → **2x the winnings**\n' +
        '❌ Lose → **2x the pain**'
      )
      .setColor(0x57F287)
      .setThumbnail(interaction.user.displayAvatarURL())
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  } catch (err) {
    logger.error(err);
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({ content: '❌ Failed to activate double-down.', flags: MessageFlags.Ephemeral }).catch(() => {});
    }
  }
}
