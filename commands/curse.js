import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import { readTournamentData, readPlayers, readCurses, setCurse } from '../utils/firebase.js';
import logger from '../utils/logger.js';

const CURSE_LINES = [
  'just put a hex on',
  'is channeling dark energy toward',
  'whispered an ancient curse at',
  'drew a voodoo doll of',
  'just sent bad juju to',
  'activated the evil eye on',
  'summoned a black cat for',
  'hired a witch doctor against',
];

export const data = new SlashCommandBuilder()
  .setName('curse')
  .setDescription('Curse a player on the next match — if they lose, steal 5 pts!')
  .addUserOption(option => option.setName('player')
    .setDescription('Player to curse')
    .setRequired(true));

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

export async function execute(interaction) {
  try {
    const curserId = interaction.user.id;
    const target = interaction.options.get('player').user;

    if (target.id === curserId) {
      const embed = new EmbedBuilder()
        .setTitle('🪞  Self-Curse?')
        .setDescription('You can\'t curse yourself. That\'s just depression.')
        .setColor(0xFEE75C);
      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      return;
    }

    const players = (await readPlayers()).val();
    if (!players || !players[curserId]) {
      await interaction.reply({ content: '❌ You need to `/register` first.', flags: MessageFlags.Ephemeral });
      return;
    }
    if (!players[target.id]) {
      await interaction.reply({ content: '❌ That player is not registered.', flags: MessageFlags.Ephemeral });
      return;
    }

    const allMatches = (await readTournamentData('matches')).val();
    if (!allMatches) {
      await interaction.reply({ content: '❌ No match data available.', flags: MessageFlags.Ephemeral });
      return;
    }

    const now = Date.now();
    const votable = allMatches
      .filter((m) => m.messageId && Date.parse(m.date) > now)
      .sort((a, b) => Date.parse(a.date) - Date.parse(b.date));

    let nextMatch = votable[0];
    if (!nextMatch) {
      nextMatch = allMatches
        .filter((m) => Date.parse(m.date) > now)
        .sort((a, b) => Date.parse(a.date) - Date.parse(b.date))[0];
    }
    if (!nextMatch) {
      await interaction.reply({ content: '❌ No upcoming matches to curse on.', flags: MessageFlags.Ephemeral });
      return;
    }

    const matchId = nextMatch.id;
    const match = nextMatch;

    const curses = await readCurses();
    if (curses[matchId]?.[curserId]) {
      const existing = curses[matchId][curserId];
      const existingName = interaction.client.cachedUsers?.[existing.target]?.nickname || existing.target;
      const embed = new EmbedBuilder()
        .setTitle('⚠️  Already Cursed')
        .setDescription(`You already cursed **${existingName}** on Match #${matchId}. Wait for it to resolve, then curse again.`)
        .setColor(0xFEE75C);
      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      return;
    }

    await setCurse(curserId, target.id, matchId);

    const users = interaction.client.cachedUsers;
    const targetName = users[target.id]?.nickname || target.displayName;

    const embed = new EmbedBuilder()
      .setTitle('🧿  CURSE ACTIVATED')
      .setDescription(
        `**${interaction.user}** ${pick(CURSE_LINES)} **${targetName}**!\n\n` +
        `⚽ **Match #${matchId}:** ${match.home.toUpperCase()} vs ${match.away.toUpperCase()}\n\n` +
        `If **${targetName}** gets it wrong → you steal **5 pts** from them.\n` +
        `If **${targetName}** gets it right → YOU lose **5 pts** to them.\n\n` +
        '*Choose your enemies wisely...*'
      )
      .setColor(0x9B59B6)
      .setThumbnail(target.displayAvatarURL())
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  } catch (err) {
    logger.error(err);
    if (!interaction.replied) {
      await interaction.reply({ content: '❌ Failed to activate curse.', flags: MessageFlags.Ephemeral }).catch(() => {});
    }
  }
}
