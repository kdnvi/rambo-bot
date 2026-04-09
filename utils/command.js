import { EmbedBuilder, MessageFlags } from 'discord.js';
import { readPlayers, readTournamentData, readTournamentConfig } from './firebase.js';
import logger from './logger.js';

export function withErrorHandler(fn) {
  return async (interaction) => {
    try {
      await fn(interaction);
    } catch (err) {
      logger.error(err);
      const content = '❌ Có lỗi xảy ra.';
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({ content, flags: MessageFlags.Ephemeral }).catch(() => {});
      } else {
        await interaction.editReply({ content }).catch(() => {});
      }
    }
  };
}

export async function requirePlayer(interaction, userId) {
  const players = await readPlayers();
  if (!players || !players[userId]) {
    const embed = new EmbedBuilder()
      .setTitle('❌  Chưa đăng ký')
      .setDescription('Bạn cần `/register` trước.')
      .setColor(0xED4245);
    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    return null;
  }
  return players;
}

export async function requireMatches(interaction) {
  const allMatches = await readTournamentData('matches');
  if (!allMatches) {
    await interaction.reply({ content: '❌ Không có dữ liệu trận đấu.', flags: MessageFlags.Ephemeral });
    return null;
  }
  return allMatches;
}

export async function getChannelId() {
  const config = await readTournamentConfig();
  return config?.channelId || process.env.FOOTBALL_CHANNEL_ID;
}

export async function getTournamentName() {
  const config = await readTournamentConfig();
  return config?.name || 'Tournament';
}

export function findActiveEntry(entries, allMatches, filterFn) {
  const now = Date.now();
  for (const [matchId, entry] of Object.entries(entries)) {
    if (!filterFn(entry)) continue;
    const match = allMatches.find((m) => m.id === Number(matchId));
    if (match && Date.parse(match.date) > now) {
      return { matchId: Number(matchId), match, entry };
    }
  }
  return null;
}
