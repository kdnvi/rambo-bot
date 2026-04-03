import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { updateMatchResult, readPlayers } from '../utils/firebase.js';
import { calculateMatches } from '../utils/football.js';
import logger from '../utils/logger.js';

const formatter = new Intl.NumberFormat('vi-VN', {
  style: 'currency',
  currency: 'VND',
});

const LEADER_LINES = [
  'is on fire right now!',
  'is flexing on everyone!',
  'can\'t stop winning!',
  'is built different!',
  'is the GOAT (for now)!',
  'eats predictions for breakfast!',
  'has a crystal ball or something...',
  'is making this look too easy!',
  'woke up and chose domination!',
  'is living rent-free in everyone\'s head!',
];

const BOTTOM_LINES = [
  'is down bad... real bad.',
  'might want to try coin flipping instead.',
  'should consider a career change from betting.',
  'is making everyone else feel better about themselves.',
  'is generously donating points to the pool.',
  'is proof that random picks might be better.',
  'thought this was a charity event.',
  'is speedrunning bankruptcy.',
  'has entered the shadow realm of the leaderboard.',
  'is singlehandedly keeping the bottom warm.',
  'looked at the odds and chose violence (against their own wallet).',
];

export const data = new SlashCommandBuilder()
  .setName('update-result')
  .setDescription('Update result of a specific match')
  .addIntegerOption(option => option.setName('match-id')
    .setDescription('Match ID')
    .setRequired(true))
  .addIntegerOption(option => option.setName('home-score')
    .setDescription('Home score')
    .setRequired(true))
  .addIntegerOption(option => option.setName('away-score')
    .setDescription('Away score')
    .setRequired(true));

export async function execute(interaction) {
  try {
    const matchId = parseInt(interaction.options.get('match-id').value) - 1;
    const homeScore = interaction.options.get('home-score').value;
    const awayScore = interaction.options.get('away-score').value;

    const result = await updateMatchResult(matchId, homeScore, awayScore);

    if (!result.success) {
      const embed = new EmbedBuilder().setTimestamp();

      if (result.error === 'not_found') {
        embed
          .setTitle('❌  Match Not Found')
          .setDescription(`No match found with ID \`${matchId + 1}\`.`)
          .setColor(0xED4245);
      } else if (result.error === 'already_exists') {
        const m = result.match;
        embed
          .setTitle('⚠️  Result Already Exists')
          .setDescription(`**${m.home.toUpperCase()}** ${m.result.home} - ${m.result.away} **${m.away.toUpperCase()}**`)
          .setColor(0xFEE75C);
      }

      await interaction.reply({ embeds: [embed], ephemeral: true });
      return;
    }

    const m = result.match;
    const embed = new EmbedBuilder()
      .setTitle('✅  Match Result Updated')
      .setDescription(`**${m.home.toUpperCase()}** ${homeScore} - ${awayScore} **${m.away.toUpperCase()}**`)
      .setColor(0x57F287)
      .addFields(
        { name: '🏟️ Location', value: m.location, inline: true },
        { name: '🆔 Match ID', value: `${matchId + 1}`, inline: true },
      )
      .setFooter({ text: `Updated by ${interaction.user.displayName}` })
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });

    const updatedMatch = {
      ...m,
      hasResult: true,
      result: { home: homeScore, away: awayScore },
    };
    await calculateMatches([updatedMatch]);
    logger.info(`Immediate calculation triggered for match ${matchId + 1}`);

    await postStandings(interaction);
  } catch (err) {
    logger.error(err);
    if (!interaction.replied) {
      await interaction.reply({ content: '❌ Failed to update the match result.', ephemeral: true }).catch(() => {});
    }
  }
}

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

async function postStandings(interaction) {
  try {
    const players = (await readPlayers()).val();
    if (!players) return;
    const users = interaction.client.cachedUsers;

    const ranked = [];
    for (const [key, value] of Object.entries(players)) {
      ranked.push({
        id: key,
        nickname: users[key]?.nickname || 'Unknown',
        points: value.points,
      });
    }
    ranked.sort((a, b) => b.points - a.points);

    if (ranked.length < 2) return;

    const leader = ranked[0];
    const bottom = ranked[ranked.length - 1];

    const lines = [
      `👑 **${leader.nickname}** ${pick(LEADER_LINES)} (${formatter.format(leader.points * 1000)})`,
      '',
      `💀 **${bottom.nickname}** ${pick(BOTTOM_LINES)} (${formatter.format(bottom.points * 1000)})`,
    ];

    const embed = new EmbedBuilder()
      .setTitle('📊  Updated Standings')
      .setDescription(lines.join('\n'))
      .setColor(0xFFD700)
      .setTimestamp();

    await interaction.followUp({ embeds: [embed] });
  } catch (err) {
    logger.error('Failed to post standings:', err);
  }
}
