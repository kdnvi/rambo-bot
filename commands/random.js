import { SlashCommandBuilder, EmbedBuilder, MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { readTournamentData, readPlayers, readUserWagers, setPlayerWager, readMatchVotes, removeMatchVote } from '../utils/firebase.js';
import { pick, findNextMatch } from '../utils/helper.js';
import logger from '../utils/logger.js';

const RANDOM_LINES = [
  'giao hết cho vận mệnh rồi nha!',
  'nhắm mắt đưa chân, trời kêu ai nấy dạ.',
  'bỏ não ở nhà hôm nay.',
  'để ông trời quyết định!',
  'tự tin vào sự ngẫu nhiên hơn bản thân mình.',
  'quay xổ số thôi, suy nghĩ chi cho mệt.',
  'số phận dẫn lối, bước đi không cần não.',
  'gieo xúc xắc rồi ngồi cầu nguyện.',
];

export const data = new SlashCommandBuilder()
  .setName('random')
  .setDescription('Giao số phận cho ông trời — random thay vì bị gán đội ít vote nhất');

export async function execute(interaction) {
  try {
    const userId = interaction.user.id;

    const players = (await readPlayers()).val();
    if (!players || !players[userId]) {
      const embed = new EmbedBuilder()
        .setTitle('❌  Chưa đăng ký')
        .setDescription('Bạn cần `/register` trước.')
        .setColor(0xED4245);
      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      return;
    }

    const allMatches = (await readTournamentData('matches')).val();
    if (!allMatches) {
      await interaction.reply({ content: '❌ Không có dữ liệu trận đấu.', flags: MessageFlags.Ephemeral });
      return;
    }

    const match = findNextMatch(allMatches);
    if (!match) {
      await interaction.reply({ content: '❌ Không có trận nào sắp tới.', flags: MessageFlags.Ephemeral });
      return;
    }

    const matchId = match.id;
    const myWagers = await readUserWagers(userId);

    if (myWagers[matchId]?.type === 'random') {
      const embed = new EmbedBuilder()
        .setTitle('⚠️  Đã kích hoạt rồi')
        .setDescription(`Random đã bật cho trận \`#${matchId}\` rồi. Nằm chờ số phận thôi!`)
        .setColor(0xFEE75C);
      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      return;
    }

    if (match.messageId) {
      const votes = (await readMatchVotes(matchId, match.messageId)).val();
      if (votes && votes[userId]) {
        const currentVote = votes[userId].vote;
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`random-confirm|${matchId}`)
            .setLabel('Xoá vote & random')
            .setStyle(ButtonStyle.Danger),
          new ButtonBuilder()
            .setCustomId('random-cancel')
            .setLabel('Giữ vote')
            .setStyle(ButtonStyle.Secondary),
        );

        const embed = new EmbedBuilder()
          .setTitle('⚠️  Bạn đã vote rồi')
          .setDescription(
            `Bạn đang chọn **${currentVote.toUpperCase()}** cho trận \`#${matchId}\`.\n\n` +
            'Kích hoạt random sẽ **xoá vote** hiện tại. Chắc chưa?',
          )
          .setColor(0xFEE75C);

        await interaction.reply({ embeds: [embed], components: [row], flags: MessageFlags.Ephemeral });
        return;
      }
    }

    await activateRandom(interaction, match);
  } catch (err) {
    logger.error(err);
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({ content: '❌ Không thể kích hoạt random.', flags: MessageFlags.Ephemeral }).catch(() => {});
    }
  }
}

export async function handleRandomButton(interaction) {
  try {
    if (interaction.customId === 'random-cancel') {
      const embed = new EmbedBuilder()
        .setDescription('👍 Giữ nguyên vote. Không random.')
        .setColor(0x57F287);
      await interaction.update({ embeds: [embed], components: [] });
      return;
    }

    const [, matchIdStr] = interaction.customId.split('|');
    const matchId = parseInt(matchIdStr);

    const allMatches = (await readTournamentData('matches')).val();
    const match = allMatches?.find((m) => m.id === matchId);
    if (!match) {
      await interaction.update({ content: '❌ Không tìm thấy trận.', embeds: [], components: [] });
      return;
    }

    if (match.messageId) {
      await removeMatchVote(matchId, interaction.user.id, match.messageId);
    }

    await activateRandom(interaction, match, true);
  } catch (err) {
    logger.error(err);
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({ content: '❌ Có lỗi xảy ra.', flags: MessageFlags.Ephemeral }).catch(() => {});
    }
  }
}

async function activateRandom(interaction, match, isUpdate = false) {
  await setPlayerWager(interaction.user.id, match.id, 'random');

  const embed = new EmbedBuilder()
    .setTitle('🎲  RANDOM!')
    .setDescription(
      `**${interaction.user}** ${pick(RANDOM_LINES)}\n\n` +
      `⚽ **Trận #${match.id}:** ${match.home.toUpperCase()} vs ${match.away.toUpperCase()}\n\n` +
      '🎲 Nếu không vote trước giờ đá, hệ thống sẽ **random** thay vì gán đội ít vote nhất.',
    )
    .setColor(0x9B59B6)
    .setThumbnail(interaction.user.displayAvatarURL())
    .setTimestamp();

  if (isUpdate) {
    await interaction.update({ embeds: [embed], components: [] });
  } else {
    await interaction.reply({ embeds: [embed] });
  }
}
