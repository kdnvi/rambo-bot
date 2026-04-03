import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import { readTournamentData, readPlayers, readPlayerAllIns, readPlayerWagers, setPlayerAllIn } from '../utils/firebase.js';
import { getMatchStake } from '../utils/football.js';
import { pick, VND_FORMATTER, findNextMatch } from '../utils/helper.js';
import logger from '../utils/logger.js';

const HYPE_LINES = [
  'The absolute MADLAD just went all-in!',
  'Someone call an ambulance... but not for them!',
  'This is either genius or insanity. No in-between.',
  'They woke up and chose VIOLENCE (financial).',
  'Legend or clown? We\'ll find out soon.',
  'The balls on this one... astronomical.',
  'Mom would NOT approve of this bet.',
  'This is what zero fear looks like.',
  'History will remember this moment.',
  'Their palms are sweaty, knees weak, arms heavy...',
];

const BROKE_LINES = [
  'tried to go all-in with empty pockets 💀',
  'wants to bet it all... but "it all" is nothing 🕳️',
  'is out here acting rich with a broke balance 🤡',
  'went to the casino with no money and got escorted out 🚪',
  'has the confidence but not the funds 📉',
];

export const data = new SlashCommandBuilder()
  .setName('all-in')
  .setDescription('Bet your ENTIRE balance on a match!');

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

    const balance = players[userId].points;
    if (balance <= 0) {
      const embed = new EmbedBuilder()
        .setTitle('💸  ALL IN DENIED')
        .setDescription(
          `**${interaction.user}** ${pick(BROKE_LINES)}\n\nBalance: **${VND_FORMATTER.format(balance * 1000)}**`
        )
        .setColor(0xED4245)
        .setThumbnail(interaction.user.displayAvatarURL());
      await interaction.reply({ embeds: [embed] });
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

    const wagers = await readPlayerWagers();
    const myWagers = wagers[userId] || {};
    if (myWagers[matchId]?.type === 'double-down') {
      const embed = new EmbedBuilder()
        .setTitle('⚠️  Already Double-Downed')
        .setDescription('You already double-downed on this match. Use `/undo-double-down` first if you want to go all-in instead.')
        .setColor(0xFEE75C);
      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      return;
    }

    const existing = await readPlayerAllIns(userId);
    if (existing[matchId]) {
      const embed = new EmbedBuilder()
        .setTitle('⚠️  Already All-In')
        .setDescription(`You already went all-in on this match with **${VND_FORMATTER.format(existing[matchId].amount * 1000)}**.`)
        .setColor(0xFEE75C);
      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      return;
    }

    const stake = getMatchStake(match.id);
    await setPlayerAllIn(userId, matchId, balance);

    const embed = new EmbedBuilder()
      .setTitle('🔥  ALL IN! 🔥')
      .setDescription(
        `${pick(HYPE_LINES)}\n\n` +
        `**${interaction.user}** just put **${VND_FORMATTER.format(balance * 1000)}** on the line!\n\n` +
        `⚽ **Match #${matchId}:** ${match.home.toUpperCase()} vs ${match.away.toUpperCase()}\n` +
        `💰 Base stake: ${stake} pts\n` +
        `🎰 All-in amount: **${VND_FORMATTER.format(balance * 1000)}**\n\n` +
        '✅ Win → **double your balance**\n' +
        '❌ Lose → **back to zero**\n\n' +
        '⚠️ *Use `/undo-all-in` before kickoff if you chicken out.*'
      )
      .setColor(0xFF4500)
      .setThumbnail(interaction.user.displayAvatarURL())
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  } catch (err) {
    logger.error(err);
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({ content: '❌ Failed to activate all-in.', flags: MessageFlags.Ephemeral }).catch(() => {});
    }
  }
}
