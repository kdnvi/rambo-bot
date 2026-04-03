import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import { readTournamentData, readTournamentConfig } from '../utils/firebase.js';
import logger from '../utils/logger.js';

export const data = new SlashCommandBuilder()
  .setName('worldcup-playoff')
  .setDescription('View WC 2026 Round of 32 bracket based on current group standings');

const R32_MATCH_IDS = Array.from({ length: 16 }, (_, i) => 73 + i);

export function getGroupStandings(groups) {
  const standings = {};
  for (const [key, teams] of Object.entries(groups)) {
    standings[key] = Object.entries(teams)
      .map(([name, s]) => ({ name, ...s }))
      .sort((a, b) =>
        b.points - a.points ||
        b.goalDifference - a.goalDifference ||
        b.for - a.for
      );
  }
  return standings;
}

export function getThirdPlaceRanking(standings) {
  return Object.entries(standings)
    .filter(([, teams]) => teams.length >= 3)
    .map(([group, teams]) => ({ group: group.toUpperCase(), ...teams[2] }))
    .sort((a, b) =>
      b.points - a.points ||
      b.goalDifference - a.goalDifference ||
      b.for - a.for
    );
}

export function resolveTeam(code, standings) {
  const match = code.match(/^(\d)([A-L])$/i);
  if (!match) return null;
  const pos = parseInt(match[1]) - 1;
  const group = match[2].toLowerCase();
  return standings[group]?.[pos]?.name || null;
}

export function buildBracket(matches, standings) {
  const r32 = matches.filter((m) => R32_MATCH_IDS.includes(m.id));
  const thirdPlace = getThirdPlaceRanking(standings);
  const qualified = thirdPlace.slice(0, 8);
  let thirdIdx = 0;

  return r32.map((m) => {
    const resolveSlot = (code) => {
      if (code === '3rd') {
        const t = qualified[thirdIdx++];
        return { label: t ? `${t.group}3` : '3rd', team: t?.name || null };
      }
      return { label: code, team: resolveTeam(code, standings) };
    };

    const home = resolveSlot(m.home);
    const away = resolveSlot(m.away);
    return { id: m.id, home, away };
  });
}

export async function execute(interaction) {
  try {
    const config = await readTournamentConfig();
    const tournamentName = config?.name || 'Tournament';
    const groups = (await readTournamentData('groups')).val();
    const allMatches = (await readTournamentData('matches')).val();

    if (!groups || !allMatches) {
      const embed = new EmbedBuilder()
        .setTitle('🏆  No Data Available')
        .setDescription('Group or match data has not been configured yet.')
        .setColor(0xFEE75C);
      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      return;
    }

    const groupStageMatches = allMatches.filter((m) => m.id < R32_MATCH_IDS[0]);
    const pendingGroupMatches = groupStageMatches.filter((m) => !m.hasResult);

    if (pendingGroupMatches.length > 0) {
      const sample = pendingGroupMatches.slice(0, 3);
      const matchList = sample
        .map((m) => `\`#${m.id}\` ${m.home.toUpperCase()} vs ${m.away.toUpperCase()}`)
        .join('\n');
      const moreText = pendingGroupMatches.length > 3
        ? `\n…and **${pendingGroupMatches.length - 3}** more`
        : '';
      const embed = new EmbedBuilder()
        .setTitle('⏳  Group Stage Not Complete')
        .setDescription(
          `**${pendingGroupMatches.length}** group stage match(es) still have no result.\n\n` +
          matchList + moreText
        )
        .setColor(0xFEE75C);
      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      return;
    }

    const standings = getGroupStandings(groups);
    const pairs = buildBracket(allMatches, standings);
    const thirdPlace = getThirdPlaceRanking(standings);
    const qualified = thirdPlace.slice(0, 8);

    const lines = pairs.map((p) => {
      const home = p.home.team?.toUpperCase() || 'TBD';
      const away = p.away.team?.toUpperCase() || 'TBD';
      return `\`#${p.id}\`  **${home}**  vs  **${away}**\n> ${p.home.label} vs ${p.away.label}`;
    });

    const embeds = [];
    const chunkSize = 8;
    for (let i = 0; i < lines.length; i += chunkSize) {
      const chunk = lines.slice(i, i + chunkSize);
      embeds.push(
        new EmbedBuilder()
          .setDescription(chunk.join('\n\n'))
          .setColor(0x5865F2)
      );
    }

    if (qualified.length > 0) {
      const thirdLines = qualified.map((t, i) => {
        const rank = `\`${i + 1}.\``;
        const gd = t.goalDifference >= 0 ? `+${t.goalDifference}` : `${t.goalDifference}`;
        return `${rank} **${t.name.toUpperCase()}** (${t.group}) — ${t.points} pts, ${gd} GD`;
      });

      const eliminated = thirdPlace.slice(8);
      const eliminatedLines = eliminated.map((t) => {
        const gd = t.goalDifference >= 0 ? `+${t.goalDifference}` : `${t.goalDifference}`;
        return `~~${t.name.toUpperCase()} (${t.group}) — ${t.points} pts, ${gd} GD~~`;
      });

      embeds.push(
        new EmbedBuilder()
          .setTitle('📋  Best Third-Place Teams')
          .setDescription(
            thirdLines.join('\n') +
            (eliminatedLines.length > 0 ? '\n\n' + eliminatedLines.join('\n') : '')
          )
          .setColor(0x57F287)
      );
    }

    const title = new EmbedBuilder()
      .setTitle(`🏆  ${tournamentName} — Round of 32`)
      .setDescription(`**${pairs.length} matches** based on current group standings`)
      .setColor(0xFFD700)
      .setTimestamp();

    await interaction.reply({ embeds: [title, ...embeds].slice(0, 10) });
  } catch (err) {
    logger.error(err);
    if (!interaction.replied) {
      await interaction.reply({ content: '❌ Failed to calculate playoff bracket.', flags: MessageFlags.Ephemeral }).catch(() => {});
    }
  }
}
