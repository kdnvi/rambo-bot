import { readFileSync } from 'node:fs';

const R32_MATCH_IDS = Array.from({ length: 16 }, (_, i) => 73 + i);

function getGroupStandings(groups) {
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

function getThirdPlaceRanking(standings) {
  return Object.entries(standings)
    .filter(([, teams]) => teams.length >= 3)
    .map(([group, teams]) => ({ group: group.toUpperCase(), ...teams[2] }))
    .sort((a, b) =>
      b.points - a.points ||
      b.goalDifference - a.goalDifference ||
      b.for - a.for
    );
}

function resolveTeam(code, standings) {
  const match = code.match(/^(\d)([A-L])$/i);
  if (!match) return null;
  const pos = parseInt(match[1]) - 1;
  const group = match[2].toLowerCase();
  return standings[group]?.[pos]?.name || null;
}

function buildBracket(matches, standings) {
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

const TEMPLATES = [
  'templates/worldcup2026.json',
  'templates/worldcup2026-test.json',
];

let allPassed = true;

for (const path of TEMPLATES) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Validating: ${path}`);
  console.log('='.repeat(60));

  const data = JSON.parse(readFileSync(path, 'utf-8'));
  const { groups, matches } = data;
  let errors = 0;

  const standings = getGroupStandings(groups);
  const groupKeys = Object.keys(standings).sort();
  console.log(`\nGroups found: ${groupKeys.map((g) => g.toUpperCase()).join(', ')} (${groupKeys.length})`);

  if (groupKeys.length !== 12) {
    console.error(`FAIL: Expected 12 groups, got ${groupKeys.length}`);
    allPassed = false;
    continue;
  }

  for (const key of groupKeys) {
    const teams = standings[key];
    if (teams.length !== 4) {
      console.error(`FAIL: Group ${key.toUpperCase()} has ${teams.length} teams, expected 4`);
      errors++;
    }
  }

  const thirdPlace = getThirdPlaceRanking(standings);
  console.log(`Third-place teams: ${thirdPlace.length}`);
  if (thirdPlace.length !== 12) {
    console.error(`FAIL: Expected 12 third-place teams, got ${thirdPlace.length}`);
    errors++;
  }

  const r32 = matches.filter((m) => m.id >= 73 && m.id <= 88);
  console.log(`R32 matches found: ${r32.length}`);
  if (r32.length !== 16) {
    console.error(`FAIL: Expected 16 R32 matches (IDs 73-88), got ${r32.length}`);
    allPassed = false;
    continue;
  }

  for (const m of r32) {
    for (const side of ['home', 'away']) {
      const code = m[side];
      if (code === '3rd') continue;
      if (!/^[12][A-L]$/i.test(code)) {
        console.error(`FAIL: Match #${m.id} ${side} has invalid bracket code "${code}"`);
        errors++;
      }
    }
  }

  const thirdSlotCount = r32.reduce(
    (n, m) => n + (m.home === '3rd' ? 1 : 0) + (m.away === '3rd' ? 1 : 0),
    0,
  );
  console.log(`Third-place slots in R32: ${thirdSlotCount}`);
  if (thirdSlotCount !== 8) {
    console.error(`FAIL: Expected 8 third-place slots, got ${thirdSlotCount}`);
    errors++;
  }

  const pairs = buildBracket(matches, standings);
  console.log(`Bracket pairs generated: ${pairs.length}`);
  if (pairs.length !== 16) {
    console.error(`FAIL: Expected 16 bracket pairs, got ${pairs.length}`);
    errors++;
  }

  for (const g of groupKeys) {
    if (!resolveTeam(`1${g.toUpperCase()}`, standings)) {
      console.error(`FAIL: Could not resolve 1${g.toUpperCase()}`);
      errors++;
    }
    if (!resolveTeam(`2${g.toUpperCase()}`, standings)) {
      console.error(`FAIL: Could not resolve 2${g.toUpperCase()}`);
      errors++;
    }
  }

  const allTeamsInBracket = new Set();
  for (const p of pairs) {
    if (p.home.team) allTeamsInBracket.add(p.home.team);
    else {
      console.error(`FAIL: Match #${p.id} home (${p.home.label}) resolved to null`);
      errors++;
    }
    if (p.away.team) allTeamsInBracket.add(p.away.team);
    else {
      console.error(`FAIL: Match #${p.id} away (${p.away.label}) resolved to null`);
      errors++;
    }
  }

  console.log(`Unique teams in bracket: ${allTeamsInBracket.size}`);
  if (allTeamsInBracket.size !== 32) {
    console.error(`FAIL: Expected 32 unique teams in bracket, got ${allTeamsInBracket.size}`);
    errors++;
  }

  const duplicates = [...allTeamsInBracket].filter((t) => {
    let count = 0;
    for (const p of pairs) {
      if (p.home.team === t) count++;
      if (p.away.team === t) count++;
    }
    return count > 1;
  });
  if (duplicates.length > 0) {
    console.error(`FAIL: Duplicate teams in bracket: ${duplicates.join(', ')}`);
    errors++;
  }

  console.log('\nBracket:');
  for (const p of pairs) {
    const home = (p.home.team || 'TBD').toUpperCase();
    const away = (p.away.team || 'TBD').toUpperCase();
    console.log(`  #${p.id}  ${home.padEnd(25)} vs  ${away.padEnd(25)}  (${p.home.label} vs ${p.away.label})`);
  }

  if (errors > 0) allPassed = false;
  console.log(`\n${path}: ${errors === 0 ? 'PASS' : `FAIL (${errors} error(s))`}`);
}

console.log(`\n${'='.repeat(60)}`);
console.log(allPassed ? 'ALL VALIDATIONS PASSED' : 'SOME VALIDATIONS FAILED');
console.log('='.repeat(60));
process.exit(allPassed ? 0 : 1);
