import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import { updateMatchResult, readPlayers, readMatchVotes } from '../utils/firebase.js';
import { calculateMatches } from '../utils/football.js';
import { getWinner, pick, VND_FORMATTER } from '../utils/helper.js';
import logger from '../utils/logger.js';

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

      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
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
    await calculateMatches([updatedMatch], interaction.client);
    logger.info(`Immediate calculation triggered for match ${matchId + 1}`);

    await postStandings(interaction);
    await postMatchRoast(interaction, updatedMatch);
  } catch (err) {
    logger.error(err);
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({ content: '❌ Failed to update the match result.', flags: MessageFlags.Ephemeral }).catch(() => {});
    }
  }
}

const ROAST_LINES = [
  'really thought that was happening huh 💀',
  'should stick to predicting the weather',
  '\'s prediction aged like milk in the sun 🥛',
  'needs to have their crystal ball checked',
  'bet with their heart, not their brain',
  'might want to ask a coin next time',
  '\'s prediction was a war crime',
  'confidently wrong, as always',
  'chose violence... against their own points',
  'looked at the stats and said "nah, vibes"',
  'predicted like they were blindfolded 🙈',
  '\'s gut feeling needs surgery',
];

async function postMatchRoast(interaction, match) {
  try {
    if (!match.messageId) return;
    const votes = (await readMatchVotes(match.id, match.messageId)).val();
    if (!votes) return;

    const winner = getWinner(match);
    const users = interaction.client.cachedUsers;
    const losers = [];

    for (const [userId, v] of Object.entries(votes)) {
      if (v.vote !== winner) {
        losers.push(users[userId]?.nickname || 'Unknown');
      }
    }

    if (losers.length === 0) return;

    const roasted = losers.slice(0, 3);
    const lines = roasted.map((name) => `🤡 **${name}** ${pick(ROAST_LINES)}`);

    if (losers.length > 3) {
      lines.push(`...and **${losers.length - 3}** other clown(s)`);
    }

    const embed = new EmbedBuilder()
      .setTitle('🔥  Post-Match Roast')
      .setDescription(lines.join('\n'))
      .setColor(0xE67E22)
      .setTimestamp();

    await interaction.followUp({ embeds: [embed] });
  } catch (err) {
    logger.error('Failed to post match roast:', err);
  }
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
      `👑 **${leader.nickname}** ${pick(LEADER_LINES)} (${VND_FORMATTER.format(leader.points * 1000)})`,
      '',
      `💀 **${bottom.nickname}** ${pick(BOTTOM_LINES)} (${VND_FORMATTER.format(bottom.points * 1000)})`,
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
