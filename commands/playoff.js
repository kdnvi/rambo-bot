import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import { readTournamentData } from '../utils/firebase.js';
import { withErrorHandler, getTournamentName } from '../utils/command.js';

export const data = new SlashCommandBuilder()
  .setName('worldcup-playoff')
  .setDescription('Nhánh đấu vòng 32 — ai gặp ai, run chưa?');

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
        const t = thirdIdx < qualified.length ? qualified[thirdIdx++] : null;
        return { label: t ? `${t.group}3` : '3rd', team: t?.name || null };
      }
      return { label: code, team: resolveTeam(code, standings) };
    };

    const home = resolveSlot(m.home);
    const away = resolveSlot(m.away);
    return { id: m.id, home, away };
  });
}

export const execute = withErrorHandler(async (interaction) => {
  const tournamentName = await getTournamentName();
  const groups = await readTournamentData('groups');
  const allMatches = await readTournamentData('matches');

  if (!groups || !allMatches) {
    const embed = new EmbedBuilder()
      .setTitle('🏆  Không có dữ liệu')
      .setDescription('Chưa có dữ liệu bảng hoặc trận đấu.')
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
      ? `\n…và **${pendingGroupMatches.length - 3}** trận nữa`
      : '';
    const embed = new EmbedBuilder()
      .setTitle('⏳  Vòng bảng chưa xong')
      .setDescription(
        `Còn **${pendingGroupMatches.length}** trận vòng bảng chưa có kết quả.\n\n` +
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
        .setTitle('📋  Đội xếp thứ 3 tốt nhất')
        .setDescription(
          thirdLines.join('\n') +
          (eliminatedLines.length > 0 ? '\n\n' + eliminatedLines.join('\n') : '')
        )
        .setColor(0x57F287)
    );
  }

  const title = new EmbedBuilder()
    .setTitle(`🏆  ${tournamentName} — Vòng 32`)
    .setDescription(`**${pairs.length} cặp đấu** theo BXH hiện tại`)
    .setColor(0xFFD700)
    .setTimestamp();

  const allEmbeds = [title, ...embeds];
  await interaction.reply({ embeds: allEmbeds.slice(0, 10) });
  for (let i = 10; i < allEmbeds.length; i += 10) {
    await interaction.followUp({ embeds: allEmbeds.slice(i, i + 10) });
  }
});
